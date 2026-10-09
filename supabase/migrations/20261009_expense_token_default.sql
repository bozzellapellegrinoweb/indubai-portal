-- ============================================================
-- LINK SPESE PER CLIENTE — token sempre presente
--
-- La migrazione 20260813_client_expenses.sql genera expense_token una volta
-- sola, per i clienti che esistevano allora. I clienti creati dopo restavano
-- senza: per loro il link /expense-app/?t=<token> non era costruibile.
--
-- Qui riempiamo i mancanti e mettiamo un DEFAULT, cosi' ogni nuovo cliente
-- nasce gia' col suo link, da qualunque strada venga creato (portale, form
-- ambassador, MCP).
-- ============================================================

update clients
   set expense_token = encode(gen_random_bytes(24), 'hex')
 where expense_token is null;

alter table clients
  alter column expense_token set default encode(gen_random_bytes(24), 'hex');

comment on column clients.expense_token is
  'Credenziale del link /expense-app/?t=<token>: chi ce l''ha carica spese per questo cliente. Rigenerabile dalla scheda cliente, tab Accesso Cliente.';
