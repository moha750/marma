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

  // عناصر الـ bottom-nav للجوال
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
    // days_until_expiry = أيام حتى نهاية التجربة/الاشتراك (بدون فترة سماح)
    // days_remaining    = أيام حتى القفل الكامل (مع فترة السماح للاشتراك المدفوع)
    const daysToExpiry = Math.max(0, Number(status.days_until_expiry) || 0);
    const daysToLock   = Math.max(0, Number(status.days_remaining) || 0);
    let kind = '', text = '';
    if (phase === 'trial') {
      kind = 'trial';
      text = `تجربة مجانية — متبقي ${daysToExpiry} ${pluralDays(daysToExpiry)}`;
    } else if (phase === 'grace_active') {
      kind = 'grace';
      text = `انتهى الاشتراك — فترة سماح ${daysToLock} ${pluralDays(daysToLock)}، يرجى التجديد`;
    } else if (phase === 'active' && daysToExpiry <= 7) {
      kind = 'soon';
      text = `الاشتراك ينتهي خلال ${daysToExpiry} ${pluralDays(daysToExpiry)}`;
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

  function buildNavHtml(profile, isLocked) {
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
        ${g.items.map((item) => {
          // عند انتهاء الاشتراك: كل التبويبات تُقفل بصرياً عدا "الاشتراك" الذي يُبرز كمخرج وحيد.
          // المقفول بلا href ⇒ غير قابل للنقر ولا التنقّل (الراوتر يتجاهل الروابط بلا href).
          const locked   = isLocked && item.key !== 'subscription';
          const unlock   = isLocked && item.key === 'subscription';
          const hrefAttr = locked ? '' : ` href="${window.utils.path(item.path)}"`;
          const cls      = locked ? ' class="nav-link--locked"' : (unlock ? ' class="nav-link--unlock"' : '');
          const title    = locked ? 'جدّد اشتراكك للوصول' : item.label;
          const lockAttr = locked ? ' aria-disabled="true" tabindex="-1"' : '';
          const lockIcon = locked ? `<span class="nav-lock"><i data-lucide="lock"></i></span>` : '';
          return `
          <a${hrefAttr} data-nav-key="${item.key}"${cls}${lockAttr} title="${window.utils.escapeHtml(title)}">
            <span class="nav-icon"><i data-lucide="${item.icon}"></i></span>
            <span class="nav-label">${window.utils.escapeHtml(item.label)}</span>
            ${lockIcon}
          </a>`;
        }).join('')}
      </div>
    `).join('');
  }

  function buildBottomNavHtml(isLocked) {
    return `
      <nav class="bottom-nav" id="bottom-nav" aria-label="التنقل السفلي">
        <div class="bottom-nav-list">
          ${BOTTOM_NAV.map((it) => {
            // كل عناصر الـ bottom-nav تشغيلية، فجميعها تُقفل عند انتهاء الاشتراك.
            // المقفول بلا href ⇒ غير قابل للنقر ولا التنقّل.
            const hrefAttr = isLocked ? '' : ` href="${window.utils.path(it.path)}"`;
            const cls  = isLocked ? ' class="nav-link--locked"' : '';
            const aria = isLocked ? ' aria-disabled="true" tabindex="-1"' : '';
            const lock = isLocked ? `<span class="nav-lock"><i data-lucide="lock"></i></span>` : '';
            return `
            <a${hrefAttr} data-bottom-key="${it.key}"${cls}${aria}>
              <span class="nav-icon"><i data-lucide="${it.icon}"></i>${lock}</span>
              <span>${window.utils.escapeHtml(it.label)}</span>
            </a>`;
          }).join('')}
        </div>
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

    // اشتراك منتهٍ ⇒ نقفل التبويبات بصرياً (الراوتر يبقى خط الدفاع للروابط المباشرة)
    const isLocked = !!(ctx.status && ctx.status.is_active === false);

    document.body.classList.add('app-body');
    const root = document.getElementById('app-root') || document.body;

    const navHtml = buildNavHtml(profile, isLocked);
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
            <div class="install-cta" id="install-cta" hidden>
              <button type="button" class="install-cta-btn" id="install-btn" title="ثبّت التطبيق على جهازك">
                <i data-lucide="download"></i>
                <span>ثبّت التطبيق</span>
              </button>
            </div>
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

        ${buildBottomNavHtml(isLocked)}
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

    // PWA install prompt — أظهر الزر عند توفر beforeinstallprompt (Android/Desktop)
    // أو على iOS (مع modal تعليمات بدلاً من prompt برمجي)
    const installCta = document.getElementById('install-cta');
    const installBtn = document.getElementById('install-btn');
    if (installCta && installBtn && window.pwa) {
      const iosManual = window.pwa.needsManualInstall && window.pwa.needsManualInstall();

      const showCta = () => {
        if (window.pwa.isStandalone()) return;
        if (window.pwa.isInstallable() || iosManual) {
          installCta.hidden = false;
          // على iOS غيّر النص ليناسب التعليمات اليدوية
          if (iosManual) {
            const label = installBtn.querySelector('span');
            if (label) label.textContent = 'ثبّت على iPhone';
            installBtn.title = 'كيفية تثبيت التطبيق على iPhone';
          }
        }
      };
      showCta();
      window.addEventListener('pwa:installable', () => { installCta.hidden = false; });
      window.addEventListener('pwa:installed',   () => { installCta.hidden = true;  });
      installBtn.addEventListener('click', async () => {
        // iOS: اعرض modal بالتعليمات اليدوية
        if (iosManual) {
          showIOSInstallHelp();
          return;
        }
        // Android/Desktop: استخدم prompt البرمجي
        installBtn.disabled = true;
        try {
          const res = await window.pwa.promptInstall();
          if (res && res.outcome === 'accepted') {
            installCta.hidden = true;
          }
        } finally {
          installBtn.disabled = false;
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

    // breadcrumb — يُعاد بناؤه دائماً لأن setBreadcrumbs() قد يكون مسح الـ id
    const wrap = document.getElementById('breadcrumb');
    if (wrap) {
      wrap.innerHTML = `<span class="breadcrumb-item is-current" id="page-title-leaf">${window.utils.escapeHtml(pageTitle || '')}</span>`;
    }

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

  // ─── Modal تعليمات تثبيت iOS ─────────────────────────────
  // iOS Safari لا يطلق beforeinstallprompt، فالتثبيت يدوي عبر Share menu.
  function showIOSInstallHelp() {
    const existing = document.getElementById('ios-install-help');
    if (existing) { existing.remove(); return; }

    const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
    const safariWarning = isSafari ? '' : `
      <div style="background:var(--warning-tint);color:var(--warning);padding:var(--space-3);border-radius:var(--radius-md);margin-bottom:var(--space-4);font-size:var(--text-sm)">
        <strong>ملاحظة:</strong> أنت في متصفح غير Safari. التثبيت على iPhone يتطلّب Safari تحديداً. افتح الرابط <code>marma.help</code> في Safari ثم اتبع الخطوات.
      </div>
    `;

    const html = `
      <div id="ios-install-help" style="position:fixed;inset:0;background:rgba(20,22,18,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:var(--space-4)">
        <div style="background:var(--surface-1);border-radius:var(--radius-lg);padding:var(--space-5);max-width:420px;width:100%;box-shadow:var(--shadow-3);max-height:90vh;overflow-y:auto">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-4)">
            <h3 style="margin:0;font-size:var(--text-lg)">ثبّت مَرمى على iPhone</h3>
            <button type="button" id="ios-help-close-x" style="background:transparent;border:0;cursor:pointer;color:var(--text-secondary);padding:var(--space-1)" aria-label="إغلاق">
              <i data-lucide="x"></i>
            </button>
          </div>
          ${safariWarning}
          <ol style="padding-inline-start:var(--space-5);margin:0 0 var(--space-4);line-height:1.7">
            <li style="margin-bottom:var(--space-3)">
              في Safari، اضغط زر <strong>المشاركة</strong>
              <i data-lucide="share" style="display:inline-block;vertical-align:middle;width:16px;height:16px;margin:0 4px"></i>
              في شريط الأدوات السفلي.
            </li>
            <li style="margin-bottom:var(--space-3)">
              مرّر القائمة للأسفل واختر <strong>"إضافة إلى الشاشة الرئيسية"</strong>
              <span style="white-space:nowrap">(Add to Home Screen)</span>.
            </li>
            <li style="margin-bottom:var(--space-3)">
              اضغط <strong>"إضافة"</strong> في الأعلى.
            </li>
            <li>افتح التطبيق من أيقونته على الشاشة الرئيسية — سيعمل بدون شريط متصفح، وستظهر خيارات الإشعارات.</li>
          </ol>
          <button type="button" class="btn btn--primary btn--block" id="ios-help-close">حسناً، فهمت</button>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
    const root = document.getElementById('ios-install-help');
    const close = () => root.remove();
    root.querySelector('#ios-help-close').addEventListener('click', close);
    root.querySelector('#ios-help-close-x').addEventListener('click', close);
    root.addEventListener('click', (e) => { if (e.target === root) close(); });
    window.utils.renderIcons(root);
  }

  return { mountShell, setActive, setBreadcrumbs, getContext, NAV_ITEMS };
})();
