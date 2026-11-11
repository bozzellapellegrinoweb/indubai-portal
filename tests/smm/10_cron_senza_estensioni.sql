-- Le parti della migrazione del cron che non dipendono da pg_cron, pg_net e
-- Vault, per poterle provare su un Postgres qualunque. I corpi sono copiati
-- da supabase/migrations/20261112_smm_cron_automatico.sql: se cambiano li',
-- vanno riallineati qui.

alter table smm_settings
  add column if not exists piano_automatico boolean not null default true;

alter table smm_jobs drop constraint if exists smm_jobs_tipo_check;
alter table smm_jobs add constraint smm_jobs_tipo_check
  check (tipo in ('agente','montaggio','nota_cervello','analisi','pubblicazione','piano'));

create or replace function smm_piano_settimana_interna(p_brand uuid, p_offset int default 0)
returns table (
  id uuid, nome text, tipo text, quanti_a_settimana int,
  giorni int[], ora time, pillar text[], categorie text[],
  agente_id uuid, agente text, come text, attivo boolean, ordine int,
  usciti int, in_calendario int, in_lavorazione int, mancanti int
)
language sql stable security definer set search_path to 'public' as $$
with confini as (
  select
    (date_trunc('week', (now() at time zone 'Asia/Dubai')) + (p_offset || ' weeks')::interval)
      at time zone 'Asia/Dubai' as dal,
    (date_trunc('week', (now() at time zone 'Asia/Dubai')) + ((p_offset + 1) || ' weeks')::interval)
      at time zone 'Asia/Dubai' as al
)
select
  p.id, p.nome, p.tipo, p.quanti_a_settimana,
  p.giorni, p.ora, p.pillar, p.categorie,
  p.agente_id, a.nome as agente, p.come, p.attivo, p.ordine,
  u.usciti, u.in_calendario, u.in_lavorazione,
  greatest(0, p.quanti_a_settimana - (u.usciti + u.in_calendario + u.in_lavorazione)) as mancanti
from smm_piano p
left join smm_agents a on a.id = p.agente_id
cross join confini c
cross join lateral (
  select
    count(*) filter (
      where ct.pubblicato_at >= c.dal and ct.pubblicato_at < c.al
    )::int as usciti,
    count(*) filter (
      where ct.pubblicato_at is null
        and ct.slot_at >= c.dal and ct.slot_at < c.al
    )::int as in_calendario,
    count(*) filter (
      where ct.pubblicato_at is null and ct.slot_at is null
        and ct.stato <> 'respinto'
        and ct.created_at >= c.dal
    )::int as in_lavorazione
  from smm_contents ct
  where ct.brand_id = p.brand_id
    and ct.tipo = p.tipo
    and (cardinality(p.pillar) = 0 or ct.pillar = any(p.pillar))
    and (cardinality(p.categorie) = 0 or ct.categoria = any(p.categorie))
) u
where p.brand_id = p_brand
order by p.ordine, p.nome;
$$;

revoke all on function smm_piano_settimana_interna(uuid, int) from public, anon, authenticated;
comment on function smm_piano_settimana_interna(uuid, int) is
  'Il conteggio vero della settimana, senza controllo su chi chiama. Non chiamarla da fuori: passa da smm_piano_settimana.';

-- Il guscio pubblico resta com'era, col suo cancello.
create or replace function smm_piano_settimana(p_brand uuid, p_offset int default 0)
returns table (
  id uuid, nome text, tipo text, quanti_a_settimana int,
  giorni int[], ora time, pillar text[], categorie text[],
  agente_id uuid, agente text, come text, attivo boolean, ordine int,
  usciti int, in_calendario int, in_lavorazione int, mancanti int
)
language sql stable security definer set search_path to 'public' as $$
  select * from smm_piano_settimana_interna(p_brand, p_offset)
   where smm_puo_leggere();
$$;

grant execute on function smm_piano_settimana(uuid, int) to authenticated, service_role;

create or replace function smm_programmati_in_scadenza() returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int := 0;
begin
  with da_fare as (
    select c.id, c.brand_id, c.titolo, c.tipo
      from smm_contents c
     where c.stato in ('in_calendario', 'programmato')
       and c.slot_at is not null
       and c.slot_at <= now()
       and c.pubblicato_at is null
       and c.revisore_ok
       and c.approvato_da is not null
       and not exists (
         select 1 from smm_jobs j
          where j.content_id = c.id
            and j.tipo = 'pubblicazione'
            and j.stato in ('in_coda', 'in_corso'))
  )
  insert into smm_jobs (brand_id, content_id, tipo, titolo, richiesta, payload, priorita)
  select d.brand_id, d.id, 'pubblicazione',
         'Uscita programmata',
         'E'' arrivata l''ora di uscita di: ' || d.titolo,
         jsonb_build_object(
           'piattaforme', array['instagram','facebook'],
           'formato', case d.tipo when 'reel' then 'reel'
                                  when 'storia' then 'storia'
                                  else 'carosello' end),
         90
    from da_fare d;

  get diagnostics n = row_count;
  return n;
end $$;

create or replace function smm_piano_quotidiano() returns int
language plpgsql security definer set search_path to 'public' as $$
declare
  b record;
  v_manca int;
  n int := 0;
begin
  for b in
    select s.brand_id
      from smm_settings s
     where s.piano_automatico
       and not s.stop_tutto
  loop
    if exists (
      select 1 from smm_jobs j
       where j.brand_id = b.brand_id
         and j.tipo = 'piano'
         and j.created_at >= date_trunc('day', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai'
    ) then continue; end if;

    -- la funzione interna, non il guscio: qui non c'e' nessun utente
    select coalesce(sum(w.mancanti), 0) into v_manca
      from smm_piano_settimana_interna(b.brand_id, 0) w
     where w.attivo;

    if v_manca = 0 then continue; end if;

    insert into smm_jobs (brand_id, agent_id, tipo, titolo, richiesta, priorita)
    select b.brand_id, a.id, 'piano',
           'La settimana da coprire',
           'Guarda la direzione di questa settimana e lancia quello che manca, '
           || 'una cosa per volta, assegnando a chi tocca secondo il piano. '
           || 'Se e'' gia'' coperta dillo e non produrre niente in piu''.',
           70
      from smm_agents a
     where a.brand_id = b.brand_id and a.slug = 'direttore' and a.attivo;

    n := n + 1;
  end loop;
  return n;
end $$;
