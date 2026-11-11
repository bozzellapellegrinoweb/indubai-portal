-- ============================================================
-- La Regia va avanti da sola
-- ============================================================
-- Finora la Regia lavorava solo mentre la pagina era aperta: il browser
-- svegliava il worker, e se nessuno guardava la coda restava ferma. Si e'
-- visto: il Direttore ha aperto sette storie, le ha passate al Copywriter,
-- e quelle sono rimaste li' per mezz'ora.
--
-- Qui si mettono tre ritmi, tutti dentro il database:
--
--   ogni minuto      sveglia il worker se c'e' qualcosa in coda
--   ogni 5 minuti    mette in coda le uscite il cui orario e' arrivato
--   ogni giorno      dice al Direttore di coprire quello che manca
--
-- IL SEGRETO NON LO DEVE DARE NESSUNO
--
-- La versione precedente di questo file chiedeva di creare a mano due voci
-- in Vault. Una delle due, l'indirizzo del progetto, non e' un segreto e
-- sta scritta qui. L'altra se la genera il database da sola: un valore
-- casuale che non esce mai da Postgres, non passa da una chat, non finisce
-- in un pannello. Il worker lo riconosce chiedendo al database se e' quello
-- giusto, con smm_token_cron_valido().
--
-- Quel valore non apre niente: fa partire la coda, cosa che puo' gia' fare
-- chiunque abbia la Regia. Non da' accesso ai dati.
--
-- Reversibile: 20261112_smm_cron_automatico_down.sql.
-- ============================================================

create extension if not exists pg_net with schema extensions;

-- ── Il token del cron ───────────────────────────────────────
-- Generato una volta sola. Rieseguire il file non lo cambia, altrimenti a
-- ogni rilascio il cron smetterebbe di essere riconosciuto.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'smm_cron_token') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'smm_cron_token',
      'Token con cui pg_cron sveglia smm-worker. Generato dal database, non da una persona.');
  end if;
end $$;

-- Il worker chiede qui se il token che ha ricevuto e' quello del cron.
-- security definer perche' vault non e' leggibile da chi chiama; il
-- confronto non rivela il valore, risponde solo vero o falso.
create or replace function smm_token_cron_valido(p_token text) returns boolean
language plpgsql stable security definer set search_path to 'public', 'vault' as $$
declare v_atteso text;
begin
  if coalesce(p_token, '') = '' then return false; end if;
  select decrypted_secret into v_atteso
    from vault.decrypted_secrets where name = 'smm_cron_token';
  if v_atteso is null then return false; end if;
  -- lunghezze diverse: no, e senza confrontare carattere per carattere
  return length(p_token) = length(v_atteso) and p_token = v_atteso;
end $$;

comment on function smm_token_cron_valido(text) is
  'Vero se il token e'' quello con cui pg_cron sveglia il worker. Non restituisce mai il valore.';

revoke all on function smm_token_cron_valido(text) from public, anon, authenticated;
grant execute on function smm_token_cron_valido(text) to service_role;

-- ── Ogni minuto: sveglia il worker ──────────────────────────
create or replace function smm_sveglia_worker() returns void
language plpgsql security definer set search_path to 'public', 'extensions', 'vault' as $$
declare
  v_token text;
  v_in_coda int;
  -- La chiave pubblica del progetto: sta gia' nel codice della pagina, la
  -- vede chiunque apra il portale, e da sola non autorizza niente. Serve
  -- solo a passare il gateway.
  v_anon constant text :=
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.'
    || 'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2ZG9xY2dremJ6aXF1ZmFoaHhoIiwicm9sZSI6'
    || 'ImFub24iLCJpYXQiOjE3NzIwMzIwNTEsImV4cCI6MjA4NzYwODA1MX0.'
    || 'I0hB8POnRunvGyr7XXItp8E5H70i0slG-pqxqzCOBOg';
begin
  -- Niente in coda, niente chiamata: non si paga una invocazione per nulla.
  select count(*) into v_in_coda
    from smm_jobs j
    join smm_settings s on s.brand_id = j.brand_id
   where j.stato = 'in_coda'
     and not s.stop_tutto
     and (j.agent_id is null
          or exists (select 1 from smm_agents a where a.id = j.agent_id and a.attivo));
  if v_in_coda = 0 then return; end if;

  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'smm_cron_token';
  if v_token is null then
    raise notice 'smm_sveglia_worker: manca smm_cron_token in Vault.';
    return;
  end if;

  -- Il token del cron va nel CORPO, non nell'intestazione: con verify_jwt
  -- acceso il gateway di Supabase rifiuta qualunque Authorization che non
  -- sia un JWT del progetto, e il nostro token e' una stringa casuale. Nel
  -- posto giusto c'e' la chiave pubblica, che e' un JWT valido, sta nel
  -- codice della pagina e non autorizza niente da sola: a dire che e'
  -- davvero il cron e' il token nel corpo.
  perform net.http_post(
    url     := 'https://gvdoqcgkzbziqufahhxh.supabase.co/functions/v1/smm-worker',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_anon),
    body    := jsonb_build_object('origine', 'pg_cron', 'token', v_token),
    timeout_milliseconds := 55000
  );
end $$;

comment on function smm_sveglia_worker() is
  'Chiama smm-worker se c''e'' qualcosa in coda per un agente acceso. La usa pg_cron ogni minuto.';

-- ── Ogni 5 minuti: le uscite arrivate a scadenza ────────────
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

comment on function smm_programmati_in_scadenza() is
  'Mette in coda la pubblicazione dei contenuti il cui slot e'' arrivato. I presidi di approvazione restano quelli dei trigger.';

-- ── Un tipo di lavoro nuovo ─────────────────────────────────
-- "piano" e' il lavoro con cui si chiede al Direttore di coprire la
-- settimana. Il worker lo tratta come un lavoro d'agente qualunque: il tipo
-- serve a riconoscerlo, per non chiederlo due volte nello stesso giorno e
-- per distinguerlo nello storico.

alter table smm_jobs drop constraint if exists smm_jobs_tipo_check;
alter table smm_jobs add constraint smm_jobs_tipo_check
  check (tipo in ('agente','montaggio','nota_cervello','analisi','pubblicazione','piano'));

-- ── Il conteggio della settimana, senza cancello ────────────
-- Il lavoro quotidiano gira sotto pg_cron, dove non c'e' nessun utente
-- autenticato: smm_piano_settimana() gli risponderebbe vuoto, lui
-- concluderebbe che non manca niente, e il Direttore non sarebbe chiamato
-- mai. Un silenzio, non un errore.
--
-- La tentazione era allargare smm_puo_leggere() al caso "mi chiama
-- postgres". Sbagliata, e di quelle che non si vedono: dentro una funzione
-- security definer current_user E' gia' il proprietario, cioe' postgres.
-- Quel controllo sarebbe stato vero per chiunque, e il Cervello e il piano
-- sarebbero tornati leggibili da qualunque dipendente autenticato.
--
-- Quindi si fa come col Cervello: il conteggio vero sta in una funzione
-- interna senza cancello, che nessuno puo' chiamare da fuori, e il cancello
-- resta solo sul guscio pubblico.

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

-- ── Ogni giorno: la settimana si copre da sola ──────────────
-- E' la risposta a "e la settimana chi la fa". Il piano dice quanto deve
-- uscire; questo controlla ogni mattina quanto manca e, se manca qualcosa,
-- lo dice al Direttore. Una volta al giorno e non di piu': il Direttore poi
-- smista, e il resto della catena va avanti col risveglio di ogni minuto.

alter table smm_settings
  add column if not exists piano_automatico boolean not null default true;

comment on column smm_settings.piano_automatico is
  'Se vero, ogni mattina il Direttore riceve da solo l''incarico di coprire quello che manca nel piano. Si spegne dalla Direzione.';

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
    -- Gia' chiesto oggi: non si chiede due volte.
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

comment on function smm_piano_quotidiano() is
  'Una volta al giorno incarica il Direttore di coprire quello che manca nel piano. Salta i brand con il piano automatico spento, il fermo generale alzato, o la settimana gia'' coperta.';

-- ── I tre ritmi ─────────────────────────────────────────────
do $$ begin perform cron.unschedule('smm-worker');      exception when others then null; end $$;
do $$ begin perform cron.unschedule('smm-programmati'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('smm-piano');       exception when others then null; end $$;

select cron.schedule('smm-worker',      '* * * * *',   $$select smm_sveglia_worker()$$);
select cron.schedule('smm-programmati', '*/5 * * * *', $$select smm_programmati_in_scadenza()$$);
-- 04:17 UTC sono le 08:17 a Dubai: la mattina presto, e a un minuto
-- qualunque invece che in punto, dove si accalcano tutti.
select cron.schedule('smm-piano',       '17 4 * * *',  $$select smm_piano_quotidiano()$$);

grant execute on function smm_sveglia_worker()         to service_role;
grant execute on function smm_programmati_in_scadenza() to service_role;
grant execute on function smm_piano_quotidiano()       to service_role;
