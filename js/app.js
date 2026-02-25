// ============================================================
// InDubai Portal — Shared App Shell
// ============================================================
// Include this script in every page (after supabase.js)

(function () {
  const session = sb.requireAuth();
  if (!session) return;

  const profile = sb.getCurrentProfile();
  const currentPage = window.location.pathname.split('/').pop().replace('.html', '') || 'index';

  const navItems = [
    { id: 'index',       icon: '◈', label: 'Dashboard',     href: '/index.html',       section: 'OVERVIEW' },
    { id: 'clients',     icon: '◉', label: 'Clienti',        href: '/clients.html',     section: 'GESTIONE' },
    { id: 'onboarding',  icon: '✦', label: 'Onboarding',     href: '/onboarding.html' },
    { id: 'statements',  icon: '◎', label: 'Estratti Conto', href: '/statements.html' },
    { id: 'payments',    icon: '◆', label: 'Abbonamenti',    href: '/payments.html' },
    { id: 'vat',         icon: '◇', label: 'VAT Register',   href: '/vat.html',         section: 'COMPLIANCE' },
    { id: 'corp-tax',    icon: '◈', label: 'Corporate Tax',  href: '/corp-tax.html' },
    { id: 'affinitas',   icon: '◉', label: 'Affinitas',      href: '/affinitas.html' },
  ];

  const navHTML = navItems.map(item => {
    const sectionHeader = item.section ? `<div class="nav-section">${item.section}</div>` : '';
    const active = (currentPage === item.id || (currentPage === '' && item.id === 'index')) ? 'active' : '';
    return `${sectionHeader}
      <a href="${item.href}" class="nav-item ${active}">
        <span class="nav-icon">${item.icon}</span>
        ${item.label}
        <span class="nav-badge ${item.id}" style="display:none">0</span>
      </a>`;
  }).join('');

  const initials = (profile?.full_name || 'U').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  const sidebar = `
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-logo">
        <div class="logo-mark">InDubai</div>
        <div class="logo-sub">Portal</div>
      </div>
      <nav class="sidebar-nav">${navHTML}</nav>
      <div class="sidebar-footer">
        <div class="sidebar-user">
          <div class="avatar">${initials}</div>
          <div class="user-info">
            <div class="user-name">${escapeHtml(profile?.full_name || 'Utente')}</div>
            <div class="user-role">${profile?.role === 'admin' ? 'Amministratore' : 'Staff'}</div>
          </div>
          <button class="btn-logout" title="Logout" onclick="sb.signOut()">⏻</button>
        </div>
      </div>
    </aside>`;

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  // Inject sidebar before first element in body
  document.body.insertAdjacentHTML('afterbegin', sidebar);

  // Load KPI badges async
  (async function loadBadges() {
    try {
      const kpis = await sb.db.getDashboardKPIs();
      if (kpis.bank_statements_missing > 0) {
        document.querySelector('.nav-badge.statements').textContent = kpis.bank_statements_missing;
        document.querySelector('.nav-badge.statements').style.display = '';
      }
      if (kpis.subscriptions_issue > 0) {
        document.querySelector('.nav-badge.payments').textContent = kpis.subscriptions_issue;
        document.querySelector('.nav-badge.payments').style.display = '';
        document.querySelector('.nav-badge.payments').classList.add('warn');
      }
      if (kpis.vat_deadlines_next_30_days > 0) {
        document.querySelector('.nav-badge.vat').textContent = kpis.vat_deadlines_next_30_days;
        document.querySelector('.nav-badge.vat').style.display = '';
        document.querySelector('.nav-badge.vat').classList.add('info');
      }
    } catch (e) { /* non-blocking */ }
  })();
})();
