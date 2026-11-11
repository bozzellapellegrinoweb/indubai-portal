-- ============================================================
-- Rollback della Regia SMM
-- ============================================================
-- Riporta il database a prima di 20261110_smm_regia.sql e del suo seed.
-- Provato da tests/smm.test.mjs: l'ultimo test applica questo file e verifica
-- che non resti niente e che le tabelle del portale siano intatte.
--
-- CANCELLA I DATI della sezione: contenuti, versioni, note, Cervello,
-- messaggi, lavori, risultati. Prima di eseguirlo su un database vero,
-- esporta quello che vuoi tenere.
--
-- Due cose non tornano indietro da sole, e sono segnate sotto:
--  - il valore 'smm' nell'enum user_role (Postgres non sa togliere un valore);
--  - i file gia' caricati nel bucket smm-media.
-- ============================================================

-- ── Realtime ────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['smm_jobs','smm_contents','smm_messages','smm_brain']
  loop
    begin
      execute format('alter publication supabase_realtime drop table %I', t);
    exception when undefined_object or undefined_table then null;
    end;
  end loop;
end $$;

-- ── Storage ─────────────────────────────────────────────────
-- Le policy vanno via; il bucket resta se contiene ancora file, perche'
-- cancellarlo con i file dentro non e' una cosa da fare in silenzio.
drop policy if exists "smm_media_read"   on storage.objects;
drop policy if exists "smm_media_write"  on storage.objects;
drop policy if exists "smm_media_update" on storage.objects;
drop policy if exists "smm_media_delete" on storage.objects;

do $$
declare n int;
begin
  select count(*) into n from storage.objects where bucket_id = 'smm-media';
  if n = 0 then
    delete from storage.buckets where id = 'smm-media';
  else
    raise notice 'Il bucket smm-media contiene % file: non lo cancello. Svuotalo e rilancia questa riga.', n;
  end if;
end $$;

-- ── Trigger ─────────────────────────────────────────────────
drop trigger if exists trg_smm_guard_revisore      on smm_contents;
drop trigger if exists trg_smm_guard_pubblicazione on smm_contents;
drop trigger if exists trg_smm_guard_firma         on smm_contents;
drop trigger if exists trg_smm_guard_termini       on smm_contents;
drop trigger if exists trg_smm_touch_contents      on smm_contents;
drop trigger if exists trg_smm_log_contents        on smm_contents;
drop trigger if exists trg_smm_touch_jobs          on smm_jobs;
drop trigger if exists trg_smm_log_jobs            on smm_jobs;
drop trigger if exists trg_smm_touch_agents        on smm_agents;
drop trigger if exists trg_smm_log_brain           on smm_brain;
drop trigger if exists trg_smm_nota_cervello       on smm_notes;

-- ── Vista ───────────────────────────────────────────────────
drop view if exists smm_media_da_pulire;

-- ── Tabelle: in ordine inverso di dipendenza ────────────────
drop table if exists smm_results         cascade;
drop table if exists smm_media           cascade;
drop table if exists smm_messages        cascade;
drop table if exists smm_notes           cascade;
drop table if exists smm_content_versions cascade;
drop table if exists smm_jobs            cascade;
drop table if exists smm_contents        cascade;
drop table if exists smm_brain           cascade;
drop table if exists smm_agents          cascade;
drop table if exists smm_settings        cascade;
drop table if exists smm_brands          cascade;

-- ── Funzioni ────────────────────────────────────────────────
drop function if exists smm_claim_job()                              cascade;
drop function if exists smm_cervello_cerca(uuid, text, text[], int)   cascade;
drop function if exists smm_budget_residuo(uuid)                      cascade;
drop function if exists smm_termini_vietati(text)                     cascade;
drop function if exists smm_guard_revisore()                          cascade;
drop function if exists smm_guard_pubblicazione()                     cascade;
drop function if exists smm_guard_firma_approvazione()                cascade;
drop function if exists smm_guard_termini()                           cascade;
drop function if exists smm_nota_nel_cervello()                       cascade;
drop function if exists smm_log_attivita()                            cascade;
drop function if exists smm_touch()                                   cascade;
drop function if exists can_see_smm()                                 cascade;
drop function if exists smm_default_roles()                           cascade;

-- smm_testo_pubblico prende smm_contents come parametro, quindi e' gia'
-- caduta con il drop della tabella. La riga sta qui per chi legge il file
-- cercando l'elenco completo, e non fa danni se la funzione non c'e' piu'.
do $$ begin
  execute 'drop function if exists smm_testo_pubblico(smm_contents) cascade';
exception when undefined_table or undefined_function then null; end $$;

-- ── Il ruolo ────────────────────────────────────────────────
-- Postgres non sa togliere un valore da un enum: si ricrea il tipo. Lo faccio
-- solo se nessuno sta usando il ruolo, perche' altrimenti vorrebbe dire
-- decidere al posto dell'amministratore cosa diventa quella persona.
do $$
declare n int;
begin
  select count(*) into n from profiles where role::text = 'smm';
  if n > 0 then
    raise notice 'Ci sono % profili con ruolo smm: lascio il valore nell''enum. Cambia il loro ruolo e rilancia se vuoi toglierlo.', n;
    return;
  end if;

  -- role_permissions.role e' testo, non enum: la riga si cancella comunque
  delete from role_permissions where role = 'smm';

  alter type user_role rename to user_role_old;
  create type user_role as enum
    ('admin','staff','mini_admin','senior','junior','client','ambassador',
     'commerciale','collaborator');
  alter table profiles
    alter column role drop default,
    alter column role type user_role using role::text::user_role,
    alter column role set default 'staff';
  drop type user_role_old;
exception
  when others then
    raise notice 'Non ho potuto togliere il valore smm dall''enum: %. Il resto del rollback e'' andato a buon fine.', sqlerrm;
end $$;
