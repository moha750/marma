// حقن sidebar + header المشترك لـ SPA shell
// يُستخدم: window.layout.mountShell() مرة واحدة من boot.js
// ثم window.layout.setActive(routeKey, title) عند كل تغيير مسار

window.layout = (function () {
  const NAV_ITEMS = [
    { key: 'dashboard',    label: 'لوحة التحكم',          icon: 'layout-dashboard', path: '/dashboard' },
    { key: 'calendar',     label: 'التقويم',              icon: 'calendar-days',    path: '/calendar' },
    { key: 'bookings',     label: 'الحجوزات',             icon: 'clipboard-list',   path: '/bookings' },
    { key: 'customers',    label: 'العملاء',              icon: 'users',            path: '/customers' },
    { key: 'fields',       label: 'الأرضيات',             icon: 'goal',             path: '/fields',       ownerOnly: true },
    { key: 'schedule',     label: 'أيام وفترات العمل',    icon: 'clock',            path: '/schedule',     ownerOnly: true },
    { key: 'reports',      label: 'التقارير',             icon: 'trending-up',      path: '/reports',      ownerOnly: true },
    { key: 'staff',        label: 'الموظفون',             icon: 'user',             path: '/staff',        ownerOnly: true },
    { key: 'subscription', label: 'الاشتراك',             icon: 'credit-card',      path: '/subscription', ownerOnly: true }
  ];

  let spaCtx = null; // ctx محفوظ للاستخدام في إعدادات الملعب وغيره

  // يرسم بانر حسب طور الاشتراك. لا يظهر إذا الطور 'active' وأكثر من 7 أيام.
  function renderTrialBanner(status, activePage) {
    if (!status || activePage === 'subscription') return '';
    const phase = status.phase;
    const days = Math.max(0, Number(status.days_remaining) || 0);
    let kind = '';
    let text = '';
    if (phase === 'trial') {
      kind = 'trial';
      text = `تجربة مجانية - متبقي ${days} ${pluralDays(days)}`;
    } else if (phase === 'grace_trial') {
      kind = 'grace';
      text = `انتهت التجربة - فترة سماح متبقية ${days} ${pluralDays(days)}، يرجى الاشتراك`;
    } else if (phase === 'grace_active') {
      kind = 'grace';
      text = `انتهى الاشتراك - فترة سماح متبقية ${days} ${pluralDays(days)}، يرجى التجديد`;
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
        <a class="trial-banner-cta" href="/subscription">تجديد الاشتراك</a>
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

  function buildPublicBookingLink(tenantId) {
    return `${window.location.origin}/book?t=${encodeURIComponent(tenantId)}`;
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }

  function openSettingsModal(tenant, profile) {
    const isOwner = profile.role === 'owner';
    const publicLink = buildPublicBookingLink(tenant.id);
    const formHtml = `
      <form id="settings-form" autocomplete="off">
        <div class="form-group">
          <label class="form-label">اسم الملعب <span class="required">*</span></label>
          <input type="text" class="form-control" name="name" value="${window.utils.escapeHtml(tenant.name || '')}" required ${isOwner ? '' : 'disabled'}>
        </div>
        <div class="form-row cols-2">
          <div class="form-group">
            <label class="form-label">المدينة</label>
            <input type="text" class="form-control" name="city" value="${window.utils.escapeHtml(tenant.city || '')}" ${isOwner ? '' : 'disabled'}>
          </div>
          <div class="form-group">
            <label class="form-label">رقم الجوال</label>
            <input type="tel" class="form-control" name="phone" value="${window.utils.escapeHtml(tenant.phone || '')}" ${isOwner ? '' : 'disabled'}>
          </div>
        </div>
        ${isOwner ? '' : '<p class="text-muted" style="font-size:0.9rem">يمكن للمالك فقط تعديل بيانات الملعب.</p>'}
      </form>

      <hr style="margin:20px 0;border:0;border-top:1px solid var(--color-border)">

      <div class="form-group">
        <label class="form-label">رابط الحجز العام</label>
        <div class="invite-link-box">
          <code>${window.utils.escapeHtml(publicLink)}</code>
          <button type="button" class="btn btn--primary btn--sm" id="copy-public-link">نسخ</button>
        </div>
        <span class="form-help">شارك هذا الرابط مع عملائك ليطلبوا الحجز بأنفسهم. الطلبات تظهر في لوحة التحكم بانتظار موافقتك.</span>
      </div>
    `;

    const footer = isOwner
      ? `<button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
         <button type="submit" class="btn btn--primary" form="settings-form">حفظ</button>`
      : `<button type="button" class="btn btn--secondary" data-action="cancel">إغلاق</button>`;

    const ctrl = window.utils.openModal({
      title: 'إعدادات الملعب',
      body: formHtml,
      footer
    });

    ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);

    const copyBtn = ctrl.modal.querySelector('#copy-public-link');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        copyToClipboard(publicLink);
        window.utils.toast('تم نسخ الرابط', 'success');
      });
    }

    if (isOwner) {
      ctrl.modal.querySelector('#settings-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          await window.api.updateTenant({
            name: fd.get('name'),
            city: fd.get('city') || null,
            phone: fd.get('phone') || null
          });
          window.utils.toast('تم حفظ إعدادات الملعب بنجاح', 'success');
          ctrl.close();
          const el = document.querySelector('.sidebar-brand .tenant-name');
          if (el) el.textContent = fd.get('name');
        } catch (err) {
          window.utils.toast(window.utils.formatError(err), 'error');
        }
      });
    }
  }

  // يُركَّب الـ shell مرة واحدة عند إقلاع التطبيق، ثم setActive عند كل تغيير مسار
  // (بدون إعادة رسم الـ sidebar أو إعادة جلب auth).
  async function mountShell({ skipActiveCheck = false } = {}) {
    let ctx;
    if (skipActiveCheck) {
      ctx = await window.auth.requireAuth();
      try { ctx.status = await window.auth.loadSubscriptionStatus(); } catch (_) {}
    } else {
      try {
        // false = لا تُعِد التوجيه؛ نتعامل مع SUBSCRIPTION_EXPIRED محلياً
        ctx = await window.auth.requireActiveTenant(false);
      } catch (err) {
        if (err && err.message === 'SUBSCRIPTION_EXPIRED') {
          // ركّب الـ shell بدون فحص نشاط الاشتراك، ثم وجّه لصفحة الاشتراك
          const result = await mountShell({ skipActiveCheck: true });
          history.replaceState(null, '', '/subscription');
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

    const adminLinkHtml = isSuperAdmin
      ? `<a href="/admin/subscriptions" class="admin-link"><span class="nav-icon"><i data-lucide="shield"></i></span><span>لوحة المشرف</span></a>`
      : '';

    const navHtml = NAV_ITEMS
      .filter((item) => !item.ownerOnly || profile.role === 'owner')
      .map(
        (item) => `
          <a href="${item.path}" data-nav-key="${item.key}">
            <span class="nav-icon"><i data-lucide="${item.icon}"></i></span>
            <span>${item.label}</span>
          </a>
        `
      )
      .join('');

    root.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-brand">
            <div class="brand-title"><i data-lucide="goal"></i> مَرْمى</div>
            <div class="tenant-name">${window.utils.escapeHtml(tenant ? tenant.name : '')}</div>
          </div>
          <nav class="sidebar-nav">
            ${navHtml}
            ${adminLinkHtml}
          </nav>
          <div class="sidebar-footer">
            <div class="text-muted" style="font-size: 0.85rem">
              ${profile.role === 'owner' ? 'مالك' : 'موظف'}
            </div>
          </div>
        </aside>
        <div class="main-area">
          <div id="trial-banner-slot"></div>
          <header class="app-header">
            <div style="display:flex;align-items:center;gap:12px">
              <button class="menu-toggle" id="menu-toggle" aria-label="القائمة"><i data-lucide="menu"></i></button>
              <h1 id="page-title"></h1>
            </div>
            <div class="user-menu" id="user-menu">
              <button class="user-menu-trigger" type="button" aria-haspopup="true">
                <div class="user-avatar">${window.utils.escapeHtml(getInitial(profile.full_name))}</div>
                <span>${window.utils.escapeHtml(profile.full_name)}</span>
                <i data-lucide="chevron-down" aria-hidden="true"></i>
              </button>
              <div class="user-menu-dropdown">
                <button type="button" class="item" id="account-settings-btn">
                  <i data-lucide="settings"></i><span>إعدادات الملعب</span>
                </button>
                <button type="button" class="item danger" id="signout-btn">
                  <i data-lucide="log-out"></i><span>تسجيل الخروج</span>
                </button>
              </div>
            </div>
          </header>
          <main class="page-content" id="page-content"></main>
        </div>
      </div>
    `;

    const userMenu = document.getElementById('user-menu');
    userMenu.querySelector('.user-menu-trigger').addEventListener('click', (e) => {
      e.stopPropagation();
      userMenu.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!userMenu.contains(e.target)) userMenu.classList.remove('open');
    });

    document.getElementById('signout-btn').addEventListener('click', () => {
      window.auth.signOut();
    });

    document.getElementById('account-settings-btn').addEventListener('click', () => {
      openSettingsModal(spaCtx.tenant, spaCtx.profile);
    });

    document.getElementById('menu-toggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });

    window.utils.renderIcons(root);
    return ctx;
  }

  // تحديث الـ shell عند تغيير المسار (بدون إعادة رسم كامل)
  function setActive(routeKey, pageTitle) {
    const links = document.querySelectorAll('.sidebar-nav a[data-nav-key]');
    links.forEach((a) => {
      a.classList.toggle('active', a.dataset.navKey === routeKey);
    });

    const h1 = document.getElementById('page-title');
    if (h1) h1.textContent = pageTitle || '';
    if (pageTitle) document.title = `${pageTitle} - مَرْمى`;

    // أعد رسم البانر حسب المسار (مخفي في صفحة الاشتراك)
    const slot = document.getElementById('trial-banner-slot');
    if (slot && spaCtx) {
      slot.innerHTML = renderTrialBanner(spaCtx.status, routeKey);
      window.utils.renderIcons(slot);
    }

    // أغلق sidebar على شاشات الجوال بعد التنقل
    const sb = document.getElementById('sidebar');
    if (sb) sb.classList.remove('open');
  }

  function getContext() { return spaCtx; }

  return { mountShell, setActive, getContext, NAV_ITEMS };
})();
