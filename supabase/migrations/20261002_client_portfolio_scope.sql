-- ============================================================
-- PERMESSO "CLIENTI IN GESTIONE" (portfolio per membro)
-- ============================================================
-- Aggiunge a `profiles` un ambito di visibilità sui clienti:
--   'all'      → vede tutti i clienti (comportamento attuale, default)
--   'assigned' → vede SOLO i clienti con clients.assigned_to = suo id
--
-- L'ambito è applicato via RLS sulla tabella `clients`, quindi vale
-- automaticamente per ogni pagina del portale e per ogni join
-- annidato (tasks → clients, vat_register → clients, ...), senza
-- doverlo replicare nel front-end.
-- ============================================================

alter table profiles
  add column if not exists clients_scope text not null default 'all';

do $$ begin
  alter table profiles add constraint profiles_clients_scope_chk
    check (clients_scope in ('all', 'assigned'));
exception when duplicate_object then null; end $$;

comment on column profiles.clients_scope is
  'all = vede tutti i clienti; assigned = solo quelli con clients.assigned_to = profiles.id';

-- Helper: true se l'utente corrente è limitato ai soli clienti assegnati.
-- SECURITY DEFINER per leggere `profiles` senza ricorsione di RLS.
-- Gli admin non sono mai limitati, anche se il flag venisse impostato per errore.
create or replace function public.sees_only_assigned_clients()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and clients_scope = 'assigned'
      and role <> 'admin'
  );
$$;

grant execute on function public.sees_only_assigned_clients() to authenticated;

-- Indice per il filtro per referente
create index if not exists idx_clients_assigned_to on clients(assigned_to);

-- ── RLS: SELECT ──────────────────────────────────────────────
-- Ricrea la policy esistente aggiungendo il vincolo di portfolio.
-- NB: la policy "client sees own data" resta separata (è in OR) e
-- continua a servire gli utenti del client-portal.
drop policy if exists "Authenticated users can read clients" on clients;
create policy "Authenticated users can read clients" on clients
  for select using (
    auth.role() = 'authenticated'
    and (
      not is_ambassador()
      or exists (
        select 1 from client_users cu
        where cu.client_id = clients.id and cu.user_id = auth.uid()
      )
    )
    and (
      not sees_only_assigned_clients()
      or assigned_to = auth.uid()
    )
  );

-- ── RLS: UPDATE ──────────────────────────────────────────────
-- Chi è limitato al proprio portfolio può modificare solo i suoi clienti,
-- altrimenti potrebbe aggiornare per id un cliente che non può leggere.
drop policy if exists "Authenticated users can update clients" on clients;
create policy "Authenticated users can update clients" on clients
  for update using (
    auth.role() = 'authenticated'
    and not is_ambassador()
    and (
      not sees_only_assigned_clients()
      or assigned_to = auth.uid()
    )
  );
