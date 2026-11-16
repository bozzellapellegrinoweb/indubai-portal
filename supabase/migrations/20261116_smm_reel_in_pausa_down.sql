-- Annulla 20261116_smm_reel_in_pausa.sql: i reel ripartono.
--
-- Rimette la riga di piano, riaccende l'agente Video, toglie i reel dai
-- tipi fermi e libera i giorni dei caroselli. Non ridà una data ai reel
-- che erano in calendario: si riapprovano, e la data la prendono da soli.

update smm_settings
   set tipi_fermi = array_remove(tipi_fermi, 'reel'), updated_at = now()
 where brand_id in (select id from smm_brands);

update smm_piano set attivo = true, updated_at = now()
 where tipo = 'reel';

update smm_piano set giorni = '{}', updated_at = now()
 where tipo = 'carosello';

update smm_agents set attivo = true, updated_at = now()
 where slug = 'video';
