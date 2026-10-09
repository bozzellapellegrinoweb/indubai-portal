-- ============================================================
-- OAuth 2.1 per il server MCP
--
-- Serve a collegare claude.ai, che non accetta un token incollato a mano
-- (i "Request headers" sono una beta non attiva su tutti gli account).
-- Con OAuth l'utente fa login con le credenziali del portale e basta:
-- nessun token da generare, da capire o da custodire.
--
-- Vedi api/mcp-oauth.js e le rewrite in vercel.json.
-- ============================================================

-- Client registrati dinamicamente (RFC 7591). Claude si registra da solo
-- la prima volta che si collega: non c'e' niente da configurare a mano.
create table if not exists mcp_oauth_clients (
  client_id          text primary key,
  client_secret_hash text,                 -- null = client pubblico, protetto da PKCE
  client_name        text,
  redirect_uris      text[] not null,
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz
);

-- Codici di autorizzazione: usa e getta, vivono 5 minuti.
create table if not exists mcp_oauth_codes (
  code_hash             text primary key,  -- sha256: in chiaro non lo salviamo mai
  client_id             text not null references mcp_oauth_clients(client_id) on delete cascade,
  profile_id            uuid not null references profiles(id) on delete cascade,
  redirect_uri          text not null,
  code_challenge        text not null,     -- PKCE obbligatorio
  code_challenge_method text not null default 'S256',
  resource              text,
  can_write             boolean not null default true,
  expires_at            timestamptz not null,
  used_at               timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists idx_mcp_codes_expires on mcp_oauth_codes(expires_at);

-- Nessuna policy: solo il service_role tocca queste tabelle, cioe' solo
-- /api/mcp-oauth. Non c'e' motivo perche' il browser le legga.
alter table mcp_oauth_clients enable row level security;
alter table mcp_oauth_codes   enable row level security;

grant all on mcp_oauth_clients to service_role;
grant all on mcp_oauth_codes   to service_role;

-- Le concessioni OAuth vivono in mcp_tokens accanto ai token personali:
-- cosi' l'autenticazione del server MCP resta una sola query.
alter table mcp_tokens add column if not exists kind         text not null default 'personal';
alter table mcp_tokens add column if not exists client_id    text;
alter table mcp_tokens add column if not exists refresh_hash text;

create index if not exists idx_mcp_tokens_refresh on mcp_tokens(refresh_hash);

comment on column mcp_tokens.kind is '''personal'' = token creato da /mcp.html, ''oauth'' = concessione via login';
