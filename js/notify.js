// ── InDubai Notification Utilities ──────────────────────────────────────────
// pushNotify: notifiche push via OneSignal (send-notification Edge Function)
// emailNotify: notifiche email via Resend (send-email Edge Function)

const NOTIFY_FN = 'https://gvdoqcgkzbziqufahhxh.supabase.co/functions/v1/send-notification';

async function pushNotify({ action = 'send_to_user', title, message, user_id, company, url }) {
  try {
    const tok = (typeof sb !== 'undefined' && sb.getSession?.()?.access_token) || window.ENV_SUPABASE_ANON_KEY;
    const body = { action, title, message };
    if (url)     body.url     = url;
    if (user_id) body.user_id = user_id;
    if (company) body.company = company;
    const r = await fetch(NOTIFY_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (d.error) console.warn('[pushNotify] error:', d.error);
    return d;
  } catch(e) {
    console.warn('[pushNotify] fetch failed:', e.message);
  }
}

// Helper: get portal user_id for a client from client_users table
async function getClientUserId(clientId) {
  try {
    const SB = window.ENV_SUPABASE_URL;
    const AK = window.ENV_SUPABASE_ANON_KEY;
    const tok = (typeof sb !== 'undefined' && sb.getSession?.()?.access_token) || AK;
    const r = await fetch(`${SB}/rest/v1/client_users?client_id=eq.${clientId}&select=user_id&limit=1`, {
      headers: { apikey: AK, Authorization: 'Bearer ' + tok }
    });
    const rows = await r.json();
    return rows?.[0]?.user_id || null;
  } catch(e) { return null; }
}

// Helper: get user_ids of all admin/senior/junior staff (for internal alerts)
async function getStaffUserIds(roles = ['admin', 'senior', 'mini_admin', 'junior']) {
  try {
    const SB = window.ENV_SUPABASE_URL;
    const AK = window.ENV_SUPABASE_ANON_KEY;
    const tok = (typeof sb !== 'undefined' && sb.getSession?.()?.access_token) || AK;
    const roleFilter = roles.map(r => `role.eq.${r}`).join(',');
    const r = await fetch(`${SB}/rest/v1/profiles?or=(${roleFilter})&select=id`, {
      headers: { apikey: AK, Authorization: 'Bearer ' + tok }
    });
    const rows = await r.json();
    return (rows || []).map(p => p.id);
  } catch(e) { return []; }
}

// Helper: notify all staff in parallel
async function pushNotifyStaff({ roles, title, message, url }) {
  const ids = await getStaffUserIds(roles);
  await Promise.all(ids.map(uid => pushNotify({ action: 'send_to_user', title, message, url, user_id: uid })));
}

// ── Email Notifications (Resend via send-email Edge Function) ─────────────────

const EMAIL_FN = 'https://gvdoqcgkzbziqufahhxh.supabase.co/functions/v1/send-email';

/**
 * Invia una email tramite la Edge Function send-email.
 *
 * @param {object} opts
 * @param {string|string[]} [opts.to]        - Indirizzo destinatario (o array)
 * @param {string}          [opts.user_id]   - Alternativa a to: UUID profilo (la function risolve l'email)
 * @param {string}          opts.subject     - Oggetto email
 * @param {string}          opts.html        - Corpo HTML (senza wrapper — viene aggiunto server-side)
 * @param {string}          [opts.event_type] - Tipo evento per il log (es. 'task_assigned')
 * @param {string}          [opts.entity_id]  - UUID entità correlata
 * @param {string}          [opts.entity_type] - Tipo entità ('task', 'vat', ecc.)
 */
async function emailNotify({ to, user_id, subject, html, event_type, entity_id, entity_type }) {
  try {
    const tok = (typeof sb !== 'undefined' && (await sb.auth?.getSession?.())?.data?.session?.access_token)
      || window.ENV_SUPABASE_ANON_KEY;
    const body = { subject, html };
    if (to)          body.to          = to;
    if (user_id)     body.user_id     = user_id;
    if (event_type)  body.event_type  = event_type;
    if (entity_id)   body.entity_id   = entity_id;
    if (entity_type) body.entity_type = entity_type;
    const r = await fetch(EMAIL_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!d.ok) console.warn('[emailNotify] error:', d.error);
    return d;
  } catch (e) {
    console.warn('[emailNotify] fetch failed:', e.message);
  }
}

/**
 * Invia email a tutti gli staff admin + senior.
 * Recupera user_id dei profili e li passa uno per uno (la Edge Function risolve le email).
 */
async function emailNotifyStaff({ roles = ['admin', 'senior'], subject, html, event_type, entity_id, entity_type }) {
  const ids = await getStaffUserIds(roles);
  await Promise.all(ids.map(uid =>
    emailNotify({ user_id: uid, subject, html, event_type, entity_id, entity_type })
  ));
}
