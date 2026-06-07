// قالب لوحة المشرف العام — sidebar + header + bottom-nav.
// يطابق هيكلة لوحة المالك (window.layout) ويعيد استخدام نفس أصناف CSS (.app-shell, .sidebar...)
// فيرث كل سلوك الشريط الجانبي المتجاوب. لا يحتاج tenant — يستخدم requireSuperAdmin.
//
// يُسجَّل كـ window.layout حتى يعمل الراوتر دون تعديل (router يستدعي window.layout.setActive).
//
// API عام:
//   mountShell(): يُركّب الـ shell ويرجع ctx { user, isSuperAdmin }
//   setActive(routeKey, pageTitle): يحدّث الـ active + breadcrumb
//   getContext(): ctx
//   NAV_ITEMS: مصفوفة عناصر التنقل

window.layout = (function () {
  const NAV_ITEMS = [
    { key: 'admin-overview',      group: 'رئيسي',  label: 'نظرة عامة',     icon: 'layout-dashboard', path: '/admin/overview' },
    { key: 'admin-subscriptions', group: 'الإدارة', label: 'طلبات الاشتراك', icon: 'credit-card',       path: '/admin/subscriptions' },
    { key: 'admin-tenants',       group: 'الإدارة', label: 'الملاعب',        icon: 'goal',              path: '/admin/tenants' }
  ];

  const BOTTOM_NAV = [
    { key: 'admin-overview',      label: 'نظرة',    icon: 'layout-dashboard', path: '/admin/overview' },
    { key: 'admin-subscriptions', label: 'الطلبات', icon: 'credit-card',       path: '/admin/subscriptions' },
    { key: 'admin-tenants',       label: 'الملاعب', icon: 'goal',              path: '/admin/tenants' }
  ];

  let adminCtx = null;

  function getInitial(name) {
    if (!name) return '?';
    const trimmed = name.trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
  }

  function buildNavHtml() {
    const groups = [];
    let lastGroup = null;
    NAV_ITEMS.forEach((it) => {
      if (it.group !== lastGroup) {
        groups.push({ label: it.group, items: [] });
        lastGroup = it.group;
      }
      groups[groups.length - 1].items.push(it);
    });
    return groups.map((g) => `
      <div class="nav-group">
        ${g.label ? `<div class="nav-group-label">${window.utils.escapeHtml(g.label)}</div>` : ''}
        ${g.items.map((item) => `
          <a href="${window.utils.path(item.path)}" data-nav-key="${item.key}" title="${window.utils.escapeHtml(item.label)}">
            <span class="nav-icon"><i data-lucide="${item.icon}"></i></span>
            <span class="nav-label">${window.utils.escapeHtml(item.label)}</span>
          </a>`).join('')}
      </div>
    `).join('');
  }

  function buildBottomNavHtml() {
    return `
      <nav class="bottom-nav" id="bottom-nav" aria-label="التنقل السفلي">
        <div class="bottom-nav-list">
          ${BOTTOM_NAV.map((it) => `
            <a href="${window.utils.path(it.path)}" data-bottom-key="${it.key}">
              <span class="nav-icon"><i data-lucide="${it.icon}"></i></span>
              <span>${window.utils.escapeHtml(it.label)}</span>
            </a>`).join('')}
        </div>
      </nav>
    `;
  }

  async function mountShell() {
    const ctx = await window.auth.requireSuperAdmin();
    adminCtx = ctx;
    // اجلب أحدث بيانات المستخدم (الاسم) — جلسة الـ JWT قد تكون أقدم من تحديث الاسم
    let user = ctx.user;
    try {
      const { data } = await window.sb.auth.getUser();
      if (data && data.user) user = data.user;
    } catch (_) {}
    const email = user.email || '';
    const meta = user.user_metadata || {};
    const name = meta.display_name || meta.full_name || email;

    document.body.classList.add('app-body');
    const root = document.getElementById('app-root') || document.body;

    let sidebarState = '';
    try {
      const stored = localStorage.getItem('marma:sidebar:collapsed');
      if (stored === 'true')  sidebarState = 'collapsed';
      if (stored === 'false') sidebarState = 'expanded';
    } catch (_) {}

    root.innerHTML = `
      <div class="app-shell" ${sidebarState ? `data-sidebar="${sidebarState}"` : ''}>
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-brand">
            <span class="sidebar-brand-logo"><i data-lucide="shield"></i></span>
            <div class="sidebar-brand-text">
              <span class="brand-title" style="font-weight:var(--weight-bold)">لوحة المشرف</span>
              <span class="tenant-name">المشرف العام</span>
            </div>
          </div>

          <nav class="sidebar-nav" aria-label="التنقل الرئيسي">
            ${buildNavHtml()}
          </nav>

          <div class="sidebar-footer">
            <button type="button" class="sidebar-edge-toggle" id="sidebar-collapse-btn" aria-label="طيّ القائمة" aria-controls="sidebar" title="طيّ القائمة">
              <i data-lucide="chevron-right"></i>
            </button>
            <div class="user-menu" id="user-menu">
              <button type="button" class="sidebar-user" aria-haspopup="true" aria-expanded="false">
                <span class="user-avatar">${window.utils.escapeHtml(getInitial(name))}</span>
                <span class="sidebar-user-text">
                  <span class="sidebar-user-name">${window.utils.escapeHtml(name)}</span>
                  <span class="sidebar-user-role">مشرف عام</span>
                </span>
                <i class="sidebar-user-caret" data-lucide="chevrons-up-down"></i>
              </button>
              <div class="user-menu-dropdown">
                <button type="button" class="item danger" id="signout-btn">
                  <i data-lucide="log-out"></i><span>تسجيل الخروج</span>
                </button>
              </div>
            </div>
          </div>
        </aside>

        <div class="sidebar-overlay" id="sidebar-overlay"></div>

        <div class="main-area">
          <header class="app-header">
            <div class="app-header-start">
              <button class="menu-toggle" id="menu-toggle" aria-label="القائمة">
                <i data-lucide="menu"></i>
              </button>
              <nav class="breadcrumb" id="breadcrumb" aria-label="المسار">
                <span class="breadcrumb-item is-current" id="page-title-leaf"></span>
              </nav>
            </div>
            <div class="app-header-end">
              <span id="theme-toggle-slot"></span>
            </div>
          </header>

          <main class="page-content" id="page-content"></main>
        </div>

        ${buildBottomNavHtml()}
      </div>
    `;

    // ─── ربط الأحداث ───
    const userMenu = document.getElementById('user-menu');
    const userMenuTrigger = userMenu.querySelector('.sidebar-user');
    userMenuTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = userMenu.classList.toggle('open');
      userMenuTrigger.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
      if (!userMenu.contains(e.target)) {
        userMenu.classList.remove('open');
        userMenuTrigger.setAttribute('aria-expanded', 'false');
      }
    });

    document.getElementById('signout-btn').addEventListener('click', () => {
      window.auth.signOut('/auth/login');
    });

    // Sidebar drawer (الجوال)
    document.getElementById('menu-toggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.add('open');
      document.getElementById('sidebar-overlay').classList.add('open');
      document.getElementById('sidebar-overlay').style.display = 'block';
    });
    document.getElementById('sidebar-overlay').addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebar-overlay').classList.remove('open');
      document.getElementById('sidebar-overlay').style.display = 'none';
    });

    // طيّ الـ sidebar (سطح المكتب)
    document.getElementById('sidebar-collapse-btn').addEventListener('click', () => {
      const shell = root.querySelector('.app-shell');
      const current = shell.getAttribute('data-sidebar');
      const next = current === 'collapsed' ? 'expanded' : 'collapsed';
      shell.setAttribute('data-sidebar', next);
      try { localStorage.setItem('marma:sidebar:collapsed', next === 'collapsed' ? 'true' : 'false'); } catch (_) {}
    });

    // Theme toggle
    const themeSlot = document.getElementById('theme-toggle-slot');
    if (window.themeToggle && themeSlot) {
      window.themeToggle.render(themeSlot);
    }

    window.utils.renderIcons(root);
    return ctx;
  }

  function setActive(routeKey, pageTitle) {
    document.querySelectorAll('.sidebar-nav a[data-nav-key]').forEach((a) => {
      a.classList.toggle('active', a.dataset.navKey === routeKey);
    });
    document.querySelectorAll('.bottom-nav a[data-bottom-key]').forEach((a) => {
      a.classList.toggle('active', a.dataset.bottomKey === routeKey);
    });

    const wrap = document.getElementById('breadcrumb');
    if (wrap) {
      wrap.innerHTML = `<span class="breadcrumb-item is-current" id="page-title-leaf">${window.utils.escapeHtml(pageTitle || '')}</span>`;
    }
    if (pageTitle) document.title = `${pageTitle} - مَرمى`;

    // أغلق الـ drawer على الجوال
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sidebar-overlay');
    if (sb) sb.classList.remove('open');
    if (ov) { ov.classList.remove('open'); ov.style.display = 'none'; }
  }

  function getContext() { return adminCtx; }

  return { mountShell, setActive, getContext, NAV_ITEMS };
})();
