// طبقة الجسر مع البيئة الأصلية (Capacitor) — تُحمَّل مباشرة بعد config.js.
//
// لماذا لا `import` من حِزَم @capacitor/*؟ لأن ملفات src/ في هذا المشروع ليست ES
// modules — تُحمَّل بوسوم <script> وتُصدّر على window. والحلّ ليس إدخال مُحزِّم:
// الجانب الأصلي يحقن window.Capacitor مع PluginHeaders (تحقّقنا: JSExport.swift
// و JSExport.java) قبل تشغيل أي سكربت لنا، وCapacitor.registerPlugin يبني وكيلاً
// يعمل عليها. فنحصل على الملحقات الأصلية بلا مُحزِّم وبلا خرق بنية المشروع.
// حِزَم npm ما زالت لازمة — منها يأخذ `npx cap sync` الكود الأصلي.
//
// واجهة عامة على window.native:
//   isNative                 → bool (false على الويب دائماً)
//   platform                 → 'ios' | 'android' | 'web'
//   isIOS / isAndroid        → bool
//   docPath(path)            → يصلح مسار مستند للحزمة الأصلية (انظر أدناه)
//   plugin(name)             → وكيل ملحق، أو null على الويب
//   haptic(style)            → اهتزاز خفيف (صامت على الويب)
//   openExternal(url)        → يفتح رابطاً خارج التطبيق (متصفّح النظام)
//   ready()                  → Promise يُحَل بعد إخفاء شاشة الإقلاق
//
// أحداث على window:
//   native:resume            — عاد التطبيق للمقدّمة (يُستخدم لتحديث البيانات)
//   native:deeplink          — فُتح التطبيق من رابط مَرمى (تفاصيله في detail.url)

(function () {
  const cap = window.Capacitor;
  const isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
  const platform = isNative ? cap.getPlatform() : 'web';

  // ─── تسجيل الملحقات ──────────────────────────────────────
  // على الويب يرجع null فوراً: كل نداء ملحق في الكود المشترك يجب أن يكون محميّاً
  // بـ if (window.native.isNative) أو بفحص النتيجة، فلا يتعطّل الموقع أبداً.
  const registry = {};
  function plugin(name) {
    if (!isNative) return null;
    if (registry[name] !== undefined) return registry[name];
    try {
      registry[name] = cap.registerPlugin(name);
    } catch (_) {
      // مسجَّل مسبقاً (لا يُسمح بالتسجيل مرتين) → خُذ الوكيل الجاهز
      registry[name] = (cap.Plugins && cap.Plugins[name]) || null;
    }
    return registry[name];
  }

  // ─── مسارات المستندات ────────────────────────────────────
  //
  // Capacitor يخدم index.html لأي مسار بلا امتداد (CapacitorRouter.route في iOS،
  // WebViewLocalServer.handleLocalRequest في أندرويد). نتيجتان:
  //
  //   • مسارات الراوتر (/dashboard, /customers/:id) → index.html = قوقعة التطبيق،
  //     ثم يقرأ الراوتر location.pathname ويركّب الصفحة الصحيحة. تعمل كما هي.
  //   • مسارات المستندات الحقيقية (/auth/login) → كانت ستفتح قوقعة التطبيق بدل
  //     صفحة الدخول. هذه وحدها تحتاج .html صريحة.
  //
  // المجموعة مغلقة ومعروفة، فالتصريح بها أوضح وأأمن من قاعدة ذكية تخطئ في حالة
  // لم نتوقّعها:
  //   • /auth/*   → ملفّ الصفحة نفسه (login.html …)
  //   • /admin/*  → قوقعة المشرف admin.html، لا ملفّاً لكل مسار: لوحة المشرف
  //     تطبيق صفحة واحدة مثل قوقعة المالك، وكل مساراتها (/admin/tenants/:id …)
  //     يخدمها ملفٌّ واحد ثم يتولّاها راوترها.
  function docPath(path) {
    if (!isNative || typeof path !== 'string') return path;

    const m = /^([^?#]*)([?#].*)?$/.exec(path);
    const clean = m[1];
    const rest = m[2] || '';
    if (/\.[a-z0-9]+$/i.test(clean)) return path;   // له امتداد أصلاً

    if (clean === '/admin' || clean.startsWith('/admin/')) return '/admin.html' + rest;
    if (clean.startsWith('/auth/')) return clean + '.html' + rest;
    return path;
  }

  // ─── الاهتزاز ────────────────────────────────────────────
  function haptic(style) {
    if (!isNative) return;
    const Haptics = plugin('Haptics');
    if (!Haptics) return;
    try {
      Haptics.impact({ style: style || 'LIGHT' });
    } catch (_) { /* كمالي بالكامل */ }
  }

  // ─── الروابط الخارجية ────────────────────────────────────
  // داخل التطبيق يجب أن يفتح الرابط الخارجي في متصفّح النظام، لا داخل الـ webview:
  // رابط يفتح في نفس العرض يعني مستخدماً تائهاً بلا زر رجوع، وتقييد
  // limitsNavigationsToAppBoundDomains يمنع الملاحة الخارجية أصلاً.
  function openExternal(url) {
    if (!isNative) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    const Browser = plugin('Browser');
    if (Browser) {
      Browser.open({ url, presentationStyle: 'popover' }).catch(() => {});
      return;
    }
    window.open(url, '_blank');
  }

  // ─── الإقلاع ─────────────────────────────────────────────
  let resolveReady;
  const readyPromise = new Promise((r) => { resolveReady = r; });
  let hidden = false;

  // شاشة الإقلاق تبقى ظاهرة (launchAutoHide=false) حتى تكتمل أول صفحة فعلاً،
  // وإلا رأى المستخدم قوقعة فارغة بيضاء قبل وصول البيانات. وشبكة أمان زمنية:
  // فشلٌ في الإقلاع يجب ألّا يترك المستخدم أمام شاشة إقلاق أبدية.
  function hideSplash() {
    if (hidden) return;
    hidden = true;
    const Splash = plugin('SplashScreen');
    if (Splash) { try { Splash.hide({ fadeOutDuration: 200 }); } catch (_) {} }
    resolveReady();
  }
  function ready() { return readyPromise; }

  if (!isNative) {
    hidden = true;
    resolveReady();
  } else {
    // قوقعة التطبيق (فيها #app-root) تُعلن جهوزيتها بنفسها من boot.js بعد تركيب
    // أول صفحة فعلاً. بقية المستندات — صفحات المصادقة — لا تُشغّل boot.js، فلو
    // انتظرناها لبقيت شاشة الإقلاق ست ثوانٍ فوق صفحة دخولٍ جاهزة.
    // الفحص موثوق لأن الوسم يسبق كل السكربتات في app.html (السطر ٢١ قبل ٢٦)،
    // وصفحات المصادقة لا تحتوي #app-root إطلاقاً.
    const isAppShell = !!document.getElementById('app-root');
    if (isAppShell) {
      window.addEventListener('marma:app-ready', hideSplash, { once: true });
    } else if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(hideSplash), { once: true });
    } else {
      requestAnimationFrame(hideSplash);
    }
    // شبكة أمان: فشل إقلاعٍ صامت يجب ألّا يترك المستخدم أمام شعارٍ أبديّ
    setTimeout(hideSplash, 6000);
  }

  // ─── تهيئة البيئة الأصلية ────────────────────────────────
  function init() {
    if (!isNative) return;

    // كل أنماط البيئة الأصلية محصورة تحت html.native (styles/components/native.css)،
    // فالإضافة هنا هي ما يفعّلها — والويب لا يراها أبداً.
    document.documentElement.classList.add('native', 'native-' + platform);

    // شريط الحالة: التطبيق يمتد تحته (edge-to-edge)، والأنماط تتكفّل بالحشو عبر
    // env(safe-area-inset-top). أندرويد ١٥+ يفرض هذا فرضاً، فالتعامل معه الآن
    // أرخص من مطاردته لاحقاً عند رفع targetSdk.
    const StatusBar = plugin('StatusBar');
    if (StatusBar) {
      try {
        StatusBar.setOverlaysWebView({ overlay: true });
        syncStatusBarToTheme();
        // نراقب السمة على <html> بدل الاعتماد على حدثٍ من مبدّل السمة: التغيير
        // قد يأتي من الزرّ أو من تفضيل النظام أو من صفحة أخرى، والمراقبة تلتقط
        // الثلاثة بلا ربط بين الملفّين.
        new MutationObserver(syncStatusBarToTheme).observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-theme']
        });
      } catch (_) {}
    }

    // لوحة المفاتيح: نضيف صنفاً على <html> لترفع الأنماط الأشرطة السفلية فوقها
    const Keyboard = plugin('Keyboard');
    if (Keyboard) {
      try {
        Keyboard.addListener('keyboardWillShow', (info) => {
          document.documentElement.style.setProperty('--keyboard-height', (info && info.keyboardHeight ? info.keyboardHeight : 0) + 'px');
          document.documentElement.classList.add('keyboard-open');
        });
        Keyboard.addListener('keyboardWillHide', () => {
          document.documentElement.style.setProperty('--keyboard-height', '0px');
          document.documentElement.classList.remove('keyboard-open');
        });
      } catch (_) {}
    }

    const App = plugin('App');
    if (App) {
      try {
        // زر الرجوع في أندرويد: بلا معالج يُغلق التطبيق من أي صفحة — سلوك يقرؤه
        // المستخدم كتعطّل. نتراجع في تاريخ الراوتر، ولا نخرج إلا من جذر التطبيق.
        App.addListener('backButton', ({ canGoBack }) => {
          if (window.utils && window.utils.closeTopLayer && window.utils.closeTopLayer()) return;
          if (canGoBack && window.history.length > 1) {
            window.history.back();
            return;
          }
          App.exitApp();
        });

        // العودة للمقدّمة: التطبيق يبقى مفتوحاً أياماً على الجوال، فالبيانات
        // المعروضة قد تكون بعمر يوم. نبطّل الكاش ونحدّث كما يفعل تبويب الويب.
        App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) window.dispatchEvent(new CustomEvent('native:resume'));
        });

        // الروابط العامة (Universal Links / App Links): حجزٌ أو بطاقةٌ يفتحها
        // المالك من واتساب يجب أن تصل داخل التطبيق لا أن تفتح متصفّحاً.
        App.addListener('appUrlOpen', ({ url }) => {
          window.dispatchEvent(new CustomEvent('native:deeplink', { detail: { url } }));
          routeDeepLink(url);
        });
      } catch (_) {}
    }
  }

  // شريط الحالة يتبع سمة التطبيق: أيقونات داكنة على الفاتح، فاتحة على الداكن.
  //
  // نضبط الأسلوب (لون الأيقونات) فقط، ولا نلوّن الخلفية. سبب ذلك أن تلوينها
  // كان يُنتج تطبيقين مختلفَي المظهر: على أندرويد يرسم شريطاً فاتحاً فوق صفحة
  // الدخول الخضراء، وعلى iOS لا توجد هذه الواجهة أصلاً فيمتدّ الأخضر تحته.
  // ولو أبقيناه لصار للمظهر مصدرا حقيقة — CSS ونداءٌ أصلي — يتناقضان.
  //
  // فالخلفية تملكها الأنماط وحدها: صفحات القوقعة يغطّي منطقتَها الشريط الثابت
  // في native.css، وصفحات الدخول يمتدّ خلفها الملعب الأخضر عمداً. وهذا أمتن
  // مستقبلاً: setBackgroundColor مُهمَلة في أندرويد ١٥+ مع فرض edge-to-edge.
  function syncStatusBarToTheme() {
    const StatusBar = plugin('StatusBar');
    if (!StatusBar) return;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    try {
      StatusBar.setStyle({ style: dark ? 'DARK' : 'LIGHT' });
    } catch (_) {}
  }

  // يحوّل رابط marma.help إلى ملاحة داخلية. أي رابط لا نعرفه يُترك للمتصفّح
  // الخارجي — أفضل من صفحة خطأ داخل التطبيق.
  function routeDeepLink(url) {
    let parsed;
    try { parsed = new URL(url); } catch (_) { return; }
    if (!/(^|\.)marma\.help$/i.test(parsed.hostname)) return;

    const path = parsed.pathname + parsed.search;
    // صفحات العملاء العامة ليست في الحزمة الأصلية — تُفتح في متصفّح النظام
    if (/^\/(book|card)(\.html)?$/i.test(parsed.pathname)) {
      openExternal(url);
      return;
    }
    if (window.router && typeof window.router.navigateToPath === 'function') {
      window.router.navigateToPath(path);
    } else {
      window.location.href = docPath(path);
    }
  }

  window.native = {
    isNative,
    platform,
    isIOS: platform === 'ios',
    isAndroid: platform === 'android',
    docPath,
    plugin,
    haptic,
    openExternal,
    ready,
    hideSplash,
    syncStatusBarToTheme
  };

  init();
})();
