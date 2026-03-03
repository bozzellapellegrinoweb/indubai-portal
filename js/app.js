// ============================================================
// InDubai Portal — Shared App Shell
// ============================================================

(function () {
  const session = sb.requireAuth();
  if (!session) return;

  const profile = sb.getCurrentProfile();
  const currentPage = window.location.pathname.split('/').pop().replace('.html', '') || 'index';

  const role = profile?.role || 'junior';

  // Clients must use their own portal — check both cached profile and user metadata
  const isClient = role === 'client' || session?.user?.user_metadata?.role === 'client';
  if (isClient) {
    window.location.href = '/client-portal/dashboard.html';
    return;
  }

  // Pages allowed per role
  const ROLE_PAGES = {
    admin:      null, // null = all pages
    senior:     ['index','tasks','clients','zoho-setup','onboarding','statements','payments','vat','corp-tax','affinitas','documents','search'],
    junior:     ['index','tasks','clients','zoho-setup','onboarding','statements','payments','vat','corp-tax','affinitas','documents','search'],
    mini_admin: ['tasks','clients','documents','search'],
  };
  const allowed = ROLE_PAGES[role]; // null = no restriction

  const allNavItems = [
    { id: 'index',      icon: '◈', label: 'Dashboard',     href: '/index.html',      section: 'OVERVIEW' },
    { id: 'tasks',      icon: '✓', label: 'Task',           href: '/tasks.html' },
    { id: 'clients',    icon: '◉', label: 'Clienti',        href: '/clients.html',    section: 'GESTIONE' },
    { id: 'zoho-setup', icon: '',   label: '↳ Setup Zoho',     href: '/zoho-setup.html', roles: ['admin','senior','junior'] },
    { id: 'zoho-vat',   icon: '',   label: '↳ Monitor VAT',    href: '/zoho-vat.html',   roles: ['admin','senior','junior'] },
    { id: 'documents',  icon: '📁', label: 'Documenti',     href: '/documents.html' },
    { id: 'onboarding', icon: '✦', label: 'Onboarding',     href: '/onboarding.html' },
    { id: 'statements', icon: '◎', label: 'Estratti Conto', href: '/statements.html' },
    { id: 'payments',   icon: '◆', label: 'Abbonamenti',    href: '/payments.html' },
    { id: 'vat',        icon: '◇', label: 'VAT Register',   href: '/vat.html',        section: 'COMPLIANCE' },
    { id: 'corp-tax',   icon: '◈', label: 'Corporate Tax',  href: '/corp-tax.html' },
    { id: 'affinitas',  icon: '◉', label: 'Affinitas',      href: '/affinitas.html' },
    { id: 'reports',    icon: '📊', label: 'Report',         href: '/reports.html',    section: 'ANALYTICS' },
    { id: 'search',     icon: '🔍', label: 'Ricerca',        href: '/search.html' },
    ...(role === 'admin' ? [{ id: 'users', icon: '👥', label: 'Utenti', href: '/users.html', section: 'ADMIN' }] : []),
  ];

  const navItems = allowed ? allNavItems.filter(i => allowed.includes(i.id)) : allNavItems;

  // Redirect if current page not allowed
  if (allowed && !allowed.includes(currentPage) && currentPage !== 'login' && currentPage !== 'client-detail') {
    // Redirect mini_admin to tasks, others to index
    window.location.href = role === 'mini_admin' ? '/tasks.html' : '/index.html';
    return;
  }

  const navHTML = navItems.filter(item => !item.roles || item.roles.includes(role)).map(item => {
    const sectionHeader = item.section ? `<div class="nav-section">${item.section}</div>` : '';
    const active = (currentPage === item.id || (currentPage === '' && item.id === 'index')) ? 'active' : '';
    const subStyle = item.sub ? 'padding-left:32px;font-size:12px;opacity:.85;' : '';
    return `${sectionHeader}
      <a href="${item.href}" class="nav-item ${active}" style="${subStyle}">
        ${item.icon ? `<span class="nav-icon">${item.icon}</span>` : ''}
        ${item.label}
        <span class="nav-badge ${item.id||''}" style="display:none">0</span>
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

  // Inject hamburger menu button for mobile
  const topbar = document.querySelector('.topbar');
  if (topbar && !document.getElementById('hamburger-btn')) {
    const hamburger = document.createElement('button');
    hamburger.id = 'hamburger-btn';
    hamburger.className = 'hamburger';
    hamburger.setAttribute('aria-label', 'Menu');
    hamburger.innerHTML = '<span></span><span></span><span></span>';
    topbar.insertBefore(hamburger, topbar.firstChild);

    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.id = 'sidebar-overlay';
    document.body.appendChild(overlay);

    const sidebar = document.querySelector('.sidebar');

    hamburger.addEventListener('click', () => {
      const isOpen = sidebar.classList.toggle('open');
      overlay.classList.toggle('visible', isOpen);
      hamburger.classList.toggle('open', isOpen);
    });

    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('visible');
      hamburger.classList.remove('open');
    });

    // Close sidebar when nav link clicked on mobile
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
          sidebar.classList.remove('open');
          overlay.classList.remove('visible');
          hamburger.classList.remove('open');
        }
      });
    });
  }

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

  // ── iOS MOBILE SHELL ──────────────────────────────────────
  const PAGE_LABELS = {
    'index': 'Dashboard', 'tasks': 'Task', 'clients': 'Clienti',
    'documents': 'Documenti', 'vat': 'VAT Register', 'corp-tax': 'Corporate Tax',
    'payments': 'Abbonamenti', 'statements': 'Estratti', 'onboarding': 'Onboarding',
    'reports': 'Report', 'search': 'Ricerca', 'users': 'Utenti',
    'affinitas': 'Affinitas', 'zoho-setup': 'Setup Zoho', 'zoho-vat': 'Monitor VAT',
    'client-detail': 'Cliente',
  };
  const pageLabel = PAGE_LABELS[currentPage] || 'InDubai';

  // Bottom nav items (5 max for mobile)
  const bottomNavItems = [
    { id: 'index',   icon: '◈', label: 'Home',     href: '/index.html' },
    { id: 'tasks',   icon: '✓', label: 'Task',     href: '/tasks.html' },
    { id: 'clients', icon: '◉', label: 'Clienti',  href: '/clients.html' },
    { id: 'vat',     icon: '◇', label: 'VAT',      href: '/vat.html' },
    { id: 'menu',    icon: '☰', label: 'Menu',     href: '#' },
  ].filter(i => !allowed || allowed.includes(i.id) || i.id === 'menu');

  const bnavHTML = bottomNavItems.map(item => {
    const isActive = item.id === currentPage;
    return `<a class="ios-bnav-item${isActive ? ' active' : ''}" href="${item.href}" 
      ${item.id === 'menu' ? 'onclick="openAdminSheet();return false;"' : ''}
      data-page="${item.id}">
      <span class="ios-bnav-icon">${item.icon}</span>
      <span class="ios-bnav-label">${item.label}</span>
      <span class="ios-bnav-dot" id="bnav-dot-${item.id}"></span>
    </a>`;
  }).join('');

  // Sheet nav items (all pages)
  const sheetNavHTML = navItems.filter(i => !i.roles || i.roles.includes(role)).map(item => {
    const sectionHeader = item.section ? `<div class="ios-admin-sheet-section">${item.section}</div>` : '';
    const isActive = currentPage === item.id ? ' active-page' : '';
    return `${sectionHeader}
      <a href="${item.href}" class="ios-admin-sheet-link${isActive}">
        <span class="si-icon">${item.icon || '·'}</span>
        ${item.label}
        <span class="si-chevron">›</span>
      </a>`;
  }).join('');

  const mobileShell = `
    <!-- iOS Admin Topbar -->
    <div class="ios-admin-bar" id="ios-admin-bar">
      <div class="ios-admin-bar-logo">In<span>Dubai</span></div>
      <div class="ios-admin-bar-page">${escapeHtml(pageLabel)}</div>
      <div class="ios-admin-bar-actions">
        <button class="ios-bar-btn" onclick="toggleNotifPanel()" title="Notifiche">
          🔔<span class="ios-bar-badge" id="ios-bell-badge"></span>
        </button>
      </div>
    </div>

    <!-- Pull to refresh indicator -->
    <div class="admin-ptr-bar" id="admin-ptr-bar">
      <div class="admin-ptr-pill"><div class="admin-ptr-spin"></div>Aggiornamento...</div>
    </div>

    <!-- Bottom nav -->
    <nav class="ios-bottom-nav" id="ios-bottom-nav">
      <div class="ios-bottom-nav-inner">${bnavHTML}</div>
    </nav>

    <!-- Sheet overlay -->
    <div class="ios-admin-sheet-overlay" id="admin-sheet-overlay" onclick="closeAdminSheet()"></div>

    <!-- Sheet drawer -->
    <div class="ios-admin-sheet" id="ios-admin-sheet">
      <div class="ios-admin-sheet-handle"></div>
      <div class="ios-admin-sheet-user">
        <div class="ios-admin-sheet-name">${escapeHtml(profile?.full_name || 'Utente')}</div>
        <div class="ios-admin-sheet-role">${profile?.role || 'staff'}</div>
      </div>
      ${sheetNavHTML}
      <button class="ios-admin-sheet-logout" onclick="closeAdminSheet();sb.signOut()">⏻ Esci dall'account</button>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', mobileShell);

  // Sheet open/close
  window.openAdminSheet = function() {
    document.getElementById('ios-admin-sheet').classList.add('open');
    document.getElementById('admin-sheet-overlay').style.display = 'block';
    requestAnimationFrame(function() { document.getElementById('admin-sheet-overlay').classList.add('open'); });
  };
  window.closeAdminSheet = function() {
    document.getElementById('ios-admin-sheet').classList.remove('open');
    document.getElementById('admin-sheet-overlay').classList.remove('open');
    setTimeout(function() { document.getElementById('admin-sheet-overlay').style.display = 'none'; }, 320);
  };

  // Swipe down sheet to close
  (function() {
    var sh = document.getElementById('ios-admin-sheet'), sy = 0;
    if (!sh) return;
    sh.addEventListener('touchstart', function(e){ sy = e.touches[0].clientY; }, { passive: true });
    sh.addEventListener('touchend', function(e){ if (e.changedTouches[0].clientY - sy > 60) closeAdminSheet(); }, { passive: true });
  })();

  // Pull to refresh
  (function() {
    var startY = 0, pulling = false, triggered = false;
    var THRESHOLD = 65;
    var bar = document.getElementById('admin-ptr-bar');
    function gst() { return document.documentElement.scrollTop || window.scrollY || 0; }
    document.addEventListener('touchstart', function(e) {
      if (gst() <= 2) { startY = e.touches[0].clientY; pulling = true; triggered = false; }
      else { pulling = false; }
    }, { passive: true });
    document.addEventListener('touchmove', function(e) {
      if (!pulling) return;
      if (e.touches[0].clientY - startY > 10 && gst() <= 2) { if (bar) bar.classList.add('visible'); }
    }, { passive: true });
    document.addEventListener('touchend', function(e) {
      if (!pulling) return; pulling = false;
      var delta = e.changedTouches[0].clientY - startY;
      if (delta > THRESHOLD && !triggered) {
        triggered = true;
        if (bar) bar.classList.add('visible');
        setTimeout(function() { window.location.reload(); }, 400);
      } else { if (bar) bar.classList.remove('visible'); }
    }, { passive: true });
  })();

  // Sync bell badge with iOS bar badge
  var _origLoad = window.loadNotifications;
  window.loadNotifications = async function() {
    if (_origLoad) await _origLoad();
    var badge = document.getElementById('bell-badge');
    var iosBadge = document.getElementById('ios-bell-badge');
    if (badge && iosBadge) {
      var count = badge.textContent;
      iosBadge.textContent = count;
      iosBadge.style.display = parseInt(count) > 0 ? 'flex' : 'none';
    }
  };

  // ── ONESIGNAL PUSH (staff) ──────────────────────────────────
  (function initStaffPush() {
    if (!profile?.id) return;
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    OneSignalDeferred.push(async function(OneSignal) {
      try {
        await OneSignal.init({
          appId: '06f381cd-ed3d-4393-a5c2-3f6ef8322661',
          serviceWorkerPath: '/OneSignalSDKWorker.js',
          notifyButton: { enable: false },
          welcomeNotification: { disable: true },
        });
        await OneSignal.login(profile.id);
        await OneSignal.User.addTag('role', profile.role || 'staff');
        await OneSignal.User.addTag('staff', 'true');
        var perm = OneSignal.Notifications.permissionNative;
        if (perm === 'default') {
          setTimeout(showStaffPushPrompt, 4000);
        }
      } catch(e) { console.warn('OneSignal staff:', e); }
    });
  })();

  function showStaffPushPrompt() {
    if (document.getElementById('staff-push-prompt')) return;
    var s = document.createElement('style');
    s.textContent = '@keyframes sadminUp{from{transform:translateY(80px);opacity:0}to{transform:translateY(0);opacity:1}}';
    document.head.appendChild(s);
    var el = document.createElement('div');
    el.id = 'staff-push-prompt';
    el.style.cssText = 'position:fixed;bottom:calc(68px + env(safe-area-inset-bottom,0px));left:12px;right:12px;background:#0f1628;border:1px solid rgba(201,168,76,0.3);border-radius:16px;padding:14px 16px;z-index:500;box-shadow:0 8px 32px rgba(0,0,0,.5);display:flex;align-items:center;gap:12px;animation:sadminUp .35s ease';
    el.innerHTML = '<span style="font-size:22px">🔔</span><div style="flex:1"><div style="font-size:13px;font-weight:700;color:white;margin-bottom:2px">Attiva notifiche push</div><div style="font-size:11px;color:rgba(255,255,255,.5)">Ricevi alert su task, scadenze e clienti</div></div><button onclick="acceptStaffPush()" style="background:#c9a84c;color:#0f1628;border:none;border-radius:9px;padding:7px 13px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;flex-shrink:0">Attiva</button><button onclick="this.parentElement.remove()" style="background:none;border:none;color:rgba(255,255,255,.35);font-size:18px;cursor:pointer;padding:0 2px;flex-shrink:0">&times;</button>';
    document.body.appendChild(el);
  }
  window.acceptStaffPush = function() {
    var el = document.getElementById('staff-push-prompt');
    if (el) el.remove();
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    OneSignalDeferred.push(async function(OS) {
      try { await OS.Notifications.requestPermission(); } catch(e) {}
    });
  };

})();
