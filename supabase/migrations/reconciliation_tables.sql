-- ============================================================
-- Reconciliation System Tables
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Statement uploads (raw files)
CREATE TABLE IF NOT EXISTS statement_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  source TEXT NOT NULL DEFAULT 'bank',
  bank_name TEXT,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size BIGINT,
  mime_type TEXT,
  status TEXT DEFAULT 'uploaded',
  transaction_count INTEGER DEFAULT 0,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Parsed transactions
CREATE TABLE IF NOT EXISTS parsed_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES statement_uploads(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tx_date DATE NOT NULL,
  description TEXT,
  reference TEXT,
  debit NUMERIC(15,2) DEFAULT 0,
  credit NUMERIC(15,2) DEFAULT 0,
  balance NUMERIC(15,2),
  currency TEXT DEFAULT 'AED',
  match_status TEXT DEFAULT 'pending',
  match_confidence NUMERIC(3,2),
  matched_entity_type TEXT,
  matched_entity_id TEXT,
  matched_description TEXT,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  category TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parsed_tx_upload ON parsed_transactions(upload_id);
CREATE INDEX IF NOT EXISTS idx_parsed_tx_client ON parsed_transactions(client_id);
CREATE INDEX IF NOT EXISTS idx_parsed_tx_status ON parsed_transactions(match_status);
CREATE INDEX IF NOT EXISTS idx_stmt_uploads_client ON statement_uploads(client_id);

-- 3. RLS Policies
ALTER TABLE statement_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE parsed_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read statement_uploads"
  ON statement_uploads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert statement_uploads"
  ON statement_uploads FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update statement_uploads"
  ON statement_uploads FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete statement_uploads"
  ON statement_uploads FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read parsed_transactions"
  ON parsed_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert parsed_transactions"
  ON parsed_transactions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update parsed_transactions"
  ON parsed_transactions FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete parsed_transactions"
  ON parsed_transactions FOR DELETE TO authenticated USING (true);

-- 4. GRANTs
GRANT SELECT, INSERT, UPDATE, DELETE ON statement_uploads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON parsed_transactions TO authenticated;
