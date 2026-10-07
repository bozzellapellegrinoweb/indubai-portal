-- ============================================================
-- MCP Server — token personali, audit trail, query read-only
-- Server: /api/mcp  (vedi MCP.md)
-- ============================================================

create extension if not exists "pgcrypto";

-- ============================================================
-- MCP TOKENS
-- Un token = un utente del portale. Il ruolo del profilo decide
-- quali tool vede e cosa puo' fare: nessun permesso nuovo.
-- ============================================================

create table if not exists mcp_tokens (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id) on delete cascade,
  name          text not null,                       -- es. "Claude desktop - Pellegrino"
  token_hash    text not null unique,                -- sha256 hex del token in chiaro
  token_prefix  text not null,                       -- primi caratteri, per riconoscerlo in lista
  scope         text not null default 'all',         -- bundle di tool (vedi SCOPES in api/_mcp-tools.js)
  can_write     boolean not null default false,      -- false = solo lettura, qualunque sia il ruolo
  allowed_tools text[] not null default '{}',        -- whitelist opzionale: vuoto = tutti quelli del ruolo
  expires_at    timestamptz,
  last_used_at  timestamptz,
  calls_count   bigint not null default 0,
  revoked_at    timestamptz,
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now()
);

create index if not exists idx_mcp_tokens_hash    on mcp_tokens(token_hash);
create index if not exists idx_mcp_tokens_profile on mcp_tokens(profile_id);

alter table mcp_tokens enable row level security;

-- Solo gli admin gestiscono i token; ognuno vede i propri (senza l'hash non e' riusabile).
drop policy if exists "mcp_tokens_admin_all" on mcp_tokens;
create policy "mcp_tokens_admin_all" on mcp_tokens
  for all to authenticated
  using     (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

drop policy if exists "mcp_tokens_owner_read" on mcp_tokens;
create policy "mcp_tokens_owner_read" on mcp_tokens
  for select to authenticated
  using (profile_id = auth.uid());

grant select, insert, update, delete on mcp_tokens to authenticated;
grant all on mcp_tokens to service_role;

-- ============================================================
-- MCP AUDIT LOG
-- Ogni chiamata a un tool viene registrata qui.
-- ============================================================

create table if not exists mcp_audit_log (
  id            bigserial primary key,
  token_id      uuid references mcp_tokens(id) on delete set null,
  profile_id    uuid references profiles(id) on delete set null,
  role          text,
  scope         text,
  tool          text not null,
  args          jsonb,
  ok            boolean not null default true,
  error         text,
  rows_affected integer,
  duration_ms   integer,
  ip            text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_mcp_audit_created on mcp_audit_log(created_at desc);
create index if not exists idx_mcp_audit_profile on mcp_audit_log(profile_id, created_at desc);
create index if not exists idx_mcp_audit_tool    on mcp_audit_log(tool, created_at desc);

alter table mcp_audit_log enable row level security;

drop policy if exists "mcp_audit_admin_read" on mcp_audit_log;
create policy "mcp_audit_admin_read" on mcp_audit_log
  for select to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

drop policy if exists "mcp_audit_owner_read" on mcp_audit_log;
create policy "mcp_audit_owner_read" on mcp_audit_log
  for select to authenticated
  using (profile_id = auth.uid());

grant select on mcp_audit_log to authenticated;
grant all on mcp_audit_log to service_role;
grant usage, select on sequence mcp_audit_log_id_seq to service_role;

-- Un solo write per chiamata: l'insert dell'audit aggiorna anche il token.
create or replace function mcp_after_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.token_id is not null then
    update mcp_tokens
       set last_used_at = now(),
           calls_count  = calls_count + 1
     where id = new.token_id;
  end if;
  return null;
end $$;

drop trigger if exists trg_mcp_audit_touch on mcp_audit_log;
create trigger trg_mcp_audit_touch after insert on mcp_audit_log
  for each row execute function mcp_after_audit();

-- ============================================================
-- QUERY READ-ONLY (tool `sql_query`, solo admin)
-- Doppia barriera: validazione sintattica + transazione read-only.
-- Eseguibile solo dal service_role, cioe' solo da /api/mcp.
-- ============================================================

create or replace function mcp_readonly_query(q text, max_rows integer default 200)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  clean  text;
  lim    integer;
  result jsonb;
begin
  clean := btrim(coalesce(q, ''));
  clean := regexp_replace(clean, ';+\s*$', '');
  lim   := greatest(1, least(coalesce(max_rows, 200), 1000));

  if clean = '' then
    raise exception 'Query vuota';
  end if;

  if clean like '%;%' then
    raise exception 'Una sola istruzione per chiamata: ";" non ammesso';
  end if;

  if lower(clean) !~ '^(select|with)\s' then
    raise exception 'Sono ammesse solo query SELECT / WITH';
  end if;

  -- Parole chiave di scrittura (anche dentro una CTE: "with x as (insert ...)")
  -- e funzioni che leggono il filesystem o tengono occupata la connessione.
  -- La lista resta volutamente corta: parole comuni come "do" o "copy"
  -- darebbero falsi positivi su qualunque ilike, e comunque la transazione
  -- read-only impedisce ogni scrittura.
  if lower(clean) ~ '\m(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|vacuum|reindex|refresh|dblink|lo_import|lo_export|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_sleep|pg_reload_conf|set_config)\M' then
    raise exception 'Parola chiave non ammessa in una query di sola lettura';
  end if;

  -- Schemi che contengono credenziali o segreti.
  if lower(clean) ~ '\m(auth|vault|pgsodium|net|supabase_functions|cron)\s*\.' then
    raise exception 'Schema non accessibile da sql_query';
  end if;

  -- Tabelle con segreti: app_config tiene il segreto dell'import da Drive,
  -- mcp_tokens gli hash dei token. Per i token c'e' il tool mcp_tokens_list.
  if lower(clean) ~ '\m(app_config|mcp_tokens)\M' then
    raise exception 'Tabella non accessibile da sql_query: usa i tool dedicati';
  end if;

  -- Rete di sicurezza: se la validazione lasciasse passare qualcosa,
  -- la transazione read-only lo blocca comunque.
  perform set_config('transaction_read_only', 'on', true);
  perform set_config('statement_timeout', '15000', true);

  execute 'select coalesce(jsonb_agg(row_to_json(t)), ''[]''::jsonb) from ('
       || 'select * from (' || clean || ') _mcp_q limit ' || lim || ') t'
    into result;

  return result;
end $$;

-- ============================================================
-- ROLE PERMISSIONS
-- E' la fonte dei permessi sia del portale sia dell'MCP. Fino a oggi veniva
-- creata a mano da /users.html; qui la mettiamo nelle migrazioni perche'
-- l'MCP ci si appoggia. Nessuna riga di default: se un ruolo non ha una riga,
-- valgono i default del codice (ROLE_PAGES_DEFAULT), cioe' il comportamento
-- attuale. Le pagine si configurano da /users.html.
-- ============================================================

create table if not exists role_permissions (
  role          text primary key,
  allowed_pages text[] not null default '{}'   -- array vuoto = tutte le pagine
);

alter table role_permissions enable row level security;

drop policy if exists "read_role_permissions" on role_permissions;
create policy "read_role_permissions" on role_permissions
  for select to authenticated using (true);

drop policy if exists "admin_manage_role_permissions" on role_permissions;
create policy "admin_manage_role_permissions" on role_permissions
  for all to authenticated
  using     (exists (select 1 from profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

grant select, insert, update, delete on role_permissions to authenticated;
grant all on role_permissions to service_role;

revoke all on function mcp_readonly_query(text, integer) from public;
revoke all on function mcp_readonly_query(text, integer) from anon, authenticated;
grant execute on function mcp_readonly_query(text, integer) to service_role;
