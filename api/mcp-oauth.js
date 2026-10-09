/**
 * OAuth 2.1 per il server MCP del portale.
 *
 * Serve a far collegare claude.ai senza token da copiare: l'utente clicca
 * "Connetti", fa login con le credenziali del portale e basta. Il permesso
 * resta quello del suo ruolo, esattamente come per i token personali.
 *
 * Implementa il minimo che la specifica MCP richiede:
 *   RFC 9728  Protected Resource Metadata   /.well-known/oauth-protected-resource
 *   RFC 8414  Authorization Server Metadata /.well-known/oauth-authorization-server
 *   RFC 7591  Dynamic Client Registration   /oauth/register
 *   OAuth 2.1 authorization code + PKCE     /oauth/authorize, /oauth/token
 *
 * Le rotte pubbliche sono mappate su questo file dalle rewrite in vercel.json.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  sbSelect, sbSelectOne, sbInsert, sbUpdate, sbDelete, hashToken, EXTERNAL_ROLES,
} from './_mcp-lib.js';
import { SUPABASE_URL, SERVICE_KEY } from './_ambassador-lib.js';

const ISSUER = process.env.PORTAL_URL || 'https://portal.indubai.it';
const RESOURCE = `${ISSUER}/api/mcp`;

const CODE_TTL_MS = 5 * 60 * 1000;         // il codice vive 5 minuti
const ACCESS_TTL_MS = 30 * 24 * 3600_000;  // l'access token 30 giorni, poi refresh

const b64url = buf => buf.toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const newSecret = (bytes = 32) => b64url(randomBytes(bytes));

function constantTimeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function json(res, status, body, headers = {}) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, mcp-protocol-version');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  return res.status(status).json(body);
}

const oauthError = (res, status, error, description) =>
  json(res, status, { error, error_description: description });

// ── Metadati di discovery ───────────────────────────────────────────────────

function resourceMetadata(res) {
  return json(res, 200, {
    resource: RESOURCE,
    authorization_servers: [ISSUER],
    bearer_methods_supported: ['header'],
    resource_name: 'InDubai Portal (MCP interno)',
    resource_documentation: `${ISSUER}/mcp`,
  });
}

function asMetadata(res) {
  return json(res, 200, {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    registration_endpoint: `${ISSUER}/oauth/register`,
    revocation_endpoint: `${ISSUER}/oauth/revoke`,
    scopes_supported: ['mcp'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    service_documentation: `${ISSUER}/mcp`,
  });
}

// ── Registrazione dinamica del client (RFC 7591) ────────────────────────────

async function register(req, res) {
  const b = req.body || {};
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
  if (!uris.length) {
    return oauthError(res, 400, 'invalid_redirect_uri', 'Serve almeno un redirect_uri');
  }
  for (const u of uris) {
    let parsed;
    try { parsed = new URL(u); } catch { return oauthError(res, 400, 'invalid_redirect_uri', `URI non valido: ${u}`); }
    const localhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !localhost) {
      return oauthError(res, 400, 'invalid_redirect_uri', 'I redirect_uri devono essere https (o localhost)');
    }
  }

  const client_id = `idb_cli_${newSecret(16)}`;
  // Client pubblico: la sicurezza la fa PKCE, non un segreto che vive nel client.
  const isPublic = (b.token_endpoint_auth_method || 'none') === 'none';
  const secret = isPublic ? null : newSecret();

  await sbInsert('mcp_oauth_clients', {
    client_id,
    client_secret_hash: secret ? hashToken(secret) : null,
    client_name: String(b.client_name || 'Client MCP').slice(0, 120),
    redirect_uris: uris.slice(0, 10),
  });

  return json(res, 201, {
    client_id,
    ...(secret ? { client_secret: secret } : {}),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: isPublic ? 'none' : 'client_secret_post',
    client_name: b.client_name || 'Client MCP',
  });
}

// ── Pagina di login (GET /oauth/authorize) ──────────────────────────────────

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loginPage({ params, clientName, error }) {
  const hidden = ['client_id', 'redirect_uri', 'state', 'code_challenge',
    'code_challenge_method', 'resource', 'scope']
    .map(k => `<input type="hidden" name="${k}" value="${esc(params[k] || '')}">`).join('');

  return `<!DOCTYPE html>
<html lang="it"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Collega Claude — InDubai Portal</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800;900&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
       background:#14161a;font-family:'DM Sans',system-ui,sans-serif;color:#14161a}
  .card{background:#fff;border-radius:16px;padding:38px 34px;max-width:430px;width:100%;
        box-shadow:0 24px 70px rgba(0,0,0,.4)}
  .brand{font-weight:800;font-size:19px;letter-spacing:-.02em;margin-bottom:26px}
  .brand span{color:#16a34a}
  h1{font-size:21px;font-weight:800;letter-spacing:-.02em;margin-bottom:10px;line-height:1.25}
  .lead{font-size:14px;color:#6b6f76;line-height:1.6;margin-bottom:22px}
  .who{background:#f7f6f2;border-left:3px solid #47ee74;padding:13px 15px;margin-bottom:24px;
       font-size:13.5px;color:#374151;line-height:1.55}
  .who b{color:#14161a}
  label{display:block;font-size:12.5px;font-weight:700;margin-bottom:6px}
  input[type=email],input[type=password]{width:100%;font-family:inherit;font-size:15px;padding:12px 13px;
       border:1.5px solid #e7e4dc;border-radius:9px;margin-bottom:16px;color:#14161a}
  input:focus{outline:none;border-color:#14161a}
  .opt{display:flex;gap:9px;align-items:flex-start;background:#f7f6f2;border-radius:9px;
       padding:12px 14px;margin-bottom:20px;font-size:13px;color:#374151;line-height:1.5;cursor:pointer}
  .opt input{margin-top:2px;flex:0 0 auto}
  button{width:100%;background:#14161a;color:#47ee74;border:0;border-radius:9px;padding:14px;
         font-family:inherit;font-size:15px;font-weight:700;cursor:pointer}
  button:hover{background:#2b2e35}
  .err{background:#fee2e2;border:1px solid #fca5a5;color:#991b1b;border-radius:9px;
       padding:11px 14px;font-size:13.5px;margin-bottom:18px}
  .foot{font-size:11.5px;color:#9ca3af;margin-top:20px;line-height:1.55;text-align:center}
</style></head>
<body>
  <form class="card" method="POST" action="/oauth/authorize">
    <div class="brand">In<span>Dubai</span> Portal</div>
    <h1>Collega Claude al portale</h1>
    <p class="lead">
      Accedi con le stesse credenziali che usi sul portale. Claude vedrà e potrà fare
      esattamente quello che puoi fare tu: il tuo ruolo non cambia.
    </p>
    <div class="who"><b>${esc(clientName)}</b> sta chiedendo di collegarsi al tuo account InDubai.</div>
    ${error ? `<div class="err">${esc(error)}</div>` : ''}
    ${hidden}
    <label for="email">Email</label>
    <input type="email" id="email" name="email" autocomplete="username" required autofocus>
    <label for="password">Password</label>
    <input type="password" id="password" name="password" autocomplete="current-password" required>
    <label class="opt">
      <input type="checkbox" name="can_write" value="1" checked>
      <span>Permetti a Claude anche di <b>modificare</b> i dati (creare task, aggiornare clienti...).
            Togli la spunta per un collegamento in sola lettura.</span>
    </label>
    <button type="submit">Accedi e collega</button>
    <p class="foot">Ogni azione di Claude viene registrata nell'audit del portale,<br>con il tuo nome e lo strumento usato.</p>
  </form>
</body></html>`;
}

// ── Autorizzazione ──────────────────────────────────────────────────────────

/** Controlli comuni a GET e POST di /oauth/authorize. */
async function validateAuthzRequest(params) {
  const { client_id, redirect_uri, code_challenge, code_challenge_method, response_type } = params;
  if (!client_id) return { error: 'Richiesta senza client_id' };

  const client = await sbSelectOne('mcp_oauth_clients', {
    select: '*', filters: { client_id },
  });
  if (!client) return { error: 'Client non riconosciuto: rimuovi e riaggiungi il connettore' };

  if (!redirect_uri || !client.redirect_uris.includes(redirect_uri)) {
    return { error: 'redirect_uri non corrisponde a quello registrato' };
  }
  if (response_type && response_type !== 'code') {
    return { client, redirectError: 'unsupported_response_type' };
  }
  // PKCE obbligatorio: senza, un codice intercettato sarebbe spendibile.
  if (!code_challenge) return { client, redirectError: 'invalid_request', desc: 'PKCE obbligatorio' };
  if ((code_challenge_method || 'S256') !== 'S256') {
    return { client, redirectError: 'invalid_request', desc: 'Solo code_challenge_method S256' };
  }
  return { client };
}

function redirectWithError(res, redirect_uri, state, error, desc) {
  const u = new URL(redirect_uri);
  u.searchParams.set('error', error);
  if (desc) u.searchParams.set('error_description', desc);
  if (state) u.searchParams.set('state', state);
  res.setHeader('Location', u.toString());
  return res.status(302).end();
}

function html(res, status, body) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'DENY');
  return res.status(status).send(body);
}

async function authorizeGet(req, res) {
  const params = req.query || {};
  const check = await validateAuthzRequest({ ...params, response_type: params.response_type || 'code' });
  if (check.error) return html(res, 400, errorPage(check.error));
  if (check.redirectError) {
    return redirectWithError(res, params.redirect_uri, params.state, check.redirectError, check.desc);
  }
  return html(res, 200, loginPage({ params, clientName: check.client.client_name }));
}

function errorPage(message) {
  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Collegamento non riuscito</title>
<style>body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
background:#14161a;font-family:system-ui,sans-serif}
.c{background:#fff;border-radius:16px;padding:34px;max-width:420px;text-align:center}
h1{font-size:19px;margin:0 0 10px;color:#14161a}p{color:#6b6f76;font-size:14px;line-height:1.6;margin:0}
</style></head><body><div class="c"><h1>Collegamento non riuscito</h1><p>${esc(message)}</p></div></body></html>`;
}

async function authorizePost(req, res) {
  const b = req.body || {};
  const check = await validateAuthzRequest({ ...b, response_type: 'code' });
  if (check.error) return html(res, 400, errorPage(check.error));
  if (check.redirectError) {
    return redirectWithError(res, b.redirect_uri, b.state, check.redirectError, check.desc);
  }

  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  const retry = msg => html(res, 200, loginPage({ params: b, clientName: check.client.client_name, error: msg }));

  if (!email || !password) return retry('Inserisci email e password.');

  // Login contro Supabase Auth: le stesse credenziali del portale.
  let auth;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    auth = await r.json();
    if (!r.ok || !auth?.user?.id) return retry('Email o password non corretti.');
  } catch {
    return retry('Accesso non riuscito, riprova tra un istante.');
  }

  const profile = await sbSelectOne('profiles', {
    select: 'id,full_name,role', filters: { id: auth.user.id },
  });
  if (!profile) return retry('Questo account non ha un profilo sul portale.');
  if (EXTERNAL_ROLES.includes(profile.role)) {
    return retry(`Il ruolo "${profile.role}" non può usare l'MCP interno: ha la sua area riservata.`);
  }

  // Codice usa e getta, legato a PKCE e al redirect_uri.
  const code = newSecret();
  await sbInsert('mcp_oauth_codes', {
    code_hash: hashToken(code),
    client_id: check.client.client_id,
    profile_id: profile.id,
    redirect_uri: b.redirect_uri,
    code_challenge: b.code_challenge,
    code_challenge_method: 'S256',
    resource: b.resource || RESOURCE,
    can_write: b.can_write === '1' || b.can_write === 'on',
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });

  const u = new URL(b.redirect_uri);
  u.searchParams.set('code', code);
  if (b.state) u.searchParams.set('state', b.state);
  res.setHeader('Location', u.toString());
  return res.status(302).end();
}

// ── Token ───────────────────────────────────────────────────────────────────

/** Verifica il client; per i client riservati controlla anche il segreto. */
async function authClient(body) {
  const client_id = body.client_id;
  if (!client_id) return null;
  const client = await sbSelectOne('mcp_oauth_clients', { select: '*', filters: { client_id } });
  if (!client) return null;
  if (client.client_secret_hash) {
    if (!body.client_secret) return null;
    if (!constantTimeEqual(client.client_secret_hash, hashToken(body.client_secret))) return null;
  }
  return client;
}

/** Crea (o rinnova) la concessione in mcp_tokens: una riga per client+utente. */
async function issueTokens({ client, profile_id, can_write, existingId }) {
  const access = `idb_mcp_${newSecret()}`;
  const refresh = `idb_ref_${newSecret()}`;
  const row = {
    token_hash: hashToken(access),
    refresh_hash: hashToken(refresh),
    expires_at: new Date(Date.now() + ACCESS_TTL_MS).toISOString(),
    can_write,
  };
  if (existingId) {
    await sbUpdate('mcp_tokens', { id: existingId }, row);
  } else {
    await sbInsert('mcp_tokens', [{
      ...row,
      profile_id,
      kind: 'oauth',
      client_id: client.client_id,
      name: `Claude · ${client.client_name}`,
      token_prefix: access.slice(0, 16),
      scope: 'all',
      allowed_tools: [],
    }]);
  }
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    scope: 'mcp',
  };
}

async function token(req, res) {
  const b = req.body || {};
  const client = await authClient(b);
  if (!client) return oauthError(res, 401, 'invalid_client', 'Client non riconosciuto');

  if (b.grant_type === 'authorization_code') {
    if (!b.code || !b.code_verifier) {
      return oauthError(res, 400, 'invalid_request', 'Servono code e code_verifier');
    }
    const row = await sbSelectOne('mcp_oauth_codes', {
      select: '*', filters: { code_hash: hashToken(b.code) },
    });
    if (!row || row.client_id !== client.client_id) {
      return oauthError(res, 400, 'invalid_grant', 'Codice non valido');
    }
    // Usa e getta: se riappare, la concessione e' compromessa.
    if (row.used_at) {
      await sbDelete('mcp_oauth_codes', { code_hash: row.code_hash });
      return oauthError(res, 400, 'invalid_grant', 'Codice gia\' usato');
    }
    if (new Date(row.expires_at) <= new Date()) {
      return oauthError(res, 400, 'invalid_grant', 'Codice scaduto');
    }
    if (b.redirect_uri && b.redirect_uri !== row.redirect_uri) {
      return oauthError(res, 400, 'invalid_grant', 'redirect_uri diverso da quello iniziale');
    }
    // PKCE: base64url(sha256(verifier)) deve dare la challenge iniziale.
    const computed = b64url(createHash('sha256').update(b.code_verifier).digest());
    if (!constantTimeEqual(computed, row.code_challenge)) {
      return oauthError(res, 400, 'invalid_grant', 'Verifica PKCE fallita');
    }

    await sbUpdate('mcp_oauth_codes', { code_hash: row.code_hash },
      { used_at: new Date().toISOString() });

    const existing = await sbSelectOne('mcp_tokens', {
      select: 'id',
      filters: { client_id: client.client_id, profile_id: row.profile_id, kind: 'oauth', revoked_at: null },
    });
    const out = await issueTokens({
      client, profile_id: row.profile_id, can_write: row.can_write, existingId: existing?.id,
    });
    await sbUpdate('mcp_oauth_clients', { client_id: client.client_id },
      { last_used_at: new Date().toISOString() });
    return json(res, 200, out);
  }

  if (b.grant_type === 'refresh_token') {
    if (!b.refresh_token) return oauthError(res, 400, 'invalid_request', 'Serve refresh_token');
    const grant = await sbSelectOne('mcp_tokens', {
      select: 'id,profile_id,can_write,revoked_at,client_id',
      filters: { refresh_hash: hashToken(b.refresh_token), kind: 'oauth' },
    });
    if (!grant || grant.revoked_at || grant.client_id !== client.client_id) {
      return oauthError(res, 400, 'invalid_grant', 'Refresh token non valido o revocato');
    }
    // Rotazione: il vecchio refresh smette di funzionare.
    const out = await issueTokens({
      client, profile_id: grant.profile_id, can_write: grant.can_write, existingId: grant.id,
    });
    return json(res, 200, out);
  }

  return oauthError(res, 400, 'unsupported_grant_type', `grant_type non supportato: ${b.grant_type}`);
}

async function revoke(req, res) {
  const b = req.body || {};
  const t = b.token;
  if (!t) return json(res, 200, {});
  const h = hashToken(t);
  for (const filters of [{ token_hash: h }, { refresh_hash: h }]) {
    try {
      await sbUpdate('mcp_tokens', { ...filters, kind: 'oauth' },
        { revoked_at: new Date().toISOString() });
    } catch { /* RFC 7009: la revoca risponde 200 comunque */ }
  }
  return json(res, 200, {});
}

// ── Router ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, mcp-protocol-version');
    return res.status(204).end();
  }

  const action = String(req.query?.action || '');
  try {
    switch (action) {
      case 'resource-metadata': return resourceMetadata(res);
      case 'as-metadata':       return asMetadata(res);
      case 'register':
        if (req.method !== 'POST') return oauthError(res, 405, 'invalid_request', 'Serve POST');
        return await register(req, res);
      case 'authorize':
        return req.method === 'POST' ? await authorizePost(req, res) : await authorizeGet(req, res);
      case 'token':
        if (req.method !== 'POST') return oauthError(res, 405, 'invalid_request', 'Serve POST');
        return await token(req, res);
      case 'revoke':
        return await revoke(req, res);
      default:
        return oauthError(res, 404, 'invalid_request', `Azione sconosciuta: ${action || '(nessuna)'}`);
    }
  } catch (e) {
    console.error('[mcp-oauth]', action, e);
    return oauthError(res, 500, 'server_error', e?.message || 'Errore interno');
  }
}
