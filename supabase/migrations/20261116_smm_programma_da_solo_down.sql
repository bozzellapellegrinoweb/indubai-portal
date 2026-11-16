-- Annulla 20261116_smm_programma_da_solo.sql.
--
-- Torna a due gesti: approvare mette il contenuto in "approvato" e basta,
-- e il calendario lo riempie una persona trascinando.
--
-- Nota: i contenuti che nel frattempo sono finiti in calendario ci restano,
-- con la loro data. Non c'e' modo di sapere quali ci siano arrivati da soli
-- e quali trascinati a mano, e cancellare le date di tutti sarebbe peggio
-- del male: si perderebbe anche la programmazione fatta a mano.

drop trigger if exists trg_smm_zz_programma on smm_contents;
drop function if exists smm_programma_approvato();
drop function if exists smm_prossimo_slot(smm_contents, date);

alter table smm_settings drop column if exists ora_uscita;
