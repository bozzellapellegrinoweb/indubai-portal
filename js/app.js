// ============================================================
// InDubai Portal — Shared App Shell
// ============================================================

(function () {
  const session = sb.requireAuth();
  if (!session) return;

  const profile = sb.getCurrentProfile();
  const currentPage = window.location.pathname.split('/').pop().replace('.html', '') || 'index';

  const navItems = [
    { id: 'index',      icon: '◈', label: 'Dashboard',     href: '/index.html',      section: 'OVERVIEW' },
    { id: 'tasks',      icon: '✓', label: 'Task',           href: '/tasks.html' },
    { id: 'clients',    icon: '◉', label: 'Clienti',        href: '/clients.html',    section: 'GESTIONE' },
    { id: 'onboarding', icon: '✦', label: 'Onboarding',     href: '/onboarding.html' },
    { id: 'statements', icon: '◎', label: 'Estratti Conto', href: '/statements.html' },
    { id: 'payments',   icon: '◆', label: 'Abbonamenti',    href: '/payments.html' },
    { id: 'vat',        icon: '◇', label: 'VAT Register',   href: '/vat.html',        section: 'COMPLIANCE' },
    { id: 'corp-tax',   icon: '◈', label: 'Corporate Tax',  href: '/corp-tax.html' },
    { id: 'affinitas',  icon: '◉', label: 'Affinitas',      href: '/affinitas.html' },
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

  // Inject sidebar
  document.body.insertAdjacentHTML('afterbegin', sidebar);

  // Inject notification bell in every topbar
  document.addEventListener('DOMContentLoaded', () => {
    const topbar = document.querySelector('.topbar');
    const topbarActions = document.querySelector('.topbar-actions') || topbar;
    if (topbar) {
      // Ensure topbar is flex
      topbar.style.display = 'flex';
      topbar.style.alignItems = 'center';
      topbar.style.justifyContent = 'space-between';
      const bell = document.createElement('div');
      bell.className = 'notif-bell';
      bell.style.cssText = 'position:relative;display:inline-flex;align-items:center;margin-left:auto;margin-right:0';
      bell.innerHTML = `
        <button id="bell-btn" onclick="toggleNotifPanel()" style="
          width:36px;height:36px;border-radius:50%;border:1px solid var(--border);
          background:white;cursor:pointer;font-size:16px;display:flex;align-items:center;
          justify-content:center;position:relative;transition:all .15s
        " title="Notifiche">🔔
          <span id="bell-badge" style="
            display:none;position:absolute;top:-2px;right:-2px;
            background:#dc2626;color:white;border-radius:50%;width:16px;height:16px;
            font-size:10px;font-weight:800;align-items:center;justify-content:center
          ">0</span>
        </button>
        <div id="notif-panel" style="
          display:none;position:absolute;top:44px;right:0;width:360px;
          background:white;border:1px solid var(--border);border-radius:12px;
          box-shadow:0 8px 32px rgba(0,0,0,.15);z-index:1000;overflow:hidden
        ">
          <div style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
            <div style="font-size:14px;font-weight:700">Notifiche</div>
            <button onclick="markAllRead()" style="font-size:12px;color:var(--primary);background:none;border:none;cursor:pointer;font-weight:600">Segna tutte lette</button>
          </div>
          <div id="notif-list" style="max-height:400px;overflow-y:auto">
            <div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">Caricamento...</div>
          </div>
        </div>`;
      topbar.appendChild(bell);
      loadNotifications();
    }
  });

  // Close panel on outside click
  document.addEventListener('click', e => {
    const panel = document.getElementById('notif-panel');
    const btn = document.getElementById('bell-btn');
    if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) {
      panel.style.display = 'none';
    }
  });

  // ── Notifications ──────────────────────────────────────────

  window.toggleNotifPanel = function() {
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    const isOpen = panel.style.display !== 'none';
    panel.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) loadNotifications();
  };

  window.loadNotifications = async function() {
    const listEl = document.getElementById('notif-list');
    if (!listEl) return;
    try {
      const userId = profile?.id;
      if (!userId) return;
      const notifs = await sb.db.select('notifications', {
        filter: `user_id=eq.${userId}`,
        order: 'created_at.desc',
        limit: 30
      });
      const unread = (notifs || []).filter(n => !n.read).length;
      const badge = document.getElementById('bell-badge');
      if (badge) {
        badge.textContent = unread;
        badge.style.display = unread > 0 ? 'flex' : 'none';
      }
      // Update tasks badge
      try {
        const taskNotifs = (notifs||[]).filter(n => n.type.startsWith('task') && !n.read).length;
        const taskBadge = document.querySelector('.nav-badge.tasks');
        if (taskBadge && taskNotifs > 0) {
          taskBadge.textContent = taskNotifs;
          taskBadge.style.display = '';
        }
      } catch(e) {}

      if (!notifs || !notifs.length) {
        listEl.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px">Nessuna notifica</div>';
        return;
      }
      const typeIcons = {
        task_assigned: '📋', task_comment: '💬', task_completed: '✅',
        vat_deadline: '📅', payment_failed: '⚠', statement_missing: '📂', default: '🔔'
      };
      listEl.innerHTML = notifs.map(n => `
        <div onclick="handleNotifClick('${n.id}','${n.link||''}')" style="
          padding:12px 18px;border-bottom:1px solid var(--border);cursor:pointer;
          background:${n.read ? 'white' : '#f0f6ff'};transition:background .15s;
          display:flex;gap:12px;align-items:flex-start
        " onmouseenter="this.style.background='#f5f9ff'" onmouseleave="this.style.background='${n.read?'white':'#f0f6ff'}'">
          <span style="font-size:18px;flex-shrink:0">${typeIcons[n.type]||typeIcons.default}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:${n.read?'500':'700'};color:var(--text-primary);margin-bottom:2px">${escapeHtml(n.title)}</div>
            ${n.body ? `<div style="font-size:12px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(n.body)}</div>` : ''}
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${new Date(n.created_at).toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</div>
          </div>
          ${!n.read ? '<span style="width:8px;height:8px;border-radius:50%;background:#2563a8;flex-shrink:0;margin-top:4px"></span>' : ''}
        </div>`).join('');
    } catch(e) { console.error('Notif error:', e); }
  };

  window.handleNotifClick = async function(id, link) {
    try { await sb.db.update('notifications', `id=eq.${id}`, { read: true }); } catch(e) {}
    if (link) window.location.href = link;
    else loadNotifications();
  };

  window.markAllRead = async function() {
    const userId = profile?.id;
    if (!userId) return;
    try {
      await sb.db.update('notifications', `user_id=eq.${userId}&read=eq.false`, { read: true });
      loadNotifications();
    } catch(e) {}
  };

  // ── Nav KPI Badges ──────────────────────────────────────────
  (async function loadBadges() {
    try {
      const kpis = await sb.db.getDashboardKPIs();
      if (kpis.bank_statements_missing > 0) {
        const el = document.querySelector('.nav-badge.statements');
        if (el) { el.textContent = kpis.bank_statements_missing; el.style.display = ''; }
      }
      if (kpis.subscriptions_issue > 0) {
        const el = document.querySelector('.nav-badge.payments');
        if (el) { el.textContent = kpis.subscriptions_issue; el.style.display = ''; el.classList.add('warn'); }
      }
      if (kpis.vat_deadlines_next_30_days > 0) {
        const el = document.querySelector('.nav-badge.vat');
        if (el) { el.textContent = kpis.vat_deadlines_next_30_days; el.style.display = ''; el.classList.add('info'); }
      }
    } catch(e) {}
  })();

})();
