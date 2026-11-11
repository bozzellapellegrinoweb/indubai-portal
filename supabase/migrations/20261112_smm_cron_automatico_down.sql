-- Annulla 20261112_smm_cron_automatico.sql.
-- Il token in Vault resta: toglierlo non serve a niente e rimetterlo
-- costringerebbe a riconfigurare. Si cancella a mano se si vuole:
--   delete from vault.secrets where name = 'smm_cron_token';

do $$ begin perform cron.unschedule('smm-worker');      exception when others then null; end $$;
do $$ begin perform cron.unschedule('smm-programmati'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('smm-piano');       exception when others then null; end $$;

drop function if exists smm_piano_quotidiano();
drop function if exists smm_sveglia_worker();
drop function if exists smm_programmati_in_scadenza();
drop function if exists smm_token_cron_valido(text);

alter table smm_settings drop column if exists piano_automatico;

delete from smm_jobs where tipo = 'piano';
alter table smm_jobs drop constraint if exists smm_jobs_tipo_check;
alter table smm_jobs add constraint smm_jobs_tipo_check
  check (tipo in ('agente','montaggio','nota_cervello','analisi','pubblicazione'));

-- Il conteggio torna dentro al guscio, come prima di questa migrazione.
create or replace function smm_piano_settimana(p_brand uuid, p_offset int default 0)
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
    count(*) filter (where ct.pubblicato_at >= c.dal and ct.pubblicato_at < c.al)::int as usciti,
    count(*) filter (where ct.pubblicato_at is null and ct.slot_at >= c.dal and ct.slot_at < c.al)::int as in_calendario,
    count(*) filter (where ct.pubblicato_at is null and ct.slot_at is null
                       and ct.stato <> 'respinto' and ct.created_at >= c.dal)::int as in_lavorazione
  from smm_contents ct
  where ct.brand_id = p.brand_id
    and ct.tipo = p.tipo
    and (cardinality(p.pillar) = 0 or ct.pillar = any(p.pillar))
    and (cardinality(p.categorie) = 0 or ct.categoria = any(p.categorie))
) u
where p.brand_id = p_brand
  and smm_puo_leggere()
order by p.ordine, p.nome;
$$;

grant execute on function smm_piano_settimana(uuid, int) to authenticated, service_role;
drop function if exists smm_piano_settimana_interna(uuid, int);
