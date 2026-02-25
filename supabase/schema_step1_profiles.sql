-- ============================================================
-- STEP 1: Solo profiles table + trigger (necessario per creare utenti)
-- Esegui QUESTO per primo, poi schema.sql completo, poi seed_data.sql
-- ============================================================

-- Tipi enum (necessari per profiles)
do $$ begin
  create type user_role as enum ('admin', 'staff');
exception when duplicate_object then null; end $$;

-- Tabella profiles
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role user_role not null default 'staff',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy if not exists "Users can read own profile"
  on profiles for select using (auth.uid() = id);

create policy if not exists "Users can update own profile"
  on profiles for update using (auth.uid() = id);

create policy if not exists "Admins can read all profiles"
  on profiles for select using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- Trigger auto-create profile on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'staff')
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
