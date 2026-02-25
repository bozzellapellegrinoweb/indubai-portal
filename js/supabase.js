// ============================================================
// InDubai Portal — Supabase Client
// ============================================================

const SUPABASE_URL = window.ENV_SUPABASE_URL;
const SUPABASE_ANON_KEY = window.ENV_SUPABASE_ANON_KEY;

// ── Low-level fetch wrapper ──────────────────────────────────

async function sbFetch(path, options = {}) {
  const token = getSessionToken() || SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || '',
      ...(options.headers || {}),
    },
  });

  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    console.error('Supabase error:', data);
    throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  }
  return data;
}

// ── Auth ─────────────────────────────────────────────────────

const AUTH_KEY = 'indubai_session';

function getSession() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch { return null; }
}
function setSession(data) { localStorage.setItem(AUTH_KEY, JSON.stringify(data)); }
function clearSession() { localStorage.removeItem(AUTH_KEY); }
function getSessionToken() { return getSession()?.access_token || null; }
function getCurrentUser() { return getSession()?.user || null; }

async function signIn(email, password) {
  const data = await sbFetch('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setSession(data);

  // Load profile
  const profile = await sbFetch(`/rest/v1/profiles?id=eq.${data.user.id}&select=*`);
  if (profile?.[0]) {
    const session = getSession();
    session.profile = profile[0];
    setSession(session);
  }
  return data;
}

async function signOut() {
  try {
    await sbFetch('/auth/v1/logout', { method: 'POST' });
  } catch {}
  clearSession();
  window.location.href = '/login.html';
}

function requireAuth() {
  const session = getSession();
  if (!session?.access_token) {
    window.location.href = '/login.html';
    return null;
  }
  return session;
}

function getCurrentProfile() {
  return getSession()?.profile || null;
}

function isAdmin() {
  return getCurrentProfile()?.role === 'admin';
}

// ── Database helpers ─────────────────────────────────────────

const db = {

  // Generic select
  async select(table, { filter = '', columns = '*', order = '', limit = null } = {}) {
    let path = `/rest/v1/${table}?select=${columns}`;
    if (filter) path += `&${filter}`;
    if (order) path += `&order=${order}`;
    if (limit) path += `&limit=${limit}`;
    return sbFetch(path);
  },

  // Insert one or many rows
  async insert(table, rows, { returning = true } = {}) {
    return sbFetch(`/rest/v1/${table}`, {
      method: 'POST',
      prefer: returning ? 'return=representation' : 'return=minimal',
      body: JSON.stringify(rows),
    });
  },

  // Update matching rows
  async update(table, filter, updates) {
    return sbFetch(`/rest/v1/${table}?${filter}`, {
      method: 'PATCH',
      prefer: 'return=representation',
      body: JSON.stringify(updates),
    });
  },

  // Delete matching rows
  async delete(table, filter) {
    return sbFetch(`/rest/v1/${table}?${filter}`, {
      method: 'DELETE',
      prefer: 'return=minimal',
    });
  },

  // Upsert
  async upsert(table, rows, onConflict = '') {
    let prefer = 'return=representation,resolution=merge-duplicates';
    let path = `/rest/v1/${table}`;
    if (onConflict) path += `?on_conflict=${onConflict}`;
    return sbFetch(path, {
      method: 'POST',
      prefer,
      body: JSON.stringify(rows),
    });
  },

  // ── Specific queries ────────────────────────────────────────

  async getClients({ activeOnly = true, inBilancio = null } = {}) {
    let filter = '';
    if (activeOnly) filter += 'is_active=eq.true';
    if (inBilancio !== null) filter += (filter ? '&' : '') + `in_bilancio=eq.${inBilancio}`;
    return this.select('clients', { filter, order: 'company_name.asc' });
  },

  async getClient(id) {
    const rows = await this.select('clients', {
      filter: `id=eq.${id}`,
      columns: '*,onboarding_checklist(*),vat_register(*)'
    });
    return rows?.[0] || null;
  },

  async getDashboardKPIs() {
    const rows = await this.select('dashboard_current_month');
    return rows?.[0] || {};
  },

  async getBankStatements(year, month, { clientId = null } = {}) {
    let filter = `year=eq.${year}&month=eq.${month}`;
    if (clientId) filter += `&client_id=eq.${clientId}`;
    return this.select('bank_statements', { filter });
  },

  async getSubscriptionPayments(year, month) {
    return this.select('subscription_payments', {
      filter: `year=eq.${year}&month=eq.${month}`,
      columns: '*',
    });
  },

  async getVatRegister() {
    return this.select('vat_register', { columns: '*,clients(company_name,contact_name,is_active)' });
  },

  async getOnboarding(clientId) {
    const rows = await this.select('onboarding_checklist', { filter: `client_id=eq.${clientId}` });
    return rows?.[0] || null;
  },

  async updateOnboarding(clientId, updates) {
    return this.update('onboarding_checklist', `client_id=eq.${clientId}`, updates);
  },

  async upsertBankStatement(clientId, year, month, data) {
    return this.upsert('bank_statements', {
      client_id: clientId, year, month, ...data
    }, 'client_id,year,month');
  },

  async upsertSubscriptionPayment(clientId, year, month, data) {
    return this.upsert('subscription_payments', {
      client_id: clientId, year, month, ...data
    }, 'client_id,year,month');
  },

  async log(action, clientId = null, details = null) {
    const user = getCurrentUser();
    return this.insert('activity_log', {
      user_id: user?.id || null,
      client_id: clientId,
      action,
      details,
    }, { returning: false }).catch(() => {}); // Non-blocking
  },
};

// ── Toast notifications ──────────────────────────────────────

function showToast(message, type = 'default', duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✓', error: '✕', default: 'ℹ' };
  toast.innerHTML = `<span>${icons[type] || icons.default}</span> ${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(30px)';
    toast.style.transition = '0.2s';
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

// ── Utilities ────────────────────────────────────────────────

const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const MONTHS_FULL = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

function currentYearMonth() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatAED(n) {
  if (!n && n !== 0) return '—';
  return 'AED ' + Number(n).toLocaleString('it-IT');
}

function deadlineClass(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const today = new Date();
  const diffDays = Math.ceil((d - today) / 86400000);
  if (diffDays < 0) return 'deadline-overdue';
  if (diffDays <= 14) return 'deadline-soon';
  return 'deadline-ok';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function partnerLabel(p) {
  const map = { noi: 'Noi', vat_consultant: 'VAT Consultant', affinitas: 'Affinitas', in_sospeso: 'In Sospeso', altro: 'Altro' };
  return map[p] || p || '—';
}

function statusBadge(status) {
  const map = {
    ok: ['badge-ok', '✓ OK'],
    failed: ['badge-fail', '✕ Failed'],
    no_tentativo: ['badge-warn', '⚠ No Tent.'],
    pending: ['badge-pending', '○ Pending'],
    manual: ['badge-info', '✎ Manuale'],
    annual: ['badge-info', '★ Annuale'],
  };
  const [cls, label] = map[status] || ['badge-pending', status || '—'];
  return `<span class="badge ${cls}">${label}</span>`;
}

function monthBadge(status) {
  if (!status) return `<span class="month-cell month-empty">·</span>`;
  const map = {
    ok: 'month-ok',
    failed: 'month-fail',
    no_tentativo: 'month-warn',
    pending: 'month-empty',
  };
  const symbols = { ok: '✓', failed: '✕', no_tentativo: '!', pending: '·' };
  const cls = map[status] || 'month-empty';
  return `<span class="month-cell ${cls}" title="${status}">${symbols[status] || '·'}</span>`;
}

// ── Export globals ───────────────────────────────────────────
window.sb = { db, signIn, signOut, requireAuth, getCurrentUser, getCurrentProfile, isAdmin, getSession };
window.ui = { showToast, MONTHS, MONTHS_FULL, currentYearMonth, formatDate, formatAED, deadlineClass, escapeHtml, partnerLabel, statusBadge, monthBadge };
