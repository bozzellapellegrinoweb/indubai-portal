-- Storage bucket per i documenti clienti
-- Esegui nel SQL Editor di Supabase

-- 1. Crea il bucket (se non esiste già)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'client-documents',
  'client-documents', 
  false,
  52428800, -- 50MB max per file
  ARRAY['application/pdf','image/jpeg','image/png','image/webp','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain','application/zip']
)
ON CONFLICT (id) DO NOTHING;

-- 2. Policy: utenti autenticati possono fare tutto
CREATE POLICY "Authenticated users can upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'client-documents');

CREATE POLICY "Authenticated users can read"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'client-documents');

CREATE POLICY "Authenticated users can update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'client-documents');

CREATE POLICY "Authenticated users can delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'client-documents');

-- 3. Tabella metadata per file (nome, note, tags)
CREATE TABLE IF NOT EXISTS client_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE,  -- path in Supabase storage
  display_name TEXT NOT NULL,          -- nome visualizzato (rinominabile)
  original_name TEXT NOT NULL,         -- nome originale al caricamento
  file_size BIGINT,
  mime_type TEXT,
  folder TEXT DEFAULT '/',             -- cartella virtuale
  notes TEXT,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE client_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage files"
ON client_files FOR ALL
TO authenticated
USING (true) WITH CHECK (true);

CREATE INDEX idx_client_files_client ON client_files(client_id);
CREATE INDEX idx_client_files_folder ON client_files(client_id, folder);
