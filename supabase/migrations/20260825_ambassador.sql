-- ============================================================
-- InDubai Portal — Sistema Ambassador
-- ============================================================
-- Additiva e non distruttiva. Eseguibile piu' volte.
--
-- Flusso:
--   1. Admin crea l'ambassador dal portale -> account + email credenziali
--   2. L'ambassador condivide il suo link /r/<ref_code>
--   3. La lead compila il form -> ambassador_referrals + clients (Non assegnati)
--   4. Il cliente entra nella fase "Cliente ha pagato" (is_won = true)
--      -> ambassador_commissions + email all'ambassador
-- ============================================================

-- Nuovo ruolo. ALTER TYPE ... ADD VALUE non puo' stare in un blocco DO/transazione:
-- va eseguito come statement a se' stante (Postgres 12+).
alter type user_role add value if not exists 'ambassador';

-- ============================================================
-- CATALOGO SERVIZI + COMMISSIONI
-- ============================================================

create table if not exists ambassador_services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price_aed numeric(12,2),                       -- prezzo indicativo del servizio (AED)
  commission_type text not null default 'fixed', -- 'fixed' = importo | 'percent' = % sul valore deal
  commission_value numeric(12,2) not null default 0,
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

do $$ begin
  alter table ambassador_services
    add constraint ambassador_services_commission_type_chk
    check (commission_type in ('fixed', 'percent'));
exception when duplicate_object then null; end $$;

-- ============================================================
-- AMBASSADOR
-- ============================================================

create table if not exists ambassadors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null,
  email text not null,
  phone text,
  instagram text,
  ref_code text not null unique,                 -- usato nel link pubblico /r/<ref_code>
  status text not null default 'active',         -- 'active' | 'paused' | 'disabled'
  commission_multiplier numeric(5,2) not null default 1,  -- 1 = standard, 1.20 = +20%
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table ambassadors
    add constraint ambassadors_status_chk
    check (status in ('active', 'paused', 'disabled'));
exception when duplicate_object then null; end $$;

create index if not exists idx_ambassadors_user on ambassadors(user_id);
create index if not exists idx_ambassadors_ref_code on ambassadors(ref_code);

-- ============================================================
-- SEGNALAZIONI (LEAD)
-- ============================================================

create table if not exists ambassador_referrals (
  id uuid primary key default gen_random_uuid(),
  ambassador_id uuid not null references ambassadors(id) on delete cascade,
  service_id uuid references ambassador_services(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  full_name text not null,
  email text not null,
  phone text,
  message text,
  status text not null default 'nuovo',          -- nuovo|contattato|in_trattativa|cliente|perso
  source text not null default 'form',
  created_at timestamptz not null default now(),
  converted_at timestamptz
);

do $$ begin
  alter table ambassador_referrals
    add constraint ambassador_referrals_status_chk
    check (status in ('nuovo', 'contattato', 'in_trattativa', 'cliente', 'perso'));
exception when duplicate_object then null; end $$;

create index if not exists idx_ambassador_referrals_amb on ambassador_referrals(ambassador_id);
create index if not exists idx_ambassador_referrals_client on ambassador_referrals(client_id);

-- ============================================================
-- COMMISSIONI
-- ============================================================

create table if not exists ambassador_commissions (
  id uuid primary key default gen_random_uuid(),
  ambassador_id uuid not null references ambassadors(id) on delete cascade,
  referral_id uuid unique references ambassador_referrals(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  service_id uuid references ambassador_services(id) on delete set null,
  service_name text not null,                    -- snapshot: il catalogo puo' cambiare
  deal_amount_aed numeric(12,2),
  commission_amount_aed numeric(12,2) not null default 0,
  status text not null default 'maturata',       -- maturata|pagata|annullata
  earned_at timestamptz not null default now(),
  paid_at timestamptz,
  notes text
);

do $$ begin
  alter table ambassador_commissions
    add constraint ambassador_commissions_status_chk
    check (status in ('maturata', 'pagata', 'annullata'));
exception when duplicate_object then null; end $$;

create index if not exists idx_ambassador_commissions_amb on ambassador_commissions(ambassador_id);

-- ============================================================
-- AGGANCIO ALLA PIPELINE ESISTENTE
-- ============================================================

-- Il cliente porta con se' chi l'ha segnalato: serve per l'etichetta in pipeline
-- e per generare la commissione quando entra nella fase "vinta".
alter table clients add column if not exists ambassador_id uuid
  references ambassadors(id) on delete set null;
alter table clients add column if not exists ambassador_referral_id uuid
  references ambassador_referrals(id) on delete set null;
create index if not exists idx_clients_ambassador on clients(ambassador_id);

-- Quale fase della pipeline vale come "cliente ha pagato" (genera la commissione).
alter table pipeline_stages add column if not exists is_won boolean not null default false;
update pipeline_stages set is_won = true
  where is_won = false and lower(name) like '%ha pagato%';

-- ============================================================
-- HELPER RLS (security definer: bypassano le policy delle tabelle lette)
-- ============================================================

create or replace function public.current_ambassador_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from ambassadors where user_id = auth.uid() limit 1;
$$;

create or replace function public.is_ambassador()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from ambassadors where user_id = auth.uid());
$$;

create or replace function public.is_portal_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role::text not in ('client', 'ambassador')
  );
$$;

grant execute on function public.current_ambassador_id() to authenticated;
grant execute on function public.is_ambassador() to authenticated;
grant execute on function public.is_portal_staff() to authenticated;

-- ============================================================
-- RLS
-- ============================================================

alter table ambassador_services enable row level security;
alter table ambassadors enable row level security;
alter table ambassador_referrals enable row level security;
alter table ambassador_commissions enable row level security;

-- Catalogo servizi: lo leggono tutti gli autenticati (l'ambassador deve vedere
-- quanto guadagna), lo modifica solo lo staff.
drop policy if exists "read ambassador_services" on ambassador_services;
create policy "read ambassador_services" on ambassador_services
  for select using (auth.role() = 'authenticated');
drop policy if exists "staff write ambassador_services" on ambassador_services;
create policy "staff write ambassador_services" on ambassador_services
  for all using (is_portal_staff()) with check (is_portal_staff());

-- Anagrafica ambassador: ognuno vede solo se stesso, lo staff vede tutti.
drop policy if exists "read ambassadors" on ambassadors;
create policy "read ambassadors" on ambassadors
  for select using (is_portal_staff() or id = current_ambassador_id());
drop policy if exists "staff write ambassadors" on ambassadors;
create policy "staff write ambassadors" on ambassadors
  for all using (is_portal_staff()) with check (is_portal_staff());

-- Segnalazioni: l'ambassador vede solo le proprie (in sola lettura: entrano
-- dal form pubblico via service_role, le gestisce lo staff).
drop policy if exists "read ambassador_referrals" on ambassador_referrals;
create policy "read ambassador_referrals" on ambassador_referrals
  for select using (is_portal_staff() or ambassador_id = current_ambassador_id());
drop policy if exists "staff write ambassador_referrals" on ambassador_referrals;
create policy "staff write ambassador_referrals" on ambassador_referrals
  for all using (is_portal_staff()) with check (is_portal_staff());

-- Commissioni: stessa logica.
drop policy if exists "read ambassador_commissions" on ambassador_commissions;
create policy "read ambassador_commissions" on ambassador_commissions
  for select using (is_portal_staff() or ambassador_id = current_ambassador_id());
drop policy if exists "staff write ambassador_commissions" on ambassador_commissions;
create policy "staff write ambassador_commissions" on ambassador_commissions
  for all using (is_portal_staff()) with check (is_portal_staff());

-- Le policy RLS da sole non bastano: senza GRANT arriva "permission denied".
grant select on public.ambassador_services to authenticated;
grant insert, update, delete on public.ambassador_services to authenticated;
grant select, insert, update, delete on public.ambassadors to authenticated;
grant select, insert, update, delete on public.ambassador_referrals to authenticated;
grant select, insert, update, delete on public.ambassador_commissions to authenticated;
grant select, insert, update, delete on public.ambassador_services,
      public.ambassadors, public.ambassador_referrals,
      public.ambassador_commissions to service_role;

-- Difesa in profondita': il ruolo anon non deve toccare queste tabelle.
-- Il form pubblico scrive solo tramite /api/ambassador-lead (service role).
revoke all on public.ambassadors            from anon;
revoke all on public.ambassador_referrals   from anon;
revoke all on public.ambassador_commissions from anon;
revoke all on public.ambassador_services    from anon;

-- ============================================================
-- CHIUSURA FALLA: l'ambassador e' un utente "authenticated" come lo staff.
-- Senza questo, con la sola anon key potrebbe leggere l'intera tabella clients.
-- ============================================================

drop policy if exists "Authenticated users can read clients" on clients;
create policy "Authenticated users can read clients" on clients
  for select using (auth.role() = 'authenticated' and not is_ambassador());

drop policy if exists "Authenticated users can insert clients" on clients;
create policy "Authenticated users can insert clients" on clients
  for insert with check (auth.role() = 'authenticated' and not is_ambassador());

drop policy if exists "Authenticated users can update clients" on clients;
create policy "Authenticated users can update clients" on clients
  for update using (auth.role() = 'authenticated' and not is_ambassador());

-- L'ambassador vede solo il proprio profilo, non la rubrica dello staff.
drop policy if exists "Users can view all profiles" on profiles;
create policy "Users can view all profiles" on profiles
  for select using (
    auth.role() = 'authenticated' and (not is_ambassador() or id = auth.uid())
  );

-- ============================================================
-- EVENTI NOTIFICA (pannello Impostazioni Notifiche)
-- ============================================================

insert into notification_settings (event_type, label, category, audience, position) values
  ('ambassador_new_referral',   'Nuova segnalazione da un ambassador',   'Ambassador', 'staff', 100),
  ('ambassador_referral_ack',   'Conferma segnalazione all''ambassador', 'Ambassador', 'user',  101),
  ('ambassador_lead_ack',       'Conferma ricezione alla lead',          'Ambassador', 'client',102),
  ('ambassador_commission',     'Commissione maturata (ambassador)',     'Ambassador', 'user',  103),
  ('ambassador_commission_paid','Commissione pagata (ambassador)',       'Ambassador', 'user',  104),
  ('ambassador_welcome',        'Credenziali di accesso all''ambassador','Ambassador', 'user',  105)
on conflict (event_type) do nothing;

update notification_settings set roles = null
  where event_type in ('ambassador_referral_ack', 'ambassador_lead_ack',
                       'ambassador_commission', 'ambassador_commission_paid',
                       'ambassador_welcome');

-- ============================================================
-- SEED CATALOGO — NUMERI DI ESEMPIO, DA RITARARE DAL PORTALE
-- ============================================================

insert into ambassador_services (name, description, price_aed, commission_type, commission_value, position)
select v.name, v.description, v.price_aed, v.commission_type, v.commission_value, v.position
from (values
  ('Apertura società Free Zone',
   'Costituzione società in Free Zone, licenza commerciale e establishment card.',
   18500.00, 'fixed',   2500.00, 1),
  ('Visto investitore + Emirates ID',
   'Pratica visto investitore/partner, medical, Emirates ID e residenza.',
   12000.00, 'fixed',   1500.00, 2),
  ('Contabilità e VAT (annuale)',
   'Abbonamento annuale contabilità, registrazione VAT e dichiarazioni.',
   14400.00, 'percent',    10.00, 3),
  ('Apertura conto bancario aziendale',
   'Assistenza completa all''apertura del conto business presso banca UAE.',
   7500.00,  'fixed',    900.00, 4)
) as v(name, description, price_aed, commission_type, commission_value, position)
where not exists (select 1 from ambassador_services);

-- ============================================================
-- VISTA RIEPILOGO (usata dalla pagina admin)
-- ============================================================

-- security_invoker: la view rispetta le RLS di chi la interroga (Postgres 15+),
-- altrimenti un ambassador vedrebbe i dati di tutti gli altri.
create or replace view ambassador_summary with (security_invoker = true) as
select
  a.id,
  a.full_name,
  a.email,
  a.ref_code,
  a.status,
  a.user_id,
  a.created_at,
  coalesce(r.total_referrals, 0)              as total_referrals,
  coalesce(r.won_referrals, 0)                as won_referrals,
  coalesce(c.earned_aed, 0)                   as earned_aed,
  coalesce(c.paid_aed, 0)                     as paid_aed,
  coalesce(c.earned_aed, 0) - coalesce(c.paid_aed, 0) as due_aed
from ambassadors a
left join (
  select ambassador_id,
         count(*)                                          as total_referrals,
         count(*) filter (where status = 'cliente')         as won_referrals
  from ambassador_referrals group by ambassador_id
) r on r.ambassador_id = a.id
left join (
  select ambassador_id,
         sum(commission_amount_aed) filter (where status <> 'annullata') as earned_aed,
         sum(commission_amount_aed) filter (where status = 'pagata')     as paid_aed
  from ambassador_commissions group by ambassador_id
) c on c.ambassador_id = a.id;

grant select on public.ambassador_summary to authenticated;
revoke all on public.ambassador_summary from anon;
