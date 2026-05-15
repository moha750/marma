// قالب التطبيق — sidebar + header + bottom-nav.
// يُستدعى مرة واحدة عند الإقلاع: window.layout.mountShell()
// ثم window.layout.setActive(routeKey, pageTitle) عند كل تغيير مسار.
//
// API عام (للتوافق مع كود الصفحات):
//   mountShell({ skipActiveCheck }): يُركّب الـ shell ويرجع ctx
//   setActive(routeKey, pageTitle): يحدّث الـ active + breadcrumb
//   setBreadcrumbs([{ label, path? }, ...]): استخدام مُتقدّم لصفحات التفاصيل
//   getContext(): { profile, tenant, status }
//   NAV_ITEMS: مصفوفة عناصر التنقل

window.layout = (function () {
  // التنقل مع التجميع — يُستخدمها sidebar و command-palette
  const NAV_ITEMS = [
    { key: 'dashboard',    group: 'تشغيلي', label: 'لوحة التحكم',          icon: 'layout-dashboard', path: '/dashboard' },
    { key: 'calendar',     group: 'تشغيلي', label: 'التقويم',              icon: 'calendar-days',    path: '/calendar' },
    { key: 'bookings',     group: 'تشغيلي', label: 'الحجوزات',             icon: 'clipboard-list',   path: '/bookings' },
    { key: 'customers',    group: 'تشغيلي', label: 'العملاء',              icon: 'users',            path: '/customers' },
    { key: 'fields',       group: 'إدارة',  label: 'الأرضيات',             icon: 'goal',             path: '/fields',       ownerOnly: true },
    { key: 'schedule',     group: 'إدارة',  label: 'أيام وفترات العمل',    icon: 'clock',            path: '/schedule',     ownerOnly: true },
    { key: 'reports',      group: 'إدارة',  label: 'التقارير',             icon: 'trending-up',      path: '/reports',      ownerOnly: true },
    { key: 'staff',        group: 'إدارة',  label: 'الموظفون',             icon: 'user',             path: '/staff',        ownerOnly: true },
    { key: 'subscription', group: 'حساب',   label: 'الاشتراك',             icon: 'credit-card',      path: '/subscription', ownerOnly: true },
    { key: 'settings',     group: 'حساب',   label: 'إعدادات الملعب',       icon: 'settings',         path: '/settings' }
  ];

  // عناصر الـ bottom-nav للجوال (الـ FAB ينشئ حجزاً جديداً)
  const BOTTOM_NAV = [
    { key: 'dashboard', label: 'لوحة',     icon: 'layout-dashboard', path: '/dashboard' },
    { key: 'calendar',  label: 'التقويم',  icon: 'calendar-days',    path: '/calendar' },
    { key: 'bookings',  label: 'الحجوزات', icon: 'clipboard-list',   path: '/bookings' },
    { key: 'customers', label: 'العملاء',  icon: 'users',            path: '/customers' }
  ];

  let spaCtx = null;

  // ─── بانر الاشتراك ───────────────────────────────────────

  function renderTrialBanner(status, activePage) {
    if (!status || activePage === 'subscription') return '';
    const phase = status.phase;
    const days = Math.max(0, Number(status.days_remaining) || 0);
    let kind = '', text = '';
    if (phase === 'trial') {
      kind = 'trial';
      text = `تجربة مجانية — متبقي ${days} ${pluralDays(days)}`;
    } else if (phase === 'grace_trial') {
      kind = 'grace';
      text = `انتهت التجربة — فترة سماح ${days} ${pluralDays(days)}، يرجى الاشتراك`;
    } else if (phase === 'grace_active') {
      kind = 'grace';
      text = `انتهى الاشتراك — فترة سماح ${days} ${pluralDays(days)}، يرجى التجديد`;
    } else if (phase === 'active' && days <= 7) {
      kind = 'soon';
      text = `الاشتراك ينتهي خلال ${days} ${pluralDays(days)}`;
    } else {
      return '';
    }
    const iconName = kind === 'grace' ? 'triangle-alert' : 'info';
    return `
      <div class="trial-banner trial-banner--${kind}">
        <span class="trial-banner-icon"><i data-lucide="${iconName}"></i></span>
        <span>${window.utils.escapeHtml(text)}</span>
        <a class="trial-banner-cta" href="${window.utils.path('/subscription')}">تجديد الاشتراك</a>
      </div>
    `;
  }

  function pluralDays(n) {
    return n === 1 ? 'يوم' : (n === 2 ? 'يومان' : 'أيام');
  }

  function getInitial(name) {
    if (!name) return '?';
    const trimmed = name.trim();
    return trimmed ? trimmed.charAt(0) : '?';
  }

  // ─── بناء التنقل المُجمَّع ───────────────────────────────

  function buildNavHtml(profile) {
    const visible = NAV_ITEMS.filter((it) => !it.ownerOnly || profile.role === 'owner');
    const groups = [];
    let lastGroup = null;
    visible.forEach((it) => {
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
          </a>
        `).join('')}
      </div>
    `).join('');
  }

  function buildBottomNavHtml() {
    return `
      <nav class="bottom-nav" id="bottom-nav" aria-label="التنقل السفلي">
        <div class="bottom-nav-list">
          ${BOTTOM_NAV.slice(0, 2).map((it) => `
            <a href="${window.utils.path(it.path)}" data-bottom-key="${it.key}">
              <span class="nav-icon"><i data-lucide="${it.icon}"></i></span>
              <span>${window.utils.escapeHtml(it.label)}</span>
            </a>
          `).join('')}
          ${BOTTOM_NAV.slice(2).map((it) => `
            <a href="${window.utils.path(it.path)}" data-bottom-key="${it.key}">
              <span class="nav-icon"><i data-lucide="${it.icon}"></i></span>
              <span>${window.utils.escapeHtml(it.label)}</span>
            </a>
          `).join('')}
        </div>
        <button type="button" class="bottom-nav-fab" id="bottom-nav-fab" aria-label="حجز جديد">
          <i data-lucide="plus"></i>
        </button>
      </nav>
    `;
  }

  // ─── تركيب الـ shell ─────────────────────────────────────

  async function mountShell({ skipActiveCheck = false } = {}) {
    let ctx;
    if (skipActiveCheck) {
      ctx = await window.auth.requireAuth();
      try { ctx.status = await window.auth.loadSubscriptionStatus(); } catch (_) {}
    } else {
      try {
        ctx = await window.auth.requireActiveTenant(false);
      } catch (err) {
        if (err && err.message === 'SUBSCRIPTION_EXPIRED') {
          const result = await mountShell({ skipActiveCheck: true });
          history.replaceState(null, '', window.utils.path('/subscription'));
          return result;
        }
        throw err;
      }
    }

    const { profile, tenant } = ctx;
    const isSuperAdmin = await window.auth.checkIsSuperAdmin();
    spaCtx = ctx;

    document.body.classList.add('app-body');
    const root = document.getElementById('app-root') || document.body;

    const navHtml = buildNavHtml(profile);
    const adminLinkHtml = isSuperAdmin
      ? `<a href="${window.utils.path('/admin/subscriptions')}" class="admin-link" title="لوحة المشرف">
           <span class="nav-icon"><i data-lucide="shield"></i></span>
           <span class="nav-label">لوحة المشرف</span>
         </a>`
      : '';

    // استرجع حالة الطيّ المحفوظة
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
            <span class="sidebar-brand-logo"><img src="${window.utils.path('/assets/logo-mark.svg')}" alt="" aria-hidden="true"></span>
            <div class="sidebar-brand-text">
              <img src="${window.utils.path('/assets/logo-wordmark.svg')}" alt="مَرمى" class="brand-title">
              <span class="tenant-name">${window.utils.escapeHtml(tenant ? tenant.name : '')}</span>
            </div>
          </div>

          <nav class="sidebar-nav" aria-label="التنقل الرئيسي">
            ${navHtml}
            ${adminLinkHtml ? `<div class="nav-group">${adminLinkHtml}</div>` : ''}
          </nav>

          <div class="sidebar-footer">
            <button type="button" class="sidebar-edge-toggle" id="sidebar-collapse-btn" aria-label="طيّ القائمة" aria-controls="sidebar" title="طيّ القائمة">
              <i data-lucide="chevron-right"></i>
            </button>
            <div class="user-menu" id="user-menu">
              <button type="button" class="sidebar-user" aria-haspopup="true" aria-expanded="false">
                <span class="user-avatar">${window.utils.escapeHtml(getInitial(profile.full_name))}</span>
                <span class="sidebar-user-text">
                  <span class="sidebar-user-name">${window.utils.escapeHtml(profile.full_name || '')}</span>
                  <span class="sidebar-user-role">${profile.role === 'owner' ? 'مالك' : 'موظف'}</span>
                </span>
                <i class="sidebar-user-caret" data-lucide="chevrons-up-down"></i>
              </button>
              <div class="user-menu-dropdown">
                <button type="button" class="item" id="user-menu-palette">
                  <i data-lucide="command"></i><span>لوحة الأوامر</span>
                </button>
                <div class="divider"></div>
                <button type="button" class="item danger" id="signout-btn">
                  <i data-lucide="log-out"></i><span>تسجيل الخروج</span>
                </button>
              </div>
            </div>
          </div>
        </aside>

        <div class="sidebar-overlay" id="sidebar-overlay"></div>

        <div class="main-area">
          <div id="trial-banner-slot"></div>

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
              <button type="button" class="palette-trigger" id="palette-trigger" aria-label="بحث">
                <i data-lucide="search"></i>
                <span>ابحث في كل شيء</span>
              </button>
              <button type="button" class="header-icon-btn" id="palette-trigger-mobile" aria-label="بحث">
                <i data-lucide="search"></i>
              </button>
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
      window.auth.signOut();
    });

    document.getElementById('user-menu-palette').addEventListener('click', () => {
      userMenu.classList.remove('open');
      if (window.commandPalette) window.commandPalette.open();
    });

    // Sidebar toggle (الجوال)
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

    // Command Palette triggers
    document.getElementById('palette-trigger').addEventListener('click', () => {
      if (window.commandPalette) window.commandPalette.open();
    });
    document.getElementById('palette-trigger-mobile').addEventListener('click', () => {
      if (window.commandPalette) window.commandPalette.open();
    });

    // Theme toggle
    const themeSlot = document.getElementById('theme-toggle-slot');
    if (window.themeToggle && themeSlot) {
      window.themeToggle.render(themeSlot);
    }

    // FAB — حجز جديد
    const fab = document.getElementById('bottom-nav-fab');
    if (fab) {
      fab.addEventListener('click', () => {
        if (window.bookingModal && window.bookingModal.open) {
          window.bookingModal.open();
        } else {
          const navigate = window.utils.path('/calendar');
          if (window.router && window.router.navigate) window.router.navigate(navigate);
          else window.location.href = navigate;
        }
      });
    }

    window.utils.renderIcons(root);
    return ctx;
  }

  // ─── تحديث الـ shell عند تغيير المسار ────────────────────

  function setActive(routeKey, pageTitle) {
    // إبراز عنصر الـ sidebar النشط
    document.querySelectorAll('.sidebar-nav a[data-nav-key]').forEach((a) => {
      a.classList.toggle('active', a.dataset.navKey === routeKey);
    });

    // إبراز عنصر الـ bottom-nav النشط
    document.querySelectorAll('.bottom-nav a[data-bottom-key]').forEach((a) => {
      a.classList.toggle('active', a.dataset.bottomKey === routeKey);
    });

    // breadcrumb — العنصر الورقي
    const leaf = document.getElementById('page-title-leaf');
    if (leaf) leaf.textContent = pageTitle || '';

    // عنوان الصفحة في تبويب المتصفح
    if (pageTitle) document.title = `${pageTitle} - مَرمى`;

    // بانر الاشتراك
    const slot = document.getElementById('trial-banner-slot');
    if (slot && spaCtx) {
      slot.innerHTML = renderTrialBanner(spaCtx.status, routeKey);
      window.utils.renderIcons(slot);
    }

    // أغلق الـ sidebar drawer على الجوال
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sidebar-overlay');
    if (sb) sb.classList.remove('open');
    if (ov) { ov.classList.remove('open'); ov.style.display = 'none'; }
  }

  // breadcrumb متعدّد العناصر (للصفحات العميقة كتفاصيل العميل)
  function setBreadcrumbs(crumbs) {
    if (!Array.isArray(crumbs) || crumbs.length === 0) return;
    const wrap = document.getElementById('breadcrumb');
    if (!wrap) return;
    const sep = '<span class="breadcrumb-sep"><i data-lucide="chevron-left"></i></span>';
    wrap.innerHTML = crumbs.map((c, i) => {
      const label = window.utils.escapeHtml(c.label || '');
      const isLast = i === crumbs.length - 1;
      if (isLast || !c.path) {
        return `<span class="breadcrumb-item is-current">${label}</span>`;
      }
      return `<a class="breadcrumb-item" href="${window.utils.path(c.path)}">${label}</a>`;
    }).join(sep);
    window.utils.renderIcons(wrap);
  }

  function getContext() { return spaCtx; }

  return { mountShell, setActive, setBreadcrumbs, getContext, NAV_ITEMS };
})();
