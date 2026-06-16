-- Fix: add GRANT for reconciliation tables (tables + RLS already exist)
GRANT ALL ON statement_uploads TO authenticated;
GRANT ALL ON statement_uploads TO service_role;
GRANT ALL ON parsed_transactions TO authenticated;
GRANT ALL ON parsed_transactions TO service_role;
