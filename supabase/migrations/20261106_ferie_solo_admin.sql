-- ============================================================
-- Le ferie le approva solo l'admin
-- ============================================================
-- L'interfaccia mostrava i pulsanti Approva e Rifiuta solo all'admin, ma
-- sotto non c'era niente che lo imponesse:
--
--   lr_update:  for update to authenticated using (true)
--
-- Chiunque avesse un accesso al portale poteva approvare o rifiutare
-- qualunque richiesta chiamando PostgREST dal browser, senza passare
-- dall'API. Martina e Mercedes sono dipendenti con ruolo 'senior': potevano
-- approvare le proprie ferie.
--
-- Accanto esisteva gia' "Admin aggiorna tutte le richieste", corretta, ma le
-- policy permissive si sommano in OR: quella piu' larga vinceva sempre.
--
-- Lo stesso vale nell'API: api/leave-requests.js trattava come amministratori
-- anche 'senior' e 'mini_admin'. Ora solo 'admin'.
-- ============================================================

alter policy "lr_update" on leave_requests
  using (is_portal_admin())
  with check (is_portal_admin());

-- Le ferie del personale non riguardano i clienti ne' gli ambassador, che
-- sono anche loro 'authenticated': lr_read diceva "true".
alter policy "lr_read" on leave_requests
  using (is_portal_staff());

-- Non c'e' nessuna policy di DELETE su leave_requests, e va bene cosi':
-- senza policy la cancellazione diretta e' negata a tutti, e l'unica strada
-- resta l'API, che ora la riserva all'admin.
