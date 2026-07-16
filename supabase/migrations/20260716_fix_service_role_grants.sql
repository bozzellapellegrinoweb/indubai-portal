-- Fix: service_role non aveva i GRANT su profiles, subscription_payments, vat_register.
-- Effetto: notify-deadlines (cron) falliva in silenzio su questi controlli dal 30/6/2026
-- (getStaffEmails legge da profiles; checkVatDeadlines legge vat_register;
--  checkPaymentsFailed legge subscription_payments; checkTasksDue fa join su profiles).
--
-- Da eseguire manualmente su Supabase (SQL Editor) se non applicata automaticamente
-- dalla pipeline di migrazioni: la REST API con service_role key è bloccata dallo
-- stesso problema di permessi, quindi non puo' auto-applicarsi.

grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.subscription_payments to service_role;
grant select, insert, update, delete on public.vat_register to service_role;
