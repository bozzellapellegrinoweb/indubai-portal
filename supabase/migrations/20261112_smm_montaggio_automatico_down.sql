-- Annulla 20261112_smm_montaggio_automatico.sql.
drop trigger if exists trg_smm_monta_quando_pronto on smm_contents;
drop function if exists smm_monta_quando_pronto();
