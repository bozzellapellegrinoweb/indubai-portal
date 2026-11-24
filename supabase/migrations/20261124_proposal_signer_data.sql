-- Dati del firmatario raccolti durante la firma della proposta.
-- tipo: 'personale' o 'aziendale'
-- dati: JSONB con i campi compilati dal cliente

CREATE TABLE IF NOT EXISTS proposal_signer_data (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id  uuid NOT NULL REFERENCES proposals(id)  ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES proposal_recipients(id) ON DELETE CASCADE,
  tipo         text NOT NULL CHECK (tipo IN ('personale', 'aziendale')),
  dati         jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz DEFAULT now(),
  UNIQUE(proposal_id, recipient_id)
);

ALTER TABLE proposal_signer_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON proposal_signer_data
  FOR ALL TO service_role USING (true) WITH CHECK (true);
