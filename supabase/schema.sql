-- ============================================================
-- InDubai Portal — Supabase Schema
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- ENUM TYPES
-- ============================================================

do $$ begin create type user_role as enum ('admin', 'staff'); exception when duplicate_object then null; end $$;
do $$ begin create type subscription_status as enum ('ok', 'failed', 'no_tentativo', 'pending', 'manual', 'annual'); exception when duplicate_object then null; end $$;
do $$ begin create type partner_type as enum ('noi', 'vat_consultant', 'affinitas', 'in_sospeso', 'altro'); exception when duplicate_object then null; end $$;
do $$ begin create type onboarding_source as enum ('pellegrino', 'giuseppe'); exception when duplicate_object then null; end $$;

-- ============================================================
-- PROFILES (extends Supabase auth.users)
-- ============================================================

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role user_role not null default 'staff',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

drop policy if exists "Users can view all profiles" on profiles;
create policy "Users can view all profiles" on profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists "Users can update own profile" on profiles;
create policy "Users can update own profile" on profiles
  for update using (auth.uid() = id);

drop policy if exists "Admins can manage all profiles" on profiles;
create policy "Admins can manage all profiles" on profiles
  for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================================
-- CLIENTS (master anagrafica)
-- ============================================================

create table if not exists clients (
  id uuid primary key default uuid_generate_v4(),

  -- Identità
  company_name text not null,           -- es. "AARNIKO CONSULTING FZCO"
  contact_name text,                    -- es. "Felice La Forza"
  email text,
  phone_uae text,                       -- Numero UAE verificato
  whatsapp_group_created boolean default false,

  -- Referente interno
  source onboarding_source,             -- chi ha acquisito il cliente
  assigned_to uuid references profiles(id),

  -- Abbonamento
  service_cost numeric(10,2),           -- AED
  start_date date,
  subscription_day integer,             -- giorno del mese addebito (1-31)

  -- Contabilità
  accounting_partner partner_type,      -- chi gestisce la contabilità
  bank_accounts text[],                 -- es. ['wio', 'stripe', 'paypal']
  bank_notes text,                      -- note sui conti bancari

  -- Licenza / Corporate
  trade_license_date date,
  corporate_tax_registered boolean default false,
  corporate_tax_expiry date,
  eid_verified boolean default false,

  -- VAT
  vat_registered boolean default false,
  vat_partner partner_type,

  -- Status
  is_active boolean default true,
  in_bilancio boolean default true,     -- false = tab "No bilancio"
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table clients enable row level security;

drop policy if exists "Authenticated users can read clients" on clients;
create policy "Authenticated users can read clients" on clients
  for select using (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can insert clients" on clients;
create policy "Authenticated users can insert clients" on clients
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can update clients" on clients;
create policy "Authenticated users can update clients" on clients
  for update using (auth.role() = 'authenticated');

drop policy if exists "Only admins can delete clients" on clients;
create policy "Only admins can delete clients" on clients
  for delete using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================================
-- ONBOARDING CHECKLIST
-- ============================================================

create table if not exists onboarding_checklist (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references clients(id) on delete cascade,

  -- Step checklist
  whatsapp_group boolean default false,
  call_scheduled boolean default false,
  call_date date,
  docs_in_drive boolean default false,
  eid_verified boolean default false,
  uae_phone_verified boolean default false,
  corporate_tax_check boolean default false,
  fta_profile_created boolean default false,
  ct_registration_done boolean default false,
  payment_link_sent boolean default false,
  bank_accounts_noted boolean default false,

  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(client_id)
);

alter table onboarding_checklist enable row level security;
drop policy if exists "Authenticated users full access onboarding" on onboarding_checklist;
create policy "Authenticated users full access onboarding" on onboarding_checklist
  for all using (auth.role() = 'authenticated');

-- ============================================================
-- BANK STATEMENTS (Estratti conto)
-- ============================================================

create table if not exists bank_statements (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references clients(id) on delete cascade,
  year integer not null,
  month integer not null check (month between 1 and 12),

  received boolean default false,       -- estratto mandato dal cliente
  registered boolean default false,     -- registrazione completata
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(client_id, year, month)
);

alter table bank_statements enable row level security;
drop policy if exists "Authenticated users full access bank_statements" on bank_statements;
create policy "Authenticated users full access bank_statements" on bank_statements
  for all using (auth.role() = 'authenticated');

-- ============================================================
-- SUBSCRIPTION PAYMENTS (Pagamenti mensili abbonamento)
-- ============================================================

create table if not exists subscription_payments (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references clients(id) on delete cascade,
  year integer not null,
  month integer not null check (month between 1 and 12),

  status subscription_status default 'pending',
  amount numeric(10,2),
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(client_id, year, month)
);

alter table subscription_payments enable row level security;
drop policy if exists "Authenticated users full access subscription_payments" on subscription_payments;
create policy "Authenticated users full access subscription_payments" on subscription_payments
  for all using (auth.role() = 'authenticated');

-- ============================================================
-- VAT REGISTER
-- ============================================================

create table if not exists vat_register (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references clients(id) on delete cascade,

  accounting_partner partner_type,
  application_date date,
  approval_date date,

  -- Scadenze return (fino a 4 per anno)
  return_deadline_1 date,
  return_deadline_2 date,
  return_deadline_3 date,
  return_deadline_4 date,

  -- Pagamenti
  payment_to_studio text,               -- testo libero (es. "18sep", data, "-")
  payment_vat text,                     -- testo libero

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(client_id)
);

alter table vat_register enable row level security;
drop policy if exists "Authenticated users full access vat_register" on vat_register;
create policy "Authenticated users full access vat_register" on vat_register
  for all using (auth.role() = 'authenticated');

-- ============================================================
-- CORPORATE TAX
-- ============================================================

create table if not exists corporate_tax (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references clients(id) on delete cascade,

  deadline text,                        -- testo libero (es. "fine febbraio", date)
  application_submitted date,
  approval_date date,
  month_group text,                     -- es. "GENNAIO", "FEBBRAIO" (raggruppamento Excel)
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table corporate_tax enable row level security;
drop policy if exists "Authenticated users full access corporate_tax" on corporate_tax;
create policy "Authenticated users full access corporate_tax" on corporate_tax
  for all using (auth.role() = 'authenticated');

-- ============================================================
-- BILANCIO MENSILE (tab Bilancio)
-- ============================================================

create table if not exists monthly_balance (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references clients(id) on delete cascade,
  year integer not null,
  month integer not null check (month between 1 and 12),

  bank_statements_received boolean default false,
  paid_to_us numeric(10,2),
  paid_to_vat numeric(10,2),
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(client_id, year, month)
);

alter table monthly_balance enable row level security;
drop policy if exists "Authenticated users full access monthly_balance" on monthly_balance;
create policy "Authenticated users full access monthly_balance" on monthly_balance
  for all using (auth.role() = 'authenticated');

-- ============================================================
-- AFFINITAS SUBSCRIPTIONS (tab Abbonati affinitas)
-- ============================================================

create table if not exists affinitas_subscriptions (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id),
  subscription_ref text,               -- es. "#6635"
  company_name text,                   -- nome su affinitas (può differire)
  package text,
  amount_aed numeric(10,2),
  status text default 'Active',
  start_date date,
  next_payment date,
  last_order_date date,
  orders_count integer,
  notes text,
  in_segreteria boolean default true,  -- "No in gestione segreteria"

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table affinitas_subscriptions enable row level security;
drop policy if exists "Authenticated users full access affinitas" on affinitas_subscriptions;
create policy "Authenticated users full access affinitas" on affinitas_subscriptions
  for all using (auth.role() = 'authenticated');

-- ============================================================
-- ACTIVITY LOG (audit trail)
-- ============================================================

create table if not exists activity_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references profiles(id),
  client_id uuid references clients(id),
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

alter table activity_log enable row level security;
drop policy if exists "Authenticated users can read log" on activity_log;
create policy "Authenticated users can read log" on activity_log
  for select using (auth.role() = 'authenticated');
drop policy if exists "Authenticated users can insert log" on activity_log;
create policy "Authenticated users can insert log" on activity_log
  for insert with check (auth.role() = 'authenticated');

-- ============================================================
-- TRIGGERS: updated_at automatico
-- ============================================================

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_clients_updated_at on clients;
create trigger trg_clients_updated_at before update on clients
  for each row execute function update_updated_at();
drop trigger if exists trg_profiles_updated_at on profiles;
create trigger trg_profiles_updated_at before update on profiles
  for each row execute function update_updated_at();
drop trigger if exists trg_onboarding_updated_at on onboarding_checklist;
create trigger trg_onboarding_updated_at before update on onboarding_checklist
  for each row execute function update_updated_at();
drop trigger if exists trg_bank_stmt_updated_at on bank_statements;
create trigger trg_bank_stmt_updated_at before update on bank_statements
  for each row execute function update_updated_at();
drop trigger if exists trg_sub_pay_updated_at on subscription_payments;
create trigger trg_sub_pay_updated_at before update on subscription_payments
  for each row execute function update_updated_at();
drop trigger if exists trg_vat_updated_at on vat_register;
create trigger trg_vat_updated_at before update on vat_register
  for each row execute function update_updated_at();
drop trigger if exists trg_ct_updated_at on corporate_tax;
create trigger trg_ct_updated_at before update on corporate_tax
  for each row execute function update_updated_at();
drop trigger if exists trg_balance_updated_at on monthly_balance;
create trigger trg_balance_updated_at before update on monthly_balance
  for each row execute function update_updated_at();
drop trigger if exists trg_affinitas_updated_at on affinitas_subscriptions;
create trigger trg_affinitas_updated_at before update on affinitas_subscriptions
  for each row execute function update_updated_at();

-- ============================================================
-- TRIGGER: auto-create profile on signup
-- ============================================================

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'staff')
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- TRIGGER: auto-create onboarding checklist on new client
-- ============================================================

create or replace function handle_new_client()
returns trigger as $$
begin
  insert into onboarding_checklist (client_id) values (new.id);
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_new_client_onboarding on clients;
create trigger trg_new_client_onboarding after insert on clients
  for each row execute function handle_new_client();

-- ============================================================
-- VIEWS UTILI
-- ============================================================

-- Vista: dashboard KPIs per il mese corrente
create or replace view dashboard_current_month as
select
  (select count(*) from clients where is_active = true) as total_active_clients,
  (select count(*) from clients where is_active = true and in_bilancio = true) as clients_in_bilancio,
  (
    select count(*) from bank_statements bs
    join clients c on c.id = bs.client_id
    where c.is_active = true
      and c.in_bilancio = true
      and bs.year = extract(year from current_date)
      and bs.month = extract(month from current_date)
      and bs.received = false
  ) as bank_statements_missing,
  (
    select count(*) from subscription_payments sp
    join clients c on c.id = sp.client_id
    where c.is_active = true
      and sp.year = extract(year from current_date)
      and sp.month = extract(month from current_date)
      and sp.status in ('failed', 'no_tentativo', 'pending')
  ) as subscriptions_issue,
  (
    select count(*) from vat_register vr
    join clients c on c.id = vr.client_id
    where c.is_active = true
      and (
        vr.return_deadline_1 between current_date and current_date + interval '30 days'
        or vr.return_deadline_2 between current_date and current_date + interval '30 days'
        or vr.return_deadline_3 between current_date and current_date + interval '30 days'
        or vr.return_deadline_4 between current_date and current_date + interval '30 days'
      )
  ) as vat_deadlines_next_30_days;

-- Vista: clienti con subscription status del mese corrente
create or replace view clients_subscription_status as
select
  c.id,
  c.company_name,
  c.contact_name,
  c.accounting_partner,
  c.service_cost,
  c.subscription_day,
  sp.status as current_month_status,
  sp.notes as payment_notes,
  c.is_active
from clients c
left join subscription_payments sp on sp.client_id = c.id
  and sp.year = extract(year from current_date)
  and sp.month = extract(month from current_date)
where c.is_active = true;

-- Vista: clienti con estratti mancanti nel mese corrente
create or replace view clients_missing_bank_statements as
select
  c.id,
  c.company_name,
  c.contact_name,
  c.bank_accounts,
  bs.received,
  bs.registered
from clients c
left join bank_statements bs on bs.client_id = c.id
  and bs.year = extract(year from current_date)
  and bs.month = extract(month from current_date)
where c.is_active = true
  and c.in_bilancio = true
  and (bs.received is null or bs.received = false);

-- ============================================================
-- INDEXES per performance
-- ============================================================

create index if not exists idx_clients_company_name on clients(company_name);
create index if not exists idx_clients_is_active on clients(is_active);
create index if not exists idx_bank_stmt_client_year_month on bank_statements(client_id, year, month);
create index if not exists idx_sub_pay_client_year_month on subscription_payments(client_id, year, month);
create index if not exists idx_sub_pay_status on subscription_payments(status);
create index if not exists idx_vat_deadlines on vat_register(return_deadline_1, return_deadline_2, return_deadline_3, return_deadline_4);
create index if not exists idx_activity_log_client on activity_log(client_id);
create index if not exists idx_activity_log_user on activity_log(user_id);
