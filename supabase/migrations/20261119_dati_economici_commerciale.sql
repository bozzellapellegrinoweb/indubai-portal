-- ============================================================
-- I dati economici fuori dalla portata del commerciale
-- ============================================================
-- sees_financials() esisteva gia' da ottobre, ed esclude per definizione il
-- ruolo 'commerciale' oltre a chi ha can_see_financials = false. Ma la usava
-- solo subscription_payments: estratti conto, transazioni e dati economici
-- dei clienti erano "using (true)", leggibili da chiunque fosse autenticato.
--
-- Senza questo, un commerciale avrebbe letto dall'API esattamente i numeri
-- che l'interfaccia gli nasconde. Nascondere una colonna non protegge niente.
--
-- L'area clienti non usa statement_uploads ne' parsed_transactions, quindi
-- li si puo' riservare allo staff. Su client_financials la policy del cliente
-- ("client sees own") resta intatta.
--
-- Resta fuori 'bilanci': la legge anche l'area clienti, e stringerla richiede
-- prima capire come i bilanci sono legati al cliente.
-- ============================================================

alter policy "Authenticated users can read statement_uploads" on statement_uploads
  using (is_portal_staff() and sees_financials());
alter policy "Authenticated users can insert statement_uploads" on statement_uploads
  with check (is_portal_staff() and sees_financials());
alter policy "Authenticated users can update statement_uploads" on statement_uploads
  using (is_portal_staff() and sees_financials());
alter policy "Authenticated users can delete statement_uploads" on statement_uploads
  using (is_portal_staff() and sees_financials());

alter policy "Authenticated users can read parsed_transactions" on parsed_transactions
  using (is_portal_staff() and sees_financials());
alter policy "Authenticated users can insert parsed_transactions" on parsed_transactions
  with check (is_portal_staff() and sees_financials());
alter policy "Authenticated users can update parsed_transactions" on parsed_transactions
  using (is_portal_staff() and sees_financials());
alter policy "Authenticated users can delete parsed_transactions" on parsed_transactions
  using (is_portal_staff() and sees_financials());

alter policy "rls_client_financials" on client_financials
  using (is_portal_staff() and sees_financials())
  with check (is_portal_staff() and sees_financials());

-- Questa dava accesso ad admin, senior, junior e mini_admin comunque,
-- scavalcando l'interruttore per persona.
alter policy "staff full access" on client_financials
  using (sees_financials() and exists (
    select 1 from profiles
     where profiles.id = auth.uid()
       and profiles.role = any (array['admin','senior','junior','mini_admin']::user_role[])))
  with check (sees_financials() and exists (
    select 1 from profiles
     where profiles.id = auth.uid()
       and profiles.role = any (array['admin','senior','junior','mini_admin']::user_role[])));
