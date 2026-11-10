-- ============================================================
-- Il worker viene svegliato anche da solo
-- ============================================================
-- La Regia chiama smm-worker dal browser appena si crea un lavoro, cosi' la
-- scena si muove subito. Ma se il manager chiude la pagina, o se un agente
-- ne coinvolge un altro mentre nessuno guarda, quel lavoro resterebbe in
-- coda. Quindi pg_cron lo sveglia ogni minuto.
--
-- Questo file sta separato dalla migrazione principale per un motivo
-- pratico: ha bisogno di pg_net e di un segreto, e in un ambiente dove uno
-- dei due manca deve poter essere saltato senza bloccare tutto il resto.
--
-- PRIMA DI ESEGUIRLO servono due cose, da fare una volta:
--
--  1. il segreto CRON_SECRET fra i segreti delle Edge Function;
--  2. la stessa stringa dentro Vault, cosi' il cron la legge senza che
--     finisca scritta in chiaro in una definizione di job visibile a
--     chiunque possa leggere cron.job:
--
--       select vault.create_secret('<la-stringa>', 'smm_cron_secret');
--       select vault.create_secret('https://<ref>.supabase.co', 'smm_functions_url');
--
-- Reversibile: 20261110_smm_cron_down.sql toglie il job.
-- ============================================================

create extension if not exists pg_net with schema extensions;

-- Sveglia il worker. Non attende la risposta: pg_net lavora in background e
-- il cron non deve restare appeso a una chiamata HTTP.
create or replace function smm_sveglia_worker() returns void
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare
  v_url     text;
  v_segreto text;
  v_in_coda int;
begin
  -- Niente in coda, niente chiamata: non si paga una invocazione per nulla.
  select count(*) into v_in_coda
    from smm_jobs j
    join smm_settings s on s.brand_id = j.brand_id
   where j.stato = 'in_coda'
     and not s.stop_tutto;
  if v_in_coda = 0 then return; end if;

  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'smm_functions_url';
  select decrypted_secret into v_segreto
    from vault.decrypted_secrets where name = 'smm_cron_secret';

  if v_url is null or v_segreto is null then
    raise notice 'smm_sveglia_worker: manca smm_functions_url o smm_cron_secret in Vault. Non chiamo niente.';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/functions/v1/smm-worker',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_segreto),
    body    := jsonb_build_object('origine', 'pg_cron'),
    timeout_milliseconds := 60000
  );
end $$;

comment on function smm_sveglia_worker() is
  'Chiama smm-worker se c''e'' qualcosa in coda. La usa pg_cron ogni minuto.';

-- Un solo job, ricreato se esiste: cosi' il file si puo' rieseguire.
do $$
begin
  perform cron.unschedule('smm-worker');
exception when others then null;
end $$;

select cron.schedule('smm-worker', '* * * * *', $$select smm_sveglia_worker()$$);

-- ── Pubblicazione dei contenuti programmati ─────────────────
-- Un contenuto messo in calendario per domani alle 18 non si pubblica da
-- solo: qualcuno deve accorgersi che e' arrivata l'ora. Qui si crea il
-- lavoro, e il resto segue la strada normale, presidi compresi.
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
       -- non duplicare un lavoro di pubblicazione gia' in corso
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

do $$
begin
  perform cron.unschedule('smm-programmati');
exception when others then null;
end $$;

-- Ogni cinque minuti: la precisione al minuto non serve a un post social,
-- e un controllo ogni minuto su questa query sarebbe sprecato.
select cron.schedule('smm-programmati', '*/5 * * * *',
                     $$select smm_programmati_in_scadenza()$$);

grant execute on function smm_sveglia_worker()        to service_role;
grant execute on function smm_programmati_in_scadenza() to service_role;
