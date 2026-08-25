// ============================================================
// InDubai — Area Ambassador · client Supabase minimale
// Usa /js/config.js per URL e anon key (nessuna chiave duplicata).
// Sessione su chiave dedicata: non interferisce con il portale staff.
// ============================================================

const SUPABASE_URL = window.ENV_SUPABASE_URL;
const SUPABASE_ANON_KEY = window.ENV_SUPABASE_ANON_KEY;
const AUTH_KEY = 'indubai_amb_session';

function getSession() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch { return null; }
}
function setSession(d) { localStorage.setItem(AUTH_KEY, JSON.stringify(d)); }
function clearSession() { localStorage.removeItem(AUTH_KEY); }

async function sbFetch(path, options = {}, retry = true) {
  const token = getSession()?.access_token || SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    cache: 'no-store',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (res.status === 401 && retry && await tryRefresh()) return sbFetch(path, options, false);

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(data?.message || data?.error_description || data?.error || `HTTP ${res.status}`);
  return data;
}

async function tryRefresh() {
  const s = getSession();
  if (!s?.refresh_token) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    setSession({ ...data, ambassador: s.ambassador });
    return true;
  } catch { return false; }
}

async function signIn(email, password) {
  const data = await sbFetch('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setSession(data);

  // Deve esistere una riga ambassador collegata a questo utente
  const rows = await sbFetch(`/rest/v1/ambassadors?user_id=eq.${data.user.id}&select=*`);
  const amb = rows?.[0];
  if (!amb) {
    clearSession();
    throw new Error('Questo account non è collegato a un profilo ambassador.');
  }
  if (amb.status !== 'active') {
    clearSession();
    throw new Error('Il tuo profilo ambassador non è attivo. Scrivici per riattivarlo.');
  }
  setSession({ ...getSession(), ambassador: amb });
  return amb;
}

function signOut() {
  sbFetch('/auth/v1/logout', { method: 'POST' }).catch(() => {});
  clearSession();
  window.location.href = '/ambassador/login.html';
}

function requireAuth() {
  const s = getSession();
  if (!s?.access_token || !s?.ambassador) {
    window.location.href = '/ambassador/login.html';
    return null;
  }
  return s;
}

function select(table, query) {
  return sbFetch(`/rest/v1/${table}?${query}`);
}

// ── Utility ──────────────────────────────────────────────────
function formatAED(n) {
  return 'AED ' + Number(n || 0).toLocaleString('it-IT', { maximumFractionDigits: 2 });
}
function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

window.amb = {
  getSession, setSession, clearSession, signIn, signOut, requireAuth, select,
  formatAED, formatDate, escapeHtml,
};
