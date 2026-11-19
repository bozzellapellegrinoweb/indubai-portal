/**
 * Autenticazione condivisa degli endpoint /api/*.
 * I file che iniziano con "_" non vengono esposti come function da Vercel.
 *
 * - La chiave di servizio arriva SOLO da variabile d'ambiente
 *   (SUPABASE_SERVICE_ROLE_KEY su Vercel). Mai nel codice.
 * - Il token dell'utente viene verificato da Supabase (/auth/v1/user), non
 *   solo decodificato: un JWT costruito a mano o scaduto non passa.
 */

export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gvdoqcgkzbziqufahhxh.supabase.co';
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

export const SB_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

export const STAFF_ROLES = ['admin', 'senior', 'mini_admin', 'junior', 'staff', 'collaborator', 'commerciale'];

/** Risponde 500 se la chiave non e' configurata. Ritorna true se si puo' proseguire. */
export function ensureConfigured(res) {
  if (SERVICE_KEY) return true;
  res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY non configurata nelle variabili d\'ambiente di Vercel' });
  return false;
}

/** Utente verificato dal token Bearer, oppure null. */
export async function verifiedUser(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !SERVICE_KEY) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? u : null;
  } catch { return null; }
}

export async function roleOf(userId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role`, { headers: SB_HEADERS });
  if (!r.ok) return '';
  const rows = await r.json();
  return String(rows?.[0]?.role || '');
}

/**
 * Richiede un utente verificato con uno dei ruoli indicati.
 * roles: array di ruoli, oppure 'staff' (tutti i ruoli interni) o 'admin'.
 * Ritorna { ok:true, userId, role, user } oppure { ok:false, status, error }.
 */
export async function requireRole(req, roles = 'staff') {
  if (!SERVICE_KEY) return { ok: false, status: 500, error: 'SUPABASE_SERVICE_ROLE_KEY non configurata' };
  const user = await verifiedUser(req);
  if (!user) return { ok: false, status: 401, error: 'Sessione non valida o scaduta' };
  const role = await roleOf(user.id);
  const allowed = roles === 'staff' ? STAFF_ROLES : roles === 'admin' ? ['admin'] : roles;
  if (!allowed.includes(role)) return { ok: false, status: 403, error: 'Permessi insufficienti' };
  return { ok: true, userId: user.id, role, user };
}

/** Per gli endpoint chiamati dal cron di Vercel (Authorization: Bearer $CRON_SECRET). */
export function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('[cron] CRON_SECRET non impostato: endpoint cron aperto. Impostalo su Vercel.');
    return true;
  }
  return String(req.headers.authorization || '') === `Bearer ${secret}`;
}
