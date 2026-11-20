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

/**
 * Ruolo dichiarato dalla chiave configurata ('service_role', 'anon', ...).
 * Serve a distinguere "variabile non impostata" da "variabile impostata con la
 * chiave sbagliata": nel secondo caso Supabase risponde con un criptico
 * «permission denied for table ...» che non lascia capire dov'e' il problema.
 */
/**
 * Supabase ha due formati di chiave:
 *  - storico: un JWT con dentro "role" ("service_role" oppure "anon")
 *  - nuovo:   sb_secret_... (equivalente a service_role) e
 *             sb_publishable_... (equivalente ad anon)
 * Qui si riconosce il formato per distinguere "variabile non impostata" da
 * "impostata con la chiave pubblica": nel secondo caso Supabase risponde con un
 * criptico «permission denied for table ...» che manda a cercare il problema
 * nei permessi del database invece che nella configurazione.
 */
export const SERVICE_KEY_ROLE = (() => {
  if (!SERVICE_KEY) return null;
  if (SERVICE_KEY.startsWith('sb_secret_')) return 'service_role';
  if (SERVICE_KEY.startsWith('sb_publishable_')) return 'publishable';
  try {
    return JSON.parse(Buffer.from(SERVICE_KEY.split('.')[1], 'base64').toString()).role || null;
  } catch { return null; }
})();

export const SERVICE_KEY_OK = SERVICE_KEY_ROLE === 'service_role';

/**
 * Messaggio da mostrare quando la chiave manca o e' palesemente quella
 * pubblica. Un formato che non si sa leggere NON viene bloccato: meglio
 * lasciar decidere Supabase che impedire una configurazione valida solo
 * perche' il formato e' nuovo.
 */
export function serviceKeyProblem() {
  if (!SERVICE_KEY) {
    return 'SUPABASE_SERVICE_ROLE_KEY non configurata nelle variabili d\'ambiente di Vercel.';
  }
  if (SERVICE_KEY_ROLE === 'publishable' || SERVICE_KEY_ROLE === 'anon') {
    return 'SUPABASE_SERVICE_ROLE_KEY contiene la chiave PUBBLICA del progetto '
         + `(${SERVICE_KEY_ROLE === 'anon' ? 'anon' : 'sb_publishable_...'}) invece di quella di servizio. `
         + 'In Supabase → Project Settings → API prendi la chiave "service_role" '
         + '(oppure "sb_secret_..." se usi il nuovo formato).';
  }
  return null;
}

export function ensureConfigured(res) {
  const problema = serviceKeyProblem();
  if (!problema) return true;
  console.error('[config]', problema);
  res.status(500).json({ error: problema });
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
