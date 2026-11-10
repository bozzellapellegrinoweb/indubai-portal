-- ============================================================
-- Banco di prova per la migrazione della Regia
-- ============================================================
-- Ricostruisce il minimo del portale che la migrazione presuppone, su un
-- Postgres vuoto: gli schemi auth e storage, i ruoli, le tabelle e le
-- funzioni che gia' esistono in produzione. Serve a provare la migrazione e i
-- presidi senza toccare il database vero.
--
-- Non e' un clone del portale: e' lo stretto necessario perche' la
-- migrazione giri e perche' i test possano impersonare un utente.
-- ============================================================

create extension if not exists "uuid-ossp";
create schema if not exists extensions;
create extension if not exists pg_trgm  with schema extensions;
create extension if not exists unaccent with schema extensions;

-- uuid_generate_v4 va cercata senza schema, come su Supabase
create or replace function public.uuid_generate_v4() returns uuid
language sql volatile as $$ select gen_random_uuid() $$;

-- ── Ruoli di Supabase ───────────────────────────────────────
do $$ begin create role authenticated;  exception when duplicate_object then null; end $$;
do $$ begin create role service_role;   exception when duplicate_object then null; end $$;
do $$ begin create role anon;           exception when duplicate_object then null; end $$;
grant usage on schema public, extensions to authenticated, service_role, anon;

-- ── Finto schema auth ───────────────────────────────────────
-- Su Supabase auth.uid() legge il JWT. Qui legge una variabile di sessione,
-- cosi' un test puo' dire "ora sono questo utente".
create schema if not exists auth;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('test.role', true), ''), 'authenticated')
$$;

grant usage on schema auth to authenticated, service_role, anon;
grant execute on function auth.uid(), auth.role() to authenticated, service_role, anon;

-- ── Tabelle del portale che la migrazione referenzia ────────
do $$ begin
  create type user_role as enum
    ('admin','staff','mini_admin','senior','junior','client','ambassador',
     'commerciale','collaborator');
exception when duplicate_object then null; end $$;

create table if not exists profiles (
  id                 uuid primary key,
  full_name          text,
  role               user_role not null default 'staff',
  tasks_scope        text not null default 'all',
  can_see_financials boolean not null default true,
  created_at         timestamptz not null default now()
);

create table if not exists clients (
  id uuid primary key default uuid_generate_v4(),
  company_name text
);

create table if not exists role_permissions (
  role          text primary key,
  allowed_pages text[] not null default '{}'
);

create table if not exists activity_log (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references profiles(id),
  client_id  uuid references clients(id),
  action     text not null,
  details    jsonb,
  created_at timestamptz not null default now()
);

grant select, insert on activity_log to authenticated;
grant all on activity_log to service_role;

create table if not exists notifications (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null,
  type        text not null,
  title       text not null,
  body        text,
  link        text,
  entity_type text,
  entity_id   uuid,
  read        boolean default false,
  created_at  timestamptz not null default now()
);

-- ── Funzioni di perimetro che esistono gia' ─────────────────
create or replace function is_portal_admin() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function is_portal_staff() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from profiles where id = auth.uid()
                  and role not in ('client','ambassador'));
$$;

-- ── Finto storage ───────────────────────────────────────────
create schema if not exists storage;

create table if not exists storage.buckets (
  id              text primary key,
  name            text not null,
  public          boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at      timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default uuid_generate_v4(),
  bucket_id  text references storage.buckets(id),
  name       text not null,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant all on storage.objects, storage.buckets to service_role;

-- ── Publication del realtime ────────────────────────────────
do $$ begin
  create publication supabase_realtime;
exception when duplicate_object then null; end $$;
