-- ============================================================
-- Group Cashflow Dashboard — Schema + Seed
-- ============================================================

-- Conti bancari del gruppo
create table if not exists finance_accounts (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  entity        text not null,
  iban          text,
  currency      text not null,
  parser        text not null,
  created_at    timestamptz default now()
);

-- Ogni upload mensile = un batch
create table if not exists finance_batches (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid references finance_accounts(id),
  period_start  date,
  period_end    date,
  source_file   text,
  uploaded_at   timestamptz default now(),
  status        text default 'parsed'
);

-- Transazioni normalizzate
create table if not exists finance_transactions (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid references finance_batches(id) on delete cascade,
  account_id    uuid references finance_accounts(id),
  txn_date      date not null,
  value_date    date,
  description   text,
  counterparty  text,
  amount        numeric not null,
  currency      text not null,
  amount_aed    numeric,
  tx_type       text,
  ref_number    text,
  notes         text,
  category      text,
  is_internal   boolean default false,
  category_locked boolean default false,
  raw           jsonb,
  unique (account_id, ref_number)
);

-- Tassi di cambio mensili
create table if not exists finance_fx_rates (
  currency      text not null,
  month         date not null,
  rate_to_aed   numeric not null,
  primary key (currency, month)
);

-- Regole di classificazione
create table if not exists finance_rules (
  id            uuid primary key default gen_random_uuid(),
  priority      int not null,
  match_field   text not null,
  match_op      text not null,
  match_value   text not null,
  set_category  text not null,
  set_internal  boolean default false,
  active        boolean default true
);

-- Controparti interne (partite di giro)
create table if not exists finance_internal_parties (
  id            uuid primary key default gen_random_uuid(),
  name_pattern  text not null,
  note          text
);

-- Parametri gestionali
create table if not exists finance_settings (
  id                    int primary key default 1,
  owner_base_salary_aed numeric default 30000,
  buffer_target_months  numeric default 3,
  cogs_alert_pct        numeric default 0.58
);

-- ============================================================
-- RLS
-- ============================================================
alter table finance_accounts enable row level security;
alter table finance_batches enable row level security;
alter table finance_transactions enable row level security;
alter table finance_fx_rates enable row level security;
alter table finance_rules enable row level security;
alter table finance_internal_parties enable row level security;
alter table finance_settings enable row level security;

-- Admin-only policies (role = admin in profiles)
create policy "finance_accounts_admin" on finance_accounts for all
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

create policy "finance_batches_admin" on finance_batches for all
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

create policy "finance_transactions_admin" on finance_transactions for all
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

create policy "finance_fx_rates_admin" on finance_fx_rates for all
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

create policy "finance_rules_admin" on finance_rules for all
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

create policy "finance_internal_parties_admin" on finance_internal_parties for all
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

create policy "finance_settings_admin" on finance_settings for all
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- ============================================================
-- Seed data
-- ============================================================

-- Accounts
insert into finance_accounts (label, entity, currency, parser) values
  ('Full Digital Wio AED', 'Full Digital FZCO', 'AED', 'wio_csv'),
  ('PB TAX FAB AED', 'PB TAX DMCC', 'AED', 'fab_pdf')
on conflict do nothing;

-- FX rates (default)
insert into finance_fx_rates (currency, month, rate_to_aed) values
  ('EUR', '2024-01-01', 3.99),
  ('EUR', '2024-02-01', 3.99),
  ('EUR', '2024-03-01', 3.99),
  ('EUR', '2024-04-01', 3.99),
  ('EUR', '2024-05-01', 3.99),
  ('EUR', '2024-06-01', 3.99),
  ('EUR', '2024-07-01', 3.99),
  ('EUR', '2024-08-01', 3.99),
  ('EUR', '2024-09-01', 3.99),
  ('EUR', '2024-10-01', 3.99),
  ('EUR', '2024-11-01', 3.99),
  ('EUR', '2024-12-01', 3.99),
  ('EUR', '2025-01-01', 3.99),
  ('EUR', '2025-02-01', 3.99),
  ('EUR', '2025-03-01', 3.99),
  ('EUR', '2025-04-01', 3.99),
  ('EUR', '2025-05-01', 3.99),
  ('EUR', '2025-06-01', 3.99),
  ('EUR', '2025-07-01', 3.99),
  ('EUR', '2025-08-01', 3.99),
  ('EUR', '2025-09-01', 3.99),
  ('EUR', '2025-10-01', 3.99),
  ('EUR', '2025-11-01', 3.99),
  ('EUR', '2025-12-01', 3.99),
  ('EUR', '2026-01-01', 3.99),
  ('EUR', '2026-02-01', 3.99),
  ('EUR', '2026-03-01', 3.99),
  ('EUR', '2026-04-01', 3.99),
  ('EUR', '2026-05-01', 3.99),
  ('EUR', '2026-06-01', 3.99),
  ('EUR', '2026-07-01', 3.99),
  ('EUR', '2026-08-01', 3.99),
  ('EUR', '2026-09-01', 3.99),
  ('EUR', '2026-10-01', 3.99),
  ('EUR', '2026-11-01', 3.99),
  ('EUR', '2026-12-01', 3.99),
  ('USD', '2024-01-01', 3.673),
  ('USD', '2024-02-01', 3.673),
  ('USD', '2024-03-01', 3.673),
  ('USD', '2024-04-01', 3.673),
  ('USD', '2024-05-01', 3.673),
  ('USD', '2024-06-01', 3.673),
  ('USD', '2024-07-01', 3.673),
  ('USD', '2024-08-01', 3.673),
  ('USD', '2024-09-01', 3.673),
  ('USD', '2024-10-01', 3.673),
  ('USD', '2024-11-01', 3.673),
  ('USD', '2024-12-01', 3.673),
  ('USD', '2025-01-01', 3.673),
  ('USD', '2025-02-01', 3.673),
  ('USD', '2025-03-01', 3.673),
  ('USD', '2025-04-01', 3.673),
  ('USD', '2025-05-01', 3.673),
  ('USD', '2025-06-01', 3.673),
  ('USD', '2025-07-01', 3.673),
  ('USD', '2025-08-01', 3.673),
  ('USD', '2025-09-01', 3.673),
  ('USD', '2025-10-01', 3.673),
  ('USD', '2025-11-01', 3.673),
  ('USD', '2025-12-01', 3.673),
  ('USD', '2026-01-01', 3.673),
  ('USD', '2026-02-01', 3.673),
  ('USD', '2026-03-01', 3.673),
  ('USD', '2026-04-01', 3.673),
  ('USD', '2026-05-01', 3.673),
  ('USD', '2026-06-01', 3.673),
  ('USD', '2026-07-01', 3.673),
  ('USD', '2026-08-01', 3.673),
  ('USD', '2026-09-01', 3.673),
  ('USD', '2026-10-01', 3.673),
  ('USD', '2026-11-01', 3.673),
  ('USD', '2026-12-01', 3.673)
on conflict do nothing;

-- Internal parties
insert into finance_internal_parties (name_pattern, note) values
  ('sara tufo', 'Moglie — round-trip stipendio/fattura, impatto netto 0')
on conflict do nothing;

-- Classification rules (priority order)
insert into finance_rules (priority, match_field, match_op, match_value, set_category, set_internal) values
  -- 1. FX sweeps
  (100, 'tx_type', 'equals', 'Currency exchange', 'fx_sweep', true),
  -- 3. Owner draws
  (300, 'counterparty', 'contains', 'pellegrino bozzella', 'owner_draw', false),
  -- 4. Staff salaries
  (400, 'counterparty', 'contains', 'maria mercedes claps', 'salary', false),
  (401, 'counterparty', 'contains', 'ayoub rafia', 'salary', false),
  -- 5. COGS / service providers
  (500, 'counterparty', 'contains', 'ifza', 'cogs', false),
  (501, 'counterparty', 'contains', 'the vat consultant', 'cogs', false),
  (502, 'counterparty', 'contains', 'vat consultant', 'cogs', false),
  (503, 'counterparty', 'contains', 'al nadra', 'cogs', false),
  (504, 'counterparty', 'contains', 'freezoner', 'cogs', false),
  (505, 'counterparty', 'contains', 'trivup', 'cogs', false),
  (506, 'counterparty', 'contains', 'affinitas', 'cogs', false),
  (507, 'counterparty', 'contains', 'roll04', 'cogs', false),
  (508, 'counterparty', 'contains', 'vitals', 'cogs', false),
  (509, 'counterparty', 'contains', 'sobusiness', 'cogs', false),
  (510, 'counterparty', 'contains', 'zama', 'cogs', false),
  (511, 'counterparty', 'contains', 'digital offerte', 'cogs', false),
  (512, 'counterparty', 'contains', 'giuseppe muscetti', 'cogs', false),
  (513, 'counterparty', 'contains', 'leo srl', 'cogs', false),
  (514, 'counterparty', 'contains', 'oasis', 'cogs', false),
  -- 6. Debt repayment
  (600, 'description', 'contains', 'credit repayment', 'debt_repayment', false),
  (601, 'description', 'contains', 'autopay', 'debt_repayment', false),
  -- 7. Fees
  (700, 'tx_type', 'equals', 'Fees', 'fees', false)
on conflict do nothing;

-- Settings
insert into finance_settings (id, owner_base_salary_aed, buffer_target_months, cogs_alert_pct)
values (1, 30000, 3, 0.58)
on conflict (id) do nothing;

-- ============================================================
-- Monthly summary view
-- ============================================================
create or replace view finance_monthly_summary as
with base as (
  select
    date_trunc('month', txn_date)::date as month,
    category,
    sum(amount_aed) as total_aed
  from finance_transactions
  where is_internal = false
  group by 1, 2
),
p as (
  select
    month,
    coalesce(sum(total_aed) filter (where category = 'revenue'), 0) as revenue,
    -coalesce(sum(total_aed) filter (where category = 'cogs'), 0) as cogs,
    -coalesce(sum(total_aed) filter (where category = 'salary'), 0) as salaries,
    -coalesce(sum(total_aed) filter (where category = 'debt_repayment'), 0) as debt,
    -coalesce(sum(total_aed) filter (where category = 'fees'), 0) as fees,
    -coalesce(sum(total_aed) filter (where category = 'other'), 0) as other_costs,
    -coalesce(sum(total_aed) filter (where category = 'owner_draw'), 0) as owner_draw_total
  from base group by month
)
select
  month,
  revenue,
  cogs,
  salaries,
  debt,
  fees,
  other_costs,
  owner_draw_total,
  (revenue - cogs - salaries - debt - fees - other_costs) as operating_cash,
  (select owner_base_salary_aed from finance_settings where id = 1) as owner_base,
  (revenue - cogs - salaries - debt - fees - other_costs)
    - (select owner_base_salary_aed from finance_settings where id = 1) as real_surplus,
  greatest(owner_draw_total
    - (select owner_base_salary_aed from finance_settings where id = 1), 0) as owner_allowance,
  ((revenue - cogs - salaries - debt - fees - other_costs)
    - owner_draw_total) as net_flow,
  case when revenue > 0 then cogs / revenue end as cogs_pct
from p
order by month;

-- Grant table access to authenticated (RLS policies restrict to admin)
grant all on finance_accounts to authenticated;
grant all on finance_batches to authenticated;
grant all on finance_transactions to authenticated;
grant all on finance_fx_rates to authenticated;
grant all on finance_rules to authenticated;
grant all on finance_internal_parties to authenticated;
grant all on finance_settings to authenticated;

-- Grant access to the view
grant select on finance_monthly_summary to authenticated;
