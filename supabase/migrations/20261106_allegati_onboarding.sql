-- ============================================================
-- Allegati dell'onboarding testamento: tipi accettati e perimetro
-- ============================================================
-- Il modulo di raccolta dati ora accetta i documenti direttamente, invece di
-- chiederli sul gruppo WhatsApp. Prima di aprirlo ai clienti serviva mettere
-- a posto due cose nel bucket dove finiscono.
-- ============================================================

-- ── 1. Tipi di file accettati ───────────────────────────────
-- Mancavano le foto iPhone (HEIC/HEIF), le GIF e le scansioni TIFF/BMP: un
-- cliente che fotografa il passaporto con un iPhone si vedeva rifiutare il
-- file senza capire perche'. Il modulo deduce il tipo dall'estensione quando
-- il browser non lo sa dire, perche' senza Content-Type lo storage rifiuta.
update storage.buckets
   set allowed_mime_types = array[
     'application/pdf',
     'image/jpeg','image/png','image/webp','image/heic','image/heif',
     'image/gif','image/tiff','image/bmp',
     'application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.ms-excel',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'text/plain','application/rtf','application/zip'
   ]
 where id = 'client-documents';

-- ── 2. Il perimetro ─────────────────────────────────────────
-- Le quattro policy su client-documents dicevano solo "bucket_id =
-- client-documents" per chiunque fosse autenticato: un cliente con un
-- accesso al portale poteva leggere, sovrascrivere e CANCELLARE i documenti
-- di tutti gli altri clienti. Con l'onboarding che invita i clienti a
-- caricare passaporti e atti di proprieta', non si poteva lasciare cosi'.
--
-- Ora: lo staff vede tutto, il cliente solo la propria cartella, e modifica
-- o cancella soltanto cio' che ha caricato lui (owner = auth.uid()).
alter policy "auth_read" on storage.objects
  using (
    bucket_id = 'client-documents' and (
      is_portal_staff()
      or (storage.foldername(name))[1] in (
           select cu.client_id::text from client_users cu where cu.user_id = auth.uid())
    )
  );

alter policy "auth_upload" on storage.objects
  with check (
    bucket_id = 'client-documents' and (
      is_portal_staff()
      or (storage.foldername(name))[1] in (
           select cu.client_id::text from client_users cu where cu.user_id = auth.uid())
    )
  );

alter policy "auth_update" on storage.objects
  using (
    bucket_id = 'client-documents' and (
      is_portal_staff()
      or (owner = auth.uid() and (storage.foldername(name))[1] in (
           select cu.client_id::text from client_users cu where cu.user_id = auth.uid()))
    )
  );

alter policy "auth_delete" on storage.objects
  using (
    bucket_id = 'client-documents' and (
      is_portal_staff()
      or (owner = auth.uid() and (storage.foldername(name))[1] in (
           select cu.client_id::text from client_users cu where cu.user_id = auth.uid()))
    )
  );

-- Lo stesso valeva per l'elenco dei file, dove la policy era
-- "for all to authenticated using (true)".
alter policy "rls_client_files" on client_files
  using (
    is_portal_staff()
    or client_id in (select cu.client_id from client_users cu where cu.user_id = auth.uid())
  )
  with check (
    is_portal_staff()
    or client_id in (select cu.client_id from client_users cu where cu.user_id = auth.uid())
  );

-- ── 3. I due strumenti in Link Utili ────────────────────────
-- C'era solo il preventivo: l'onboarding dopo il pagamento non si trovava.
update useful_links
   set titolo = 'Testamento — Preventivo',
       descrizione = 'Prima della firma: il cliente compila e vede la stima. È lui ad aprirla dal suo portale.',
       posizione = 0
 where url = 'https://portal.indubai.it/client-portal/testamento.html';

insert into useful_links (titolo, url, descrizione, categoria, posizione) values
  ('Testamento — Onboarding',
   'https://portal.indubai.it/client-portal/testamento-onboarding.html',
   'Dopo la firma e il pagamento: raccolta dati e documenti, senza prezzi. Si apre solo per i clienti a cui hai attivato la raccolta dalla scheda cliente.',
   'Strumenti', 1),
  ('Testamenti — elenco pratiche',
   '/testamento.html',
   'Tutte le consulenze e gli onboarding in corso, con lo stato e i documenti allegati.',
   'Aree del portale', 0)
on conflict do nothing;
