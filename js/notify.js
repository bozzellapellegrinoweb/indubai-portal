// ── InDubai Push Notification Utility ──────────────────────────────────────
// Wraps the send-notification Edge Function.
// Usage: await pushNotify({ action, title, message, user_id?, url? })

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
