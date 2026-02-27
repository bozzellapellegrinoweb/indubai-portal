CREATE TABLE IF NOT EXISTS zoho_snapshots (
  client_id        UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  rolling12_aed    NUMERIC,
  total_billed_aed NUMERIC,
  total_unpaid_aed NUMERIC,
  vat_status       TEXT CHECK (vat_status IN ('ok','warning','exceeded')),
  year             INTEGER,
  count_invoices   INTEGER,
  count_overdue    INTEGER,
  org_currency     TEXT DEFAULT 'AED'
);

ALTER TABLE clients ADD COLUMN IF NOT EXISTS license_issue_date DATE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ct_tracker_done BOOLEAN DEFAULT FALSE;

ALTER TABLE zoho_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Staff read snapshots" ON zoho_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY IF NOT EXISTS "Service write snapshots" ON zoho_snapshots FOR ALL TO service_role USING (true);
