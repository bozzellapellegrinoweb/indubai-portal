-- ============================================================
-- Cache condivisa del token Zoho
-- ============================================================
-- Il token di accesso Zoho vive un'ora, ma ogni istanza di una edge function
-- partiva con la cache in memoria vuota: approvando piu' spese di fila si
-- chiedeva un refresh per ciascuna, e Zoho limita quell'endpoint. Il sintomo
-- era "Token refresh failed" a metA' del lavoro, senza una causa visibile.
--
-- Qui il token sta in una riga sola, condivisa fra tutte le istanze: un
-- refresh all'ora basta per tutti.
--
-- RLS attiva e nessuna policy: solo il service_role (cioe' le edge function)
-- la vede. Il token non e' leggibile da chi e' loggato nel portale.

create table if not exists zoho_token_cache (
  id           text primary key default 'zoho',
  access_token text not null,
  expires_at   timestamptz not null,
  updated_at   timestamptz not null default now()
);

alter table zoho_token_cache enable row level security;
grant all on zoho_token_cache to service_role;

comment on table zoho_token_cache is
  'Token di accesso Zoho condiviso fra le istanze delle edge function: evita un refresh per chiamata, che Zoho limita.';
