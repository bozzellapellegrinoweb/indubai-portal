-- ============================================================
-- SPESE CLIENTI: fattura -> Bill, scontrino -> Expense
--
-- Una fattura fornitore con TRN in Zoho sta in Purchases > Bills: e' da li'
-- che l'IVA a credito entra nel VAT return come input tax. Prima finiva tutto
-- in Expenses, e l'IVA letta dal documento veniva salvata ma mai registrata.
--
-- Vedi supabase/functions/expense-zoho/index.ts
-- ============================================================

-- Numero del documento del fornitore: diventa il bill_number su Zoho.
alter table client_expenses add column if not exists invoice_number     text;

-- Cosa e' stato creato davvero su Zoho, e con che esito.
alter table client_expenses add column if not exists zoho_doc_type      text;   -- 'bill' | 'expense'
alter table client_expenses add column if not exists zoho_bill_id       text;
alter table client_expenses add column if not exists zoho_vendor_id     text;
alter table client_expenses add column if not exists tax_applied        boolean;
alter table client_expenses add column if not exists post_notes         text;   -- cosa e' successo in registrazione

-- Riaddebito: lo decide chi approva, non chi carica.
alter table client_expenses add column if not exists is_billable        boolean not null default false;
alter table client_expenses add column if not exists zoho_customer_id   text;
alter table client_expenses add column if not exists zoho_customer_name text;

comment on column client_expenses.post_notes is
  'Cosa e'' successo registrando su Zoho (fornitore creato, IVA non applicata, allegato fallito). Prima questi casi passavano in silenzio.';

-- Id del pagamento registrato sulla Bill: quello che il cliente carica l'ha
-- gia' pagato, quindi la Bill nasce pagata. L'id serve ad annullare anche il
-- pagamento quando si disfa la registrazione, altrimenti resterebbe appeso
-- come acconto al fornitore.
alter table client_expenses add column if not exists zoho_payment_id text;
