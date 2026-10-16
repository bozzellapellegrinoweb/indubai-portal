-- ============================================================
-- Documenti clienti: ognuno vede solo i propri
-- ============================================================
-- Prima di questa migrazione:
--   - client_files aveva la policy "rls_client_files" FOR ALL USING (true):
--     qualunque utente autenticato, compresi clienti e ambassador, leggeva,
--     modificava e cancellava i metadati dei file di TUTTI i clienti;
--   - il bucket client-documents dava lettura, scrittura e cancellazione a
--     qualunque utente autenticato: un cliente poteva elencare e scaricare i
--     documenti degli altri clienti.
--
-- Dopo:
--   - lo staff (is_portal_staff()) fa tutto, come prima;
--   - il cliente legge solo i file del proprio cliente (client_users), come
--     gia' prevedeva la policy "client sees own files";
--   - nessun accesso per ambassador o altri ruoli esterni.
--
-- I percorsi nel bucket sono "<client_id>/<cartella>/<file>" (documents.html):
-- il primo segmento e' il cliente, ed e' su quello che si filtra.
-- Le pagine dello staff (documents.html, client-detail.html) e l'area clienti
-- (client-portal/dashboard.html) continuano a funzionare senza modifiche.
-- ============================================================

-- ── client_files ────────────────────────────────────────────
drop policy if exists "rls_client_files" on client_files;
drop policy if exists "Authenticated can manage files" on client_files;

drop policy if exists "client_files_staff_all" on client_files;
create policy "client_files_staff_all" on client_files
  for all to authenticated
  using (is_portal_staff())
  with check (is_portal_staff());

-- "client sees own files" resta com'e': SELECT sui file del proprio cliente.

-- ── storage: bucket client-documents ────────────────────────
drop policy if exists "auth_read"   on storage.objects;
drop policy if exists "auth_upload" on storage.objects;
drop policy if exists "auth_update" on storage.objects;
drop policy if exists "auth_delete" on storage.objects;
drop policy if exists "Authenticated users can upload" on storage.objects;
drop policy if exists "Authenticated users can read"   on storage.objects;
drop policy if exists "Authenticated users can update" on storage.objects;
drop policy if exists "Authenticated users can delete" on storage.objects;

drop policy if exists "client_documents_staff_all" on storage.objects;
create policy "client_documents_staff_all" on storage.objects
  for all to authenticated
  using (bucket_id = 'client-documents' and public.is_portal_staff())
  with check (bucket_id = 'client-documents' and public.is_portal_staff());

drop policy if exists "client_documents_client_read" on storage.objects;
create policy "client_documents_client_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] in (
      select cu.client_id::text from public.client_users cu where cu.user_id = auth.uid()
    )
  );

-- ── storage: bucket expense-receipts ────────────────────────
-- Stessa apertura ("auth read expense-receipts": qualunque autenticato).
-- Gli scontrini li carica e li legge la function client-expense con la
-- service role; dal portale li apre solo lo staff.
drop policy if exists "auth read expense-receipts" on storage.objects;
drop policy if exists "expense_receipts_staff_read" on storage.objects;
create policy "expense_receipts_staff_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'expense-receipts' and public.is_portal_staff());
