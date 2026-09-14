-- ============================================================
-- Ambassador — attribuzione manuale e cancellazione sicura
-- ============================================================
-- Additiva e ri-eseguibile.
--
-- 1. Un cliente inserito a mano può essere collegato a un ambassador. Per
--    farlo si crea comunque una riga in ambassador_referrals (source
--    'manuale'): così commissioni, idempotenza e area riservata funzionano
--    esattamente come per le segnalazioni arrivate dal link.
-- 2. Chi viene attribuito a mano può non avere una email: il campo diventa
--    facoltativo.
-- 3. Rete di sicurezza sull'idempotenza: ambassador_commissions.referral_id è
--    UNIQUE, ma in Postgres più NULL non collidono. Senza questo indice un
--    cliente senza segnalazione collegata potrebbe generare due commissioni.
-- ============================================================

alter table ambassador_referrals alter column email drop not null;

create unique index if not exists uq_ambassador_commissions_client_no_referral
  on ambassador_commissions (client_id)
  where referral_id is null;

comment on column ambassador_referrals.source is
  'form = modulo pubblico /r/<codice> · manuale = attribuzione fatta dallo staff dal portale';
