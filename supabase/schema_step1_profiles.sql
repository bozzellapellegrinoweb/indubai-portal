-- ============================================================
-- InDubai Portal — Step 1: Profiles bootstrap
-- Esegui QUESTO nel SQL Editor prima di tutto
-- ============================================================

-- Crea tipo enum (safe)
do $$ begin
  create type user_role as enum ('admin', 'staff');
exception when duplicate_object then null; end $$;

-- Crea tabella profiles
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'staff',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Abilita RLS
alter table profiles enable row level security;

-- Policy semplice
drop policy if exists "profiles_select" on profiles;
create policy "profiles_select" on profiles for select using (true);

drop policy if exists "profiles_update" on profiles;  
create policy "profiles_update" on profiles for update using (auth.uid() = id);

drop policy if exists "profiles_insert" on profiles;
create policy "profiles_insert" on profiles for insert with check (true);

-- Trigger: crea profilo automaticamente al signup
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'staff')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Aggancia trigger a auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Test: verifica che tutto sia a posto
select 'profiles table: OK' as status
where exists (
  select 1 from information_schema.tables 
  where table_schema='public' and table_name='profiles'
);

select 'trigger: OK' as status
where exists (
  select 1 from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where t.tgname = 'on_auth_user_created'
  and n.nspname = 'auth'
);
