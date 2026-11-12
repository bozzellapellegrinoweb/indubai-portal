-- Torna indietro: chi era scartato torna respinto, e lo stato sparisce.
update smm_contents set stato = 'respinto' where stato = 'scartato';

alter table smm_contents drop constraint if exists smm_contents_stato_check;
alter table smm_contents add constraint smm_contents_stato_check
  check (stato in ('idea','in_lavorazione','da_revisione','respinto',
                   'da_approvare','approvato','in_calendario',
                   'programmato','pubblicato'));

drop function if exists smm_scarta(uuid, text);
