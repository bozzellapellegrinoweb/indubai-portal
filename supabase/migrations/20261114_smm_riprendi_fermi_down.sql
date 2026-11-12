-- Annulla 20261114_smm_riprendi_fermi.sql.
do $$ begin perform cron.unschedule('smm-fermi'); exception when others then null; end $$;
drop function if exists smm_riprendi_fermi();
