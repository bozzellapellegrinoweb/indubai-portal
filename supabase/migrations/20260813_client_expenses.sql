-- "Spese Indubai": upload scontrini dal cliente → coda spese → (Fase 2) Zoho.
-- Tutto additivo, non tocca tabelle/flap esistenti.

create extension if not exists pgcrypto;

-- Token univoco per cliente per il link "Spese Indubai" (senza login)
alter table clients add column if not exists expense_token text;
update clients set expense_token = encode(gen_random_bytes(24), 'hex') where expense_token is null;
create unique index if not exists uq_clients_expense_token on clients(expense_token) where expense_token is not null;

-- Spese caricate dai clienti in attesa di approvazione
create table if not exists client_expenses (
  id uuid primary key default gen_random_uuid(),
  client_id  uuid references clients(id) on delete cascade,
  zoho_org_id text,
  storage_path text,
  mime_type    text,
  vendor       text,
  expense_date date,
  amount       numeric(12,2),
  currency     text,
  vat_amount   numeric(12,2),
  ai_raw       jsonb,
  paid_with    text,
  note         text,
  status       text not null default 'pending',   -- pending|approved|posted|rejected|error
  category_account_id     text,
  category_name           text,
  paid_through_account_id text,
  zoho_expense_id text,
  error_msg    text,
  approved_by  uuid references profiles(id),
  approved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_client_expenses_status on client_expenses(status);
create index if not exists idx_client_expenses_client on client_expenses(client_id);

alter table client_expenses enable row level security;
drop policy if exists "auth read client_expenses" on client_expenses;
create policy "auth read client_expenses" on client_expenses for select using (auth.role() = 'authenticated');
drop policy if exists "auth update client_expenses" on client_expenses;
create policy "auth update client_expenses" on client_expenses for update using (auth.role() = 'authenticated');
drop policy if exists "auth delete client_expenses" on client_expenses;
create policy "auth delete client_expenses" on client_expenses for delete using (auth.role() = 'authenticated');

grant select, insert, update, delete on public.client_expenses to authenticated;
grant select, insert, update, delete on public.client_expenses to service_role;

-- Bucket storage per gli scontrini (upload lato service_role, lettura staff autenticato)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expense-receipts','expense-receipts', false, 15728640,
        array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do nothing;

drop policy if exists "auth read expense-receipts" on storage.objects;
create policy "auth read expense-receipts" on storage.objects
  for select using (bucket_id = 'expense-receipts' and auth.role() = 'authenticated');

-- Notifica staff: nuovo scontrino da approvare
insert into notification_settings (event_type, label, category, audience, position, roles) values
  ('expense_uploaded', 'Nuovo scontrino da approvare', 'Spese', 'staff', 25, '{admin,senior,mini_admin,junior}')
on conflict (event_type) do nothing;
