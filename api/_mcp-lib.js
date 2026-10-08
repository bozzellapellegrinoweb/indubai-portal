/**
 * MCP server — infrastruttura condivisa.
 *
 * I file che iniziano con "_" non vengono esposti come function da Vercel:
 * questo modulo e' usato solo da api/mcp.js.
 *
 * Contiene: client REST Supabase (service role), autenticazione dei token MCP,
 * risoluzione dei permessi a partire dal ruolo del profilo, audit trail.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { SUPABASE_URL, SERVICE_KEY } from './_ambassador-lib.js';

export { SUPABASE_URL, SERVICE_KEY };

export const TOKEN_PREFIX = 'idb_mcp_';

const SB_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

// ── Errori ──────────────────────────────────────────────────────────────────

/** Errore applicativo con codice JSON-RPC e HTTP associati. */
export class McpError extends Error {
  constructor(message, { code = -32603, http = 200, data } = {}) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.http = http;
    this.data = data;
  }
}

export const badRequest  = (m, data) => new McpError(m, { code: -32602, http: 200, data });
export const unauthorized = (m) => new McpError(m, { code: -32001, http: 401 });
export const forbidden    = (m) => new McpError(m, { code: -32002, http: 403 });

// ── REST helpers (service role: bypassano RLS, i permessi li applichiamo qui) ─

/** Rende un termine utilizzabile in un ilike dentro un'espressione `or` di PostgREST. */
export function likeTerm(value) {
  return String(value ?? '').trim().replace(/[*%,()]/g, '');
}

/**
 * Traduce un oggetto di filtri nella sintassi PostgREST.
 *
 *   { status: 'open' }                       -> status=eq.open
 *   { year: { op: 'gte', value: 2026 } }     -> year=gte.2026
 *   { id: { op: 'in', value: ['a','b'] } }   -> id=in.("a","b")
 *   { role: { op: 'not_in', value: [...] } } -> role=not.in.(...)
 *   { company_name: { op: 'ilike', value: '%aa%' } }
 *   { notes: { op: 'is', value: null } }     -> notes=is.null
 */
export const FILTER_OPS = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
  'like', 'ilike', 'is', 'in', 'not_in', 'cs', 'cd', 'ov', 'fts', 'plfts',
];

export function buildFilterParams(filters) {
  const params = [];
  for (const [rawCol, raw] of Object.entries(filters || {})) {
    const col = String(rawCol);
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) {
      throw badRequest(`Nome colonna non valido: ${col}`);
    }
    let op = 'eq';
    let value = raw;
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw) {
      op = String(raw.op || 'eq').toLowerCase();
      value = raw.value;
    } else if (Array.isArray(raw)) {
      op = 'in';
    } else if (raw === null) {
      op = 'is';
    }
    if (!FILTER_OPS.includes(op)) {
      throw badRequest(`Operatore non supportato: ${op}. Ammessi: ${FILTER_OPS.join(', ')}`);
    }
    let encoded;
    if (op === 'in' || op === 'not_in') {
      const list = Array.isArray(value) ? value : [value];
      const set = `(${list.map(v => `"${String(v).replace(/"/g, '\\"')}"`).join(',')})`;
      params.push([col, op === 'in' ? `in.${set}` : `not.in.${set}`]);
      continue;
    } else if (op === 'is') {
      encoded = value === null || value === undefined ? 'null' : String(value);
    } else {
      encoded = String(value);
    }
    params.push([col, `${op}.${encoded}`]);
  }
  return params;
}

function toQuery(parts) {
  const sp = new URLSearchParams();
  for (const [k, v] of parts) sp.append(k, v);
  return sp.toString();
}

async function sbRequest(path, { method = 'GET', body, prefer, query } = {}) {
  const qs = query ? `?${query}` : '';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}${qs}`, {
    method,
    headers: prefer ? { ...SB_HEADERS, Prefer: prefer } : SB_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data?.message || data?.hint || data?.error || text || `HTTP ${res.status}`;
    throw new McpError(`Supabase (${path}): ${msg}`, { code: -32010, data: data?.details });
  }
  return data;
}

/**
 * SELECT su una tabella o view.
 * @param {object} opts { select, filters, order, limit, offset, or, count }
 */
export async function sbSelect(table, opts = {}) {
  const parts = buildFilterParams(opts.filters);
  parts.push(['select', opts.select || '*']);
  if (opts.or) parts.push(['or', opts.or.startsWith('(') ? opts.or : `(${opts.or})`]);
  if (opts.order) parts.push(['order', opts.order]);
  if (opts.limit !== undefined) parts.push(['limit', String(opts.limit)]);
  if (opts.offset) parts.push(['offset', String(opts.offset)]);
  return sbRequest(table, { query: toQuery(parts), prefer: opts.count ? 'count=exact' : undefined });
}

export async function sbSelectOne(table, opts = {}) {
  const rows = await sbSelect(table, { ...opts, limit: 1 });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

export async function sbInsert(table, rows, { upsertOn } = {}) {
  const prefer = upsertOn
    ? 'return=representation,resolution=merge-duplicates'
    : 'return=representation';
  const parts = upsertOn ? [['on_conflict', upsertOn]] : [];
  return sbRequest(table, {
    method: 'POST',
    body: rows,
    prefer,
    query: parts.length ? toQuery(parts) : undefined,
  });
}

export async function sbUpdate(table, filters, patch) {
  const parts = buildFilterParams(filters);
  if (!parts.length) throw badRequest('Un update richiede almeno un filtro');
  return sbRequest(table, {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation',
    query: toQuery(parts),
  });
}

export async function sbDelete(table, filters) {
  const parts = buildFilterParams(filters);
  if (!parts.length) throw badRequest('Una delete richiede almeno un filtro');
  return sbRequest(table, { method: 'DELETE', prefer: 'return=representation', query: toQuery(parts) });
}

export async function sbRpc(fn, args = {}) {
  return sbRequest(`rpc/${fn}`, { method: 'POST', body: args });
}

/** Invoca una edge function Supabase con il service role. */
export async function sbFunction(name, payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: SB_HEADERS,
    body: JSON.stringify(payload ?? {}),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw new McpError(`Edge function ${name}: ${data?.error || text || res.status}`, { code: -32011 });
  }
  return data;
}

/** Admin API di Supabase Auth (creazione utenti, reset password). */
export async function sbAuthAdmin(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/${path}`, {
    method,
    headers: SB_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data?.msg || data?.message || data?.error_description || text || res.status;
    throw new McpError(`Supabase Auth: ${msg}`, { code: -32013 });
  }
  return data;
}

/** URL firmato per un file nello storage (default: 1 ora). */
export async function sbSignedUrl(bucket, path, expiresIn = 3600) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`, {
    method: 'POST',
    headers: SB_HEADERS,
    body: JSON.stringify({ expiresIn }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new McpError(`Storage: ${data?.message || res.status}`, { code: -32012 });
  return `${SUPABASE_URL}/storage/v1${data.signedURL}`;
}

// ── Permessi ────────────────────────────────────────────────────────────────

/**
 * Pagine visibili per ruolo quando la tabella role_permissions non dice nulla.
 * Tenuto allineato a ROLE_PAGES_DEFAULT in js/app.js.
 */
export const ROLE_PAGES_DEFAULT = {
  admin:  null, // null = tutte
  senior: null,
  junior: ['index', 'tasks', 'pipeline', 'clients', 'zoho-setup', 'zoho-vat', 'onboarding',
           'statements', 'reconciliation', 'expenses', 'ferie', 'vat', 'corp-tax', 'affinitas',
           'vat-partner', 'pw', 'documents', 'search', 'news', 'notifiche', 'reports',
           'lead-analytics'],
  mini_admin:   ['index', 'tasks', 'pipeline', 'clients', 'expenses', 'documents', 'search',
                 'news', 'notifiche', 'broadcast', 'bacheca', 'affinitas', 'vat-partner', 'pw'],
  collaborator: ['index', 'tasks', 'pipeline', 'clients', 'expenses', 'documents', 'search',
                 'news', 'notifiche', 'broadcast', 'bacheca', 'affinitas', 'vat-partner', 'pw'],
  staff:        ['index', 'tasks', 'notifiche'],
};

/** Ruoli che non possono usare questo server: hanno la loro area dedicata. */
export const EXTERNAL_ROLES = ['client', 'ambassador'];

/**
 * Pagine effettivamente accessibili da un ruolo.
 * @returns {string[]|null} null = tutte le pagine
 */
export function allowedPagesFor(role, rolePermissions) {
  if (role === 'admin' || role === 'senior') return null;
  const fromDb = rolePermissions?.[role];
  if (Array.isArray(fromDb) && fromDb.length) return fromDb;
  if (role in ROLE_PAGES_DEFAULT) return ROLE_PAGES_DEFAULT[role];
  return ['index', 'tasks', 'notifiche'];
}

async function loadRolePermissions() {
  try {
    const rows = await sbSelect('role_permissions', { select: 'role,allowed_pages' });
    const map = {};
    for (const r of rows || []) {
      map[r.role] = r.allowed_pages?.length ? r.allowed_pages : null;
    }
    return map;
  } catch {
    // La tabella e' opzionale: se manca si usano i default.
    return {};
  }
}

// ── Autenticazione ──────────────────────────────────────────────────────────

export function hashToken(raw) {
  return createHash('sha256').update(String(raw), 'utf8').digest('hex');
}

function constantTimeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function extractBearer(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(h).trim());
  if (m) return m[1].trim();
  // Fallback per client che non sanno mandare header custom.
  const alt = req.headers?.['x-mcp-token'];
  return alt ? String(alt).trim() : null;
}

/**
 * Verifica il token e costruisce il contesto della sessione MCP.
 * @returns {Promise<object>} { token, profile, role, pages, canWrite, scope, allowedTools }
 */
export async function authenticate(req, { scope } = {}) {
  const raw = extractBearer(req);
  if (!raw) throw unauthorized('Token MCP mancante: usa l\'header "Authorization: Bearer <token>"');

  const rows = await sbSelect('mcp_tokens', {
    // mcp_tokens ha due FK verso profiles (profile_id e created_by):
    // senza il nome del vincolo PostgREST non sa quale usare e rifiuta l'embed.
    select: '*,profile:profiles!mcp_tokens_profile_id_fkey(id,full_name,role)',
    filters: { token_hash: hashToken(raw) },
    limit: 1,
  });
  const token = rows?.[0];
  if (!token || !constantTimeEqual(token.token_hash, hashToken(raw))) {
    throw unauthorized('Token MCP non valido');
  }
  if (token.revoked_at) throw unauthorized('Token MCP revocato');
  if (token.expires_at && new Date(token.expires_at) <= new Date()) {
    throw unauthorized('Token MCP scaduto');
  }

  const profile = token.profile;
  if (!profile) throw unauthorized('Il token non e\' collegato a nessun profilo');

  const role = profile.role || 'staff';
  if (EXTERNAL_ROLES.includes(role)) {
    throw forbidden(`Il ruolo "${role}" non puo\' usare l\'MCP interno: ha la sua area riservata`);
  }

  const rolePermissions = await loadRolePermissions();

  return {
    token,
    profile,
    role,
    pages: allowedPagesFor(role, rolePermissions),
    canWrite: !!token.can_write,
    scope: scope || token.scope || 'all',
    allowedTools: token.allowed_tools?.length ? token.allowed_tools : null,
    ip: clientIp(req),
  };
}

export function clientIp(req) {
  const xff = req.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

// ── Audit ───────────────────────────────────────────────────────────────────

const REDACT_KEYS = /^(password|new_password|token|secret|api_key|apikey|authorization)$/i;

/** Copia gli argomenti troncando i valori lunghi e oscurando le credenziali. */
export function redactArgs(args, depth = 0) {
  if (args === null || args === undefined) return args;
  if (typeof args === 'string') return args.length > 2000 ? `${args.slice(0, 2000)}…` : args;
  if (typeof args !== 'object' || depth > 4) return args;
  if (Array.isArray(args)) return args.slice(0, 50).map(v => redactArgs(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = REDACT_KEYS.test(k) ? '***' : redactArgs(v, depth + 1);
  }
  return out;
}

/** Registra la chiamata. Non deve mai far fallire la risposta al client. */
export async function audit(ctx, entry) {
  try {
    await sbInsert('mcp_audit_log', [{
      token_id:      ctx?.token?.id ?? null,
      profile_id:    ctx?.profile?.id ?? null,
      role:          ctx?.role ?? null,
      scope:         ctx?.scope ?? null,
      tool:          entry.tool,
      args:          redactArgs(entry.args ?? null),
      ok:            entry.ok !== false,
      error:         entry.error ? String(entry.error).slice(0, 2000) : null,
      rows_affected: entry.rowsAffected ?? null,
      duration_ms:   entry.durationMs ?? null,
      ip:            ctx?.ip ?? null,
    }]);
  } catch (e) {
    console.error('[mcp] audit log failed:', e?.message || e);
  }
}

// ── Rate limit (best effort, per istanza lambda) ────────────────────────────

const buckets = new Map();

export function rateLimit(key, { limit = 240, windowMs = 60_000 } = {}) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.start > windowMs) {
    buckets.set(key, { start: now, count: 1 });
    return;
  }
  b.count += 1;
  if (b.count > limit) {
    throw new McpError(
      `Troppe chiamate: limite ${limit}/minuto per token`,
      { code: -32003, http: 429 },
    );
  }
}

// ── Utility ─────────────────────────────────────────────────────────────────

export function clampLimit(v, def = 50, max = 500) {
  const n = Number.isFinite(Number(v)) ? Math.floor(Number(v)) : def;
  return Math.min(Math.max(n, 1), max);
}

export function requireArg(args, name) {
  const v = args?.[name];
  if (v === undefined || v === null || v === '') throw badRequest(`Parametro obbligatorio: ${name}`);
  return v;
}

export function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));
}

export function requireUuid(args, name) {
  const v = requireArg(args, name);
  if (!isUuid(v)) throw badRequest(`${name} deve essere un UUID`);
  return v;
}

/** Mese corrente (fuso Dubai, dove lavora il team). */
export function currentYearMonth() {
  const now = new Date(Date.now() + 4 * 3600 * 1000); // UTC+4
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}
