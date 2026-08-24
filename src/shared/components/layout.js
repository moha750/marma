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
  // ─── تبويبات الوجهات المدمجة ─────────────────────────────
  // مصدر الحقيقة الوحيد: تقرؤها الصفحات (شريط التبويب) ولوحة الأوامر (بحث).
  // بلا هذا الربط تختفي الوجهات المدموجة من البحث لأنها لم تعد في NAV_ITEMS.

  // «قائمة» أولاً وهي الافتراضي: تجيب «ماذا أفعل الآن؟».
  // و«تقويم» عدسة تجيب «كيف يبدو الأسبوع؟».
  const BOOKING_TABS = [
    { label: 'قائمة', path: '/bookings' },
    { label: 'تقويم', path: '/calendar' }
  ];

  const PITCH_TABS = [
    { label: 'الأرضيات',         path: '/fields' },
    { label: 'الفترات والأسعار', path: '/schedule' }
  ];

  const LOYALTY_TABS = [
    { label: 'البرنامج', path: '/loyalty' },
    { label: 'البطاقات', path: '/loyalty/cards' },
    { label: 'الأختام المعلّقة', path: '/loyalty/stamps' }
  ];

  // التنقل مع التجميع — يُستخدمها sidebar و command-palette
  const NAV_ITEMS = [
    { key: 'dashboard',    group: 'تشغيلي', label: 'لوحة التحكم',          icon: 'layout-dashboard', path: '/dashboard' },
    // «الحجوزات» هي المكان، و«التقويم» عرضٌ لها لا وجهة مستقلّة: نفس البيانات
    // ونفس مودال التعديل ونفس زرّ «حجز جديد». وحجب موعد — الفعل الوحيد الذي
    // كان يملكه التقويم — انتقل إلى مكوّن مشترك تستدعيه القائمة كذلك.
    { key: 'bookings',     group: 'تشغيلي', label: 'الحجوزات',             icon: 'clipboard-list',   path: '/bookings',     tabs: BOOKING_TABS },
    { key: 'customers',    group: 'تشغيلي', label: 'العملاء',              icon: 'users',            path: '/customers' },
    // «ملاعبي» يضمّ الأرضيات وفتراتها وأسعارها. كانا تبويبين، والفصل كان
    // مصطنعاً: جدول العمل مفتاحه field_id، وصفحته تفتح بسؤال «أي ملعب؟»،
    // ونموذج تعديل الأرضية كان يحيل صراحةً إلى «صفحة أخرى» لضبط السعر.
    { key: 'fields',       group: 'إدارة',  label: 'ملاعبي',               icon: 'goal',             path: '/fields',       ownerOnly: true, tabs: PITCH_TABS },
    { key: 'offers',       group: 'إدارة',  label: 'العروض',               icon: 'badge-percent',    path: '/offers',       ownerOnly: true },
    { key: 'loyalty',      group: 'إدارة',  label: 'برنامج الولاء',        icon: 'credit-card',      path: '/loyalty',      ownerOnly: true, tabs: LOYALTY_TABS },
    { key: 'loyalty-scan', group: 'تشغيلي', label: 'مسح البطاقة',          icon: 'scan-line',        path: '/loyalty/scan' },
    // متابعة العملاء ليست ميزةً في الباقة بل دفتر المشرف يُشارَك مع مالكٍ
    // بعينه. leadsOnly ⇒ لا تظهر إلا لمن مُنح، وإلا كان تبويباً يفتح على رفض.
    { key: 'leads',        group: 'إدارة',  label: 'متابعة العملاء',       icon: 'user-search',      path: '/leads',        ownerOnly: true, leadsOnly: true },
    { key: 'reports',      group: 'إدارة',  label: 'التقارير',             icon: 'trending-up',      path: '/reports',      ownerOnly: true },
    { key: 'visits',       group: 'إدارة',  label: 'الزيارات',             icon: 'eye',              path: '/visits',       ownerOnly: true },
    { key: 'staff',        group: 'إدارة',  label: 'الموظفون',             icon: 'user',             path: '/staff',        ownerOnly: true },
    { key: 'account',      group: 'حساب',   label: 'حسابي',                icon: 'user-circle',      path: '/account' },
    { key: 'subscription', group: 'حساب',   label: 'الاشتراك',             icon: 'credit-card',      path: '/subscription', ownerOnly: true },
    { key: 'settings',     group: 'حساب',   label: 'إعدادات الملعب',       icon: 'settings',         path: '/settings' }
  ];

  // عناصر الـ bottom-nav للجوال — أربع وجهات + «المزيد» يفتح ورقة سفلية.
  //
  // «المزيد» يُلغي الهامبرغر على الجوال: نفس الوجهات، لكن من جهة الإبهام بدل
  // أعلى اليسار — أبعد نقطة في الشاشة عن إبهام اليد الممسكة. وبدونه كانت ١١ من
  // ١٥ وجهةً لا تُبلغ إلا من هناك.
  // «الحجوزات» في المنتصف — أكثر ما يُفتح، وأقرب موضع للإبهام.
  //
  // الخانة الثانية تتبع الدور: «ملاعبي» ownerOnly، ولو ظهرت للموظف لكانت
  // تبويباً يقذفه إلى لوحة التحكم (router.js يحوّل مسارات المالك)، أي زرّاً
  // يبدو معطّلاً بلا تفسير. فيأخذ الموظف «العملاء» مكانها — وهي أنفع له،
  // إذ لا ملاعب في حسابه أصلاً. وكلا الدورين يخرج بخمس خانات والحجوزات وسطها.
  const BOTTOM_NAV = [
    { key: 'dashboard',    label: 'الرئيسية', icon: 'layout-dashboard', path: '/dashboard' },
    { key: 'fields',       label: 'ملاعبي',   icon: 'goal',             path: '/fields',       ownerOnly: true },
    { key: 'customers',    label: 'العملاء',  icon: 'users',            path: '/customers',    staffOnly: true },
    { key: 'bookings',     label: 'الحجوزات', icon: 'clipboard-list',   path: '/bookings' },
    { key: 'loyalty-scan', label: 'مسح',      icon: 'scan-line',        path: '/loyalty/scan' },
    { key: 'more',         label: 'المزيد',   icon: 'ellipsis',         sheet: true }
  ];

  function bottomNavFor(role) {
    const isOwner = role === 'owner';
    return BOTTOM_NAV.filter((it) => (!it.ownerOnly || isOwner) && (!it.staffOnly || !isOwner));
  }

  // مفاتيح شريط هذا الدور — لاستبعادها من ورقة «المزيد» فلا تتكرّر الوجهة
  // مرّتين. مشتقّة من الدور لا ثابتة: «العملاء» في شريط الموظف وفي ورقة
  // المالك، ولو كانت المجموعة واحدة لاختفت عن المالك تماماً.
  function bottomKeysFor(role) {
    return new Set(bottomNavFor(role).map((it) => it.key));
  }


  let spaCtx = null;
  let currentRouteKey = null; // آخر مسار نشط — لإعادة رسم بانر الاشتراك لحظيًّا
  let isSuperAdminCached = false; // تقرؤه ورقة «المزيد» — الفحص شبكيّ ولا يُعاد
  let hasLeadsAccessCached = false; // مثله: هل شُورك معه دفتر متابعة العملاء؟

  // مرشّح الظهور الواحد — يقرؤه الشريط الجانبي وورقة «المزيد» معاً، فلا تفترق
  // القائمتان في وجهةٍ تظهر هنا وتغيب هناك.
  function navVisibleFor(profile) {
    return NAV_ITEMS.filter((it) =>
      (!it.ownerOnly || profile.role === 'owner') &&
      (!it.leadsOnly || hasLeadsAccessCached));
  }

  // ─── بانر الاشتراك ───────────────────────────────────────

  function renderTrialBanner(status, activePage) {
    if (!status || activePage === 'subscription') return '';
    const phase = status.phase;
    // وصول دائم: شارة ذهبية إيجابية بلا دعوة تجديد
    if (phase === 'lifetime') {
      return `
        <div class="trial-banner trial-banner--lifetime">
          <span class="trial-banner-icon"><i data-lucide="gem"></i></span>
          <span>وصول دائم — كل المميزات مفتوحة</span>
        </div>
      `;
    }
    // days_until_expiry = أيام حتى نهاية التجربة/الاشتراك، وهي نفسها لحظة القفل:
    // لا فترة سماح بعدها.
    const daysToExpiry = Math.max(0, Number(status.days_until_expiry) || 0);
    let kind = '', text = '';
    if (phase === 'trial') {
      kind = 'trial';
      text = `${status.trial_extended ? 'تجربة ممدّدة' : 'تجربة مجانية'} — متبقي ${daysToExpiry} ${pluralDays(daysToExpiry)}`;
    } else if (phase === 'active' && daysToExpiry <= 7) {
      kind = 'soon';
      text = `الاشتراك ينتهي خلال ${daysToExpiry} ${pluralDays(daysToExpiry)}`;
    } else {
      return '';
    }
    return `
      <div class="trial-banner trial-banner--${kind}">
        <span class="trial-banner-icon"><i data-lucide="info"></i></span>
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

  // يجمع العناصر تحت عناوينها بترتيب أول ظهور — لا بالتجاور.
  //
  // التجاور كان يكرّر العنوان: `loyalty-scan` (تشغيلي) واقعٌ بين عناصر «إدارة»
  // في NAV_ITEMS، فيُغلق قسم «إدارة» ويُفتح ثانيةً بعده. يظهر الأثر في الشريط
  // الجانبي وفي ورقة «المزيد» معاً.
  function groupNavItems(items) {
    const byLabel = new Map();
    items.forEach((it) => {
      if (!byLabel.has(it.group)) byLabel.set(it.group, { label: it.group, items: [] });
      byLabel.get(it.group).items.push(it);
    });
    return [...byLabel.values()];
  }

  function buildNavHtml(profile, isLocked) {
    const groups = groupNavItems(navVisibleFor(profile));
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
          // في التطبيق: صيغة خبريّة بلا أمرٍ بالتجديد (قاعدة أبل 3.1.1 — لا دعوة
          // إجراء نحو شراءٍ خارج مشتريات أبل؛ والتجديد يقع على الويب أصلاً)
          const title    = locked
            ? (window.native && window.native.isNative ? 'مقفل — الاشتراك منتهٍ' : 'جدّد اشتراكك للوصول')
            : item.label;
          const lockAttr = locked ? ' aria-disabled="true" tabindex="-1"' : '';
          const lockIcon = locked ? `<span class="nav-lock"><i data-lucide="lock"></i></span>` : '';
          // شارة الإشعارات غير المقروءة الخاصّة بوجهة هذا التبويب
          const badge    = `<span class="nav-notif-badge" data-notif-link="${item.path}" hidden></span>`;
          return `
          <a${hrefAttr} data-nav-key="${item.key}"${cls}${lockAttr} title="${window.utils.escapeHtml(title)}">
            <span class="nav-icon"><i data-lucide="${item.icon}"></i></span>
            <span class="nav-label">${window.utils.escapeHtml(item.label)}</span>
            ${badge}
            ${lockIcon}
          </a>`;
        }).join('')}
      </div>
    `).join('');
  }

  function buildBottomNavHtml(isLocked, role) {
    return `
      <nav class="bottom-nav" id="bottom-nav" aria-label="التنقل السفلي">
        <div class="bottom-nav-list">
          ${bottomNavFor(role).map((it) => {
            // «المزيد» زرٌّ لا وجهة، ولا يُقفل أبداً: عند انتهاء الاشتراك تصير
            // الورقة الطريقَ الوحيد إلى /subscription على الجوال (لا شريط جانبي).
            if (it.sheet) {
              return `
            <button type="button" data-bottom-key="${it.key}" id="more-sheet-btn" aria-haspopup="dialog" aria-expanded="false">
              <span class="nav-icon"><i data-lucide="${it.icon}"></i></span>
              <span>${window.utils.escapeHtml(it.label)}</span>
            </button>`;
            }
            // بقية العناصر تشغيلية، فجميعها تُقفل عند انتهاء الاشتراك.
            // المقفول بلا href ⇒ غير قابل للنقر ولا التنقّل.
            const hrefAttr = isLocked ? '' : ` href="${window.utils.path(it.path)}"`;
            const cls  = isLocked ? ' class="nav-link--locked"' : '';
            const aria = isLocked ? ' aria-disabled="true" tabindex="-1"' : '';
            const lock = isLocked ? `<span class="nav-lock"><i data-lucide="lock"></i></span>` : '';
            return `
            <a${hrefAttr} data-bottom-key="${it.key}"${cls}${aria}>
              <span class="nav-icon"><i data-lucide="${it.icon}"></i>${lock}<span class="nav-notif-badge" data-notif-link="${it.path}" hidden></span></span>
              <span>${window.utils.escapeHtml(it.label)}</span>
            </a>`;
          }).join('')}
        </div>
      </nav>
    `;
  }

  // ─── ورقة «المزيد» ───────────────────────────────────────
  //
  // ما لا يسعه الشريط السفلي. تُبنى من NAV_ITEMS نفسها لا من قائمة موازية —
  // فأي وجهة جديدة تظهر هنا تلقائياً بلا خطوة ثانية تُنسى.
  // والعرض ورقة سفلية بلا سطر CSS جديد: drawer.css يحوّل الدرج إلى ورقة
  // منزلقة من الأسفل تحت ٦٤٠px أصلاً.

  function moreSheetItems(profile) {
    const inBar = bottomKeysFor(profile.role);
    return navVisibleFor(profile).filter((it) => !inBar.has(it.key));
  }

  // دعوة التثبيت كانت في تذييل الشريط الجانبي وحده — والهامبرغر مخفيّ على
  // الجوال. بلا نقلها هنا يفقد الويب على الجوال طريقه الوحيد لتثبيت الـ PWA.
  // (داخل التطبيق المثبَّت لا تظهر أصلاً: native.css يُخفي #install-cta،
  //  و isStandalone تُرجع true.)
  function canOfferInstall() {
    if (!window.pwa) return false;
    try {
      if (window.pwa.isStandalone()) return false;
      return !!(window.pwa.isInstallable() ||
        (window.pwa.needsManualInstall && window.pwa.needsManualInstall()));
    } catch (_) { return false; }
  }

  function buildMoreSheetHtml(profile, isLocked) {
    const groups = groupNavItems(moreSheetItems(profile));
    return `
      <nav class="more-sheet-nav" aria-label="وجهات إضافية">
        ${groups.map((g) => `
          <div class="nav-group">
            ${g.label ? `<div class="nav-group-label">${window.utils.escapeHtml(g.label)}</div>` : ''}
            ${g.items.map((item) => {
              const locked = isLocked && item.key !== 'subscription';
              const unlock = isLocked && item.key === 'subscription';
              const hrefAttr = locked ? '' : ` href="${window.utils.path(item.path)}"`;
              const cls = locked ? ' class="nav-link--locked"' : (unlock ? ' class="nav-link--unlock"' : '');
              const lockAttr = locked ? ' aria-disabled="true" tabindex="-1"' : '';
              const lockIcon = locked ? `<span class="nav-lock"><i data-lucide="lock"></i></span>` : '';
              return `
              <a${hrefAttr} data-nav-key="${item.key}"${cls}${lockAttr}>
                <span class="nav-icon"><i data-lucide="${item.icon}"></i></span>
                <span class="nav-label">${window.utils.escapeHtml(item.label)}</span>
                <span class="nav-notif-badge" data-notif-link="${item.path}" hidden></span>
                ${lockIcon}
              </a>`;
            }).join('')}
          </div>
        `).join('')}

        <div class="nav-group more-sheet-footer">
          ${canOfferInstall() ? `
            <button type="button" class="more-sheet-install" id="more-sheet-install">
              <span class="nav-icon"><i data-lucide="download"></i></span>
              <span class="nav-label">${window.native && window.native.isIOS ? 'ثبّت على iPhone' : 'ثبّت التطبيق'}</span>
            </button>
          ` : ''}
          <button type="button" class="more-sheet-help" id="more-sheet-help">
            <span class="nav-icon"><i data-lucide="life-buoy"></i></span>
            <span class="nav-label">مساعدة</span>
          </button>
          ${isSuperAdminCached ? `
            <a href="${window.utils.path('/admin/overview')}" data-nav-key="admin">
              <span class="nav-icon"><i data-lucide="shield"></i></span>
              <span class="nav-label">لوحة المشرف</span>
            </a>
          ` : ''}
          <button type="button" class="more-sheet-signout" id="more-sheet-signout">
            <span class="nav-icon"><i data-lucide="log-out"></i></span>
            <span class="nav-label">تسجيل الخروج</span>
          </button>
        </div>
      </nav>
    `;
  }

  let moreSheetCtrl = null;

  function openMoreSheet() {
    if (moreSheetCtrl) return;
    const profile = spaCtx ? spaCtx.profile : { role: 'staff' };
    const isLocked = !!(spaCtx && spaCtx.status && spaCtx.status.is_active === false);
    const btn = document.getElementById('more-sheet-btn');
    if (btn) btn.setAttribute('aria-expanded', 'true');

    if (window.native) window.native.haptic('LIGHT');

    moreSheetCtrl = window.drawer.open({
      title: 'المزيد',
      // هويّة المستخدم كانت في تذييل الشريط الجانبي — تبقى ظاهرة على الجوال
      subtitle: `${profile.full_name || ''} · ${profile.role === 'owner' ? 'مالك' : 'موظف'}`,
      size: 'sm',
      body: buildMoreSheetHtml(profile, isLocked),
      onClose: () => {
        moreSheetCtrl = null;
        const b = document.getElementById('more-sheet-btn');
        if (b) b.setAttribute('aria-expanded', 'false');
      }
    });

    // الرابط يغلق الورقة بنفسه: الراوتر يعترض النقر ويبدّل الصفحة تحتها،
    // فبلا إغلاق تبقى الورقة فوق الصفحة الجديدة.
    moreSheetCtrl.body.querySelectorAll('a[href]').forEach((a) => {
      a.addEventListener('click', () => {
        if (window.native) window.native.haptic('LIGHT');
        if (moreSheetCtrl) moreSheetCtrl.close();
      });
    });

    // تسجيل الخروج كان في قائمة الشريط الجانبي، والهامبرغر مخفيّ على الجوال —
    // فبلا نقله هنا يصير الخروج متعذّراً على الجوال أصلاً.
    const signout = moreSheetCtrl.body.querySelector('#more-sheet-signout');
    if (signout) signout.addEventListener('click', () => window.auth.signOut());

    const help = moreSheetCtrl.body.querySelector('#more-sheet-help');
    if (help) help.addEventListener('click', () => {
      if (moreSheetCtrl) moreSheetCtrl.close();
      if (window.helpCoach) window.helpCoach.openSheet();
    });

    // التثبيت: iOS بلا beforeinstallprompt ⇒ نافذة تعليمات يدوية، وغيره prompt برمجي
    const install = moreSheetCtrl.body.querySelector('#more-sheet-install');
    if (install) install.addEventListener('click', async () => {
      if (window.pwa.needsManualInstall && window.pwa.needsManualInstall()) {
        if (moreSheetCtrl) moreSheetCtrl.close();
        showIOSInstallHelp();
        return;
      }
      install.disabled = true;
      try {
        const res = await window.pwa.promptInstall();
        if (res && res.outcome === 'accepted' && moreSheetCtrl) moreSheetCtrl.close();
      } finally {
        install.disabled = false;
      }
    });

    // أبرِز الوجهة الحالية داخل الورقة
    const activeLink = moreSheetCtrl.body.querySelector(`a[data-nav-key="${currentRouteKey}"]`);
    if (activeLink) activeLink.classList.add('active');
  }

  // ─── شاشة الإيقاف الإداري (مستقلّة، بلا لوحة) ─────────────

  function renderSuspendedScreen() {
    document.body.classList.add('app-body');
    const root = document.getElementById('app-root') || document.body;
    root.innerHTML = `
      <div class="suspended-screen">
        <div class="suspended-card">
          <div class="suspended-icon"><i data-lucide="ban"></i></div>
          <h1>تم إيقاف حسابك</h1>
          <p>أوقفت إدارة مَرمى وصول هذا الحساب مؤقتًا. للاستفسار أو إعادة التفعيل تواصل مع الدعم.</p>
          <div class="suspended-actions">
            <a class="btn btn--primary" href="mailto:marma.apps@gmail.com"><i data-lucide="mail"></i> تواصل مع الدعم</a>
            <button type="button" class="btn btn--ghost" id="suspended-signout"><i data-lucide="log-out"></i> تسجيل الخروج</button>
          </div>
        </div>
      </div>
    `;
    window.utils.renderIcons(root);
    const so = document.getElementById('suspended-signout');
    if (so) so.addEventListener('click', () => window.auth.signOut('/auth/login'));
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
          // ميّز الإيقاف الإداري عن انتهاء الاشتراك ⇒ شاشة مستقلّة
          let st = null;
          try { st = await window.auth.loadSubscriptionStatus(); } catch (_) {}
          if (st && st.phase === 'suspended') {
            renderSuspendedScreen();
            throw new Error('ACCOUNT_SUSPENDED');
          }
          const result = await mountShell({ skipActiveCheck: true });
          history.replaceState(null, '', window.utils.path('/subscription'));
          return result;
        }
        throw err;
      }
    }

    const { profile, tenant } = ctx;
    // الفحصان متوازيان: كلاهما جولةٌ واحدة للخادم، وتسلسلهما يؤخّر رسم القوقعة.
    // وفحص المتابعة للمالك وحده — والمشرف يبلغ الدفتر من لوحته لا من هنا.
    const [isSuperAdmin, hasLeadsAccess] = await Promise.all([
      window.auth.checkIsSuperAdmin(),
      (profile.role === 'owner' && window.leadsApi)
        ? window.leadsApi.canAccess()
        : Promise.resolve(false)
    ]);
    isSuperAdminCached = isSuperAdmin;
    hasLeadsAccessCached = hasLeadsAccess;
    spaCtx = ctx;

    // اشتراك منتهٍ ⇒ نقفل التبويبات بصرياً (الراوتر يبقى خط الدفاع للروابط المباشرة)
    const isLocked = !!(ctx.status && ctx.status.is_active === false);

    document.body.classList.add('app-body');
    const root = document.getElementById('app-root') || document.body;

    const navHtml = buildNavHtml(profile, isLocked);
    const adminLinkHtml = isSuperAdmin
      ? `<a href="${window.utils.path('/admin/overview')}" class="admin-link" title="لوحة المشرف">
           <span class="nav-icon"><i data-lucide="shield"></i></span>
           <span class="nav-label">لوحة المشرف</span>
         </a>`
      : '';

    // استرجع حالة الطيّ المحفوظة، وإلا اضبطها حتميًّا حسب حجم الشاشة.
    // (ترك السمة غائبة يجعل الحالة "افتراضية" ضمنيًّا فيختلّ زر الطيّ ويطفح نص التثبيت)
    let sidebarState = '';
    try {
      const stored = localStorage.getItem('marma:sidebar:collapsed');
      if (stored === 'true')       sidebarState = 'collapsed';
      else if (stored === 'false') sidebarState = 'expanded';
      else if (window.matchMedia('(min-width: 1280px)').matches) sidebarState = 'expanded';
      else if (window.matchMedia('(min-width: 768px)').matches)  sidebarState = 'collapsed';
      // أقل من 768px: تبقى فارغة — الشريط يعمل كدرج (drawer)
    } catch (_) {}

    root.innerHTML = `
      <div class="app-shell" ${sidebarState ? `data-sidebar="${sidebarState}"` : ''}>
        <aside class="sidebar" id="sidebar">
          <!-- هوية العلامة: مع شعار الملعب تتصدر هويته و«مَرمى» سطر صغير؛ بدونه هوية مَرمى كاملة -->
          ${tenant && tenant.logo_url ? `
            <div class="sidebar-brand">
              <span class="sidebar-brand-logo sidebar-brand-logo--tenant"><img src="${window.utils.escapeHtml(tenant.logo_url)}" alt="" aria-hidden="true"></span>
              <div class="sidebar-brand-text">
                <span class="tenant-brand-name">${window.utils.escapeHtml(tenant.name)}</span>
                <span class="tenant-name">عبر مَرمى</span>
              </div>
            </div>
          ` : `
            <div class="sidebar-brand">
              <span class="sidebar-brand-logo"><img src="${window.utils.path('/assets/logo-mark.svg')}" alt="" aria-hidden="true"></span>
              <div class="sidebar-brand-text">
                <img src="${window.utils.path('/assets/logo-wordmark.svg')}" alt="مَرمى" class="brand-title">
                <span class="tenant-name">${window.utils.escapeHtml(tenant ? tenant.name : '')}</span>
              </div>
            </div>
          `}

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
                <button type="button" class="item" id="user-menu-help">
                  <i data-lucide="life-buoy"></i><span>مساعدة</span>
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
          <!-- النيابة فوق الاشتراك: «أحدٌ يعدّل في حسابك الآن» يسبق «جدّد
               اشتراكك» في كل حال — الأوّل يجري الآن والثاني يمكن أن ينتظر. -->
          <div id="support-banner-slot"></div>
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
              <span id="notif-slot"></span>
              <span id="theme-toggle-slot"></span>
            </div>
          </header>

          <main class="page-content" id="page-content"></main>
        </div>

        ${buildBottomNavHtml(isLocked, profile.role)}
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

    document.getElementById('user-menu-help').addEventListener('click', () => {
      userMenu.classList.remove('open');
      if (window.helpCoach) window.helpCoach.openSheet();
    });

    // ورقة «المزيد» في الشريط السفلي
    const moreBtn = document.getElementById('more-sheet-btn');
    if (moreBtn) moreBtn.addEventListener('click', openMoreSheet);

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

    // جرس الترويسة (تيّار الأحداث) + شارة "طابور العمل" على تبويب الحجوزات
    // (عدد الحجوزات المعلّقة بانتظار التأكيد — تبقى حتى يُنجَز العمل، لا عند قراءة الجرس)
    if (window.notificationBell) {
      const headerSlot = document.getElementById('notif-slot');
      if (headerSlot) window.notificationBell.mount(headerSlot);
      const navEl = document.querySelector('.sidebar-nav');
      if (navEl) window.notificationBell.bindPendingBadges(navEl, [
        {
          link: '/bookings',
          event: 'bookings:change',
          count: async () => {
            const { count } = await window.sb
              .from('bookings').select('id', { count: 'exact', head: true })
              .eq('status', 'pending');
            return count || 0;
          }
        }
      ]);
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

    // ─── تحديث لحظي لحالة الاشتراك في الـ shell ──────────────
    // عند تغيّر المنشأة/الاشتراك (موافقة الأدمن، تعليق، تمديد): نعيد جلب الحالة،
    // نحدّث البانر فورًا. وإن انقلبت حالة القفل (فعّال↔مقفل) نعيد التحميل ليُطبَّق
    // القفل/الفتح على كل التبويبات والراوتر بشكل متّسق.
    if (window.realtime) {
      const onTenantOrSub = window.utils.debounce(async () => {
        let st = null;
        try { st = await window.auth.loadSubscriptionStatus({ force: true }); } catch (_) { return; }
        const wasLocked = !!(spaCtx && spaCtx.status && spaCtx.status.is_active === false);
        const nowLocked = !!(st && st.is_active === false);
        if (spaCtx) spaCtx.status = st;
        const slot2 = document.getElementById('trial-banner-slot');
        if (slot2) {
          slot2.innerHTML = renderTrialBanner(st, currentRouteKey);
          window.utils.renderIcons(slot2);
        }
        if (wasLocked !== nowLocked) window.location.reload();
      }, 500);
      window.realtime.on('tenants:change', onTenantOrSub);
      window.realtime.on('subscriptions:change', onTenantOrSub);
    }

    // شريط النيابة: يُركَّب دائماً وإن لم تكن ثمّة جلسة — هو من يسأل الخادم،
    // ومن يسمع القناة الحيّة، فلا بدّ أن يكون حاضراً قبل أن يقع شيء.
    if (window.supportBanner) {
      window.supportBanner.mount(document.getElementById('support-banner-slot'));
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

    // وجهة داخل الورقة ⇒ يُبرَز «المزيد»، وإلا بقي المستخدم في صفحةٍ لا يشير
    // إليها أي عنصر في الشريط فيقرأها كخروجٍ من التطبيق.
    // نقرأ الشريط المركَّب فعلاً لا القائمة المصدر — فهو المفلتَر بالدور
    const moreBtn = document.querySelector('.bottom-nav button[data-bottom-key="more"]');
    if (moreBtn) {
      const inBar = new Set([...document.querySelectorAll('.bottom-nav a[data-bottom-key]')]
        .map((a) => a.dataset.bottomKey));
      moreBtn.classList.toggle('active', !!routeKey && !inBar.has(routeKey));
    }

    // breadcrumb — يُعاد بناؤه دائماً لأن setBreadcrumbs() قد يكون مسح الـ id
    const wrap = document.getElementById('breadcrumb');
    if (wrap) {
      wrap.innerHTML = `<span class="breadcrumb-item is-current" id="page-title-leaf">${window.utils.escapeHtml(pageTitle || '')}</span>`;
    }

    // عنوان الصفحة في تبويب المتصفح
    if (pageTitle) document.title = `${pageTitle} - مَرمى`;

    // بانر الاشتراك
    currentRouteKey = routeKey;
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

    // وأغلق ورقة «المزيد» — الملاحة قد تأتي من رابطٍ عميق أو زرّ رجوع لا من
    // نقرةٍ داخل الورقة، فتبقى معلّقة فوق الصفحة الجديدة
    if (moreSheetCtrl) moreSheetCtrl.close();
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

  // ─── شريط تبويب الصفحة ───────────────────────────────────
  //
  // وجهةٌ واحدة في القائمة، وداخلها مساراتها. يستبدل الروابط المتبادلة التي
  // كانت تتقاذف المستخدم بين صفحتين شقيقتين بلا أن تُظهر له أنهما شيء واحد.
  //
  //   window.layout.pageTabs([{ label: 'الأرضيات', path: '/fields' }, …], '/fields')
  //
  // مبنيّ على chip-rail--seg القائم — لا نمط جديد عدا مقاس اللمس.
  function pageTabs(tabs, activePath) {
    if (!Array.isArray(tabs) || tabs.length < 2) return '';
    return `
      <div class="chip-rail chip-rail--seg page-tabs mb-md" role="tablist">
        ${tabs.map((t) => {
          const active = t.path === activePath;
          return `<a class="chip${active ? ' is-active' : ''}" role="tab"
                     aria-selected="${active ? 'true' : 'false'}"
                     href="${window.utils.path(t.path)}">${window.utils.escapeHtml(t.label)}</a>`;
        }).join('')}
      </div>
    `;
  }

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

  return {
    mountShell, setActive, setBreadcrumbs, getContext,
    pageTabs, PITCH_TABS, LOYALTY_TABS, BOOKING_TABS, NAV_ITEMS, navVisibleFor
  };
})();
