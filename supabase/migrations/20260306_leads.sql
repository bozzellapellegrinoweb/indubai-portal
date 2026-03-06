-- Tabella leads
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  last_seen TIMESTAMPTZ,
  last_chat JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabella attività lead
CREATE TABLE IF NOT EXISTS lead_activity (
  id BIGSERIAL PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  visited_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_activity ENABLE ROW LEVEL SECURITY;

-- Policy: il lead vede solo sé stesso
CREATE POLICY "lead_self" ON leads
  FOR ALL USING (auth.uid() = id);

-- Policy: il lead inserisce la propria attività
CREATE POLICY "lead_activity_insert" ON lead_activity
  FOR INSERT WITH CHECK (auth.uid() = lead_id);

-- Policy: admin/admin-mini vedono tutto (usa service_role da Edge Function)
-- Per accesso admin usa service_role key direttamente

-- Index per query admin
CREATE INDEX IF NOT EXISTS idx_lead_activity_lead_id ON lead_activity(lead_id);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);
