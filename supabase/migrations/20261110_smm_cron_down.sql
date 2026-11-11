-- Rollback della pianificazione del worker.
do $$ begin perform cron.unschedule('smm-worker');      exception when others then null; end $$;
do $$ begin perform cron.unschedule('smm-programmati'); exception when others then null; end $$;
drop function if exists smm_sveglia_worker();
drop function if exists smm_programmati_in_scadenza();
