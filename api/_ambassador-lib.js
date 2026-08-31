/**
 * Helper condivisi dagli endpoint /api/ambassador-*.
 * I file che iniziano con "_" non vengono esposti come function da Vercel.
 */

export const SUPABASE_URL = process.env.SUPABASE_URL
  || 'https://gvdoqcgkzbziqufahhxh.supabase.co';

export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2ZG9xY2dremJ6aXF1ZmFoaHhoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjAzMjA1MSwiZXhwIjoyMDg3NjA4MDUxfQ.oEzS7iIAiRW3pYjL-TwXtY4ZOwKwh4L8JZZ6Ztq6RgQ';

// Casella che riceve le richieste di consulenza dal form ambassador.
export const SEGRETERIA_EMAIL = process.env.SEGRETERIA_EMAIL || 'segreteria@indubai.it';

export const PORTAL_URL = 'https://portal.indubai.it';

// Calendario su cui la lead può prenotare da sé la call di consulenza.
export const BOOKING_URL = process.env.BOOKING_URL || 'https://pellegrinobozzella.com/prenota';
export const AMBASSADOR_LOGIN_URL = `${PORTAL_URL}/ambassador/login.html`;

export const SB_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

// ── REST helpers (service role: bypassano RLS) ──────────────────────────────

export async function sbSelect(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: SB_HEADERS });
  if (!res.ok) throw new Error(`${table}: ${await res.text()}`);
  return res.json();
}

export async function sbInsert(table, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Insert ${table} fallita`);
  return Array.isArray(data) ? data[0] : data;
}

export async function sbUpdate(table, query, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Update ${table} fallita`);
  return Array.isArray(data) ? data[0] : data;
}

// ── Auth ────────────────────────────────────────────────────────────────────

export function decodeJWT(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
  } catch { return null; }
}

const STAFF_ROLES = ['admin', 'senior', 'mini_admin', 'junior', 'staff', 'collaborator'];

/**
 * Verifica che la richiesta arrivi da un membro dello staff loggato.
 * Ritorna { ok:true, userId, role } oppure { ok:false, status, error }.
 */
export async function requireStaff(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return { ok: false, status: 401, error: 'Token mancante' };
  const decoded = decodeJWT(token);
  if (!decoded?.sub) return { ok: false, status: 401, error: 'Token non valido' };
  if (decoded.exp && decoded.exp * 1000 < Date.now()) {
    return { ok: false, status: 401, error: 'Sessione scaduta' };
  }
  let rows;
  try {
    rows = await sbSelect('profiles', `id=eq.${decoded.sub}&select=role`);
  } catch {
    return { ok: false, status: 500, error: 'Verifica ruolo fallita' };
  }
  const role = rows?.[0]?.role;
  if (!STAFF_ROLES.includes(role)) return { ok: false, status: 403, error: 'Permessi insufficienti' };
  return { ok: true, userId: decoded.sub, role };
}

// ── Email ───────────────────────────────────────────────────────────────────

export async function sendEmail({ to, user_id, subject, html, event_type, entity_id, entity_type }) {
  try {
    const body = { subject, html };
    if (to) body.to = to;
    if (user_id) body.user_id = user_id;
    if (event_type) body.event_type = event_type;
    if (entity_id) body.entity_id = entity_id;
    if (entity_type) body.entity_type = entity_type;
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  } catch (e) {
    console.error('[sendEmail]', e.message);
    return { ok: false, error: e.message };
  }
}

/** Rispetta l'on/off e i destinatari configurati in notification_settings (fail-open). */
async function staffRecipients(event_type) {
  let roles = ['admin', 'senior', 'mini_admin'];
  try {
    const rows = await sbSelect('notification_settings',
      `event_type=eq.${event_type}&select=enabled,roles`);
    const cfg = rows?.[0];
    if (cfg) {
      if (cfg.enabled === false) return null;               // notifica disattivata
      if (Array.isArray(cfg.roles) && cfg.roles.length) roles = cfg.roles;
    }
  } catch { /* fail-open */ }
  try {
    const filter = roles.map(r => `role.eq.${r}`).join(',');
    const rows = await sbSelect('profiles', `or=(${filter})&select=id`);
    return (rows || []).map(p => p.id);
  } catch { return []; }
}

/** Email allo staff interno + alla casella segreteria. */
export async function notifyStaff({ subject, html, event_type, entity_id, entity_type }) {
  const ids = await staffRecipients(event_type);
  if (ids === null) return;                                  // spenta da pannello
  await Promise.all([
    ...ids.map(user_id => sendEmail({ user_id, subject, html, event_type, entity_id, entity_type })),
    SEGRETERIA_EMAIL
      ? sendEmail({ to: SEGRETERIA_EMAIL, subject, html, event_type, entity_id, entity_type })
      : null,
  ].filter(Boolean));
}

// ── Commissioni ─────────────────────────────────────────────────────────────

/**
 * Calcola la commissione lorda per una segnalazione chiusa.
 * @param {object} service  riga di ambassador_services (può essere null)
 * @param {number} deal     valore del contratto in AED
 * @param {number} mult     moltiplicatore dell'ambassador (1 = standard)
 */
export function computeCommission(service, deal, mult = 1) {
  const m = Number(mult) > 0 ? Number(mult) : 1;
  if (!service) return 0;
  const value = Number(service.commission_value) || 0;
  const base = service.commission_type === 'percent'
    ? (Number(deal) || Number(service.price_aed) || 0) * value / 100
    : value;
  return Math.round(base * m * 100) / 100;
}

export function formatAED(n) {
  return 'AED ' + Number(n || 0).toLocaleString('it-IT', { maximumFractionDigits: 2 });
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function slugifyCode(name) {
  const base = String(name || 'amb').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 18) || 'amb';
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base}-${suffix}`;
}
