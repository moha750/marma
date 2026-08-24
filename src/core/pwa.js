// تسجيل Service Worker + إدارة prompt التثبيت.
// يُحمَّل في app.html. تلقائي: يسجّل SW عند load ويلتقط beforeinstallprompt.
//
// واجهة عامة على window.pwa:
//   isInstallable() → bool
//   isStandalone()  → bool (هل التطبيق يعمل كـ app مُثبَّت)
//   promptInstall() → Promise<{ outcome: 'accepted'|'dismissed'|'unavailable' }>
//   storeUrl()      → string ('' = لا متجر، اسلك مسار تثبيت الـ PWA)
//
// أحداث مخصّصة على window:
//   pwa:installable   — أصبح التطبيق قابلاً للتثبيت
//   pwa:installed     — تم التثبيت
//   pwa:update-ready  — إصدار جديد جاهز للتفعيل

(function () {
  let deferredPrompt = null;
  let registration = null;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
  }

  function isInstallable() {
    return !!deferredPrompt;
  }

  // iOS Safari لا يطلق beforeinstallprompt — التثبيت يدوي عبر Share menu.
  // نكتشف iOS (بما في ذلك iPad في "desktop mode") لنعرض تعليمات بدلاً من الزر العادي.
  function isIOS() {
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    // iPad في desktop mode يعرّف نفسه كـ Mac — نكتشفه عبر touch points
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  }

  // على iOS غير المثبّت: يحتاج المستخدم تعليمات يدوية بدل prompt
  function needsManualInstall() {
    return isIOS() && !isStandalone();
  }

  // ─── متجر Play بدل تثبيت الـ PWA على أندرويد ─────────────────────
  // لـمَرمى تطبيق في متجر Play. ولو بقي زرّ تثبيت الـ PWA يعمل على أندرويد،
  // انتهى كل عميل بأيقونتين متطابقتين على جهازه — وقع هذا فعلاً في اختبار
  // الجهاز الحقيقي. فنوجّه أندرويد إلى المتجر، ويبقى الـ PWA لسطح المكتب
  // ولـ iOS بتعليماته اليدوية.
  //
  // ⚠️ PLAY_STORE_LIVE = false ما دام التطبيق على الاختبار المغلق: صفحة
  // المتجر تردّ «لم يتم العثور على العنصر» لكل من ليس مختبِراً، وهي أسوأ من
  // تثبيت PWA. اقلبها إلى true لحظة موافقة قوقل على الإصدار العلني — سطر
  // واحد، ولا شيء غيره.
  const PLAY_STORE_URL  = 'https://play.google.com/store/apps/details?id=help.marma.app';
  const PLAY_STORE_LIVE = false;

  function isAndroid() {
    return /Android/i.test(navigator.userAgent || '');
  }

  // '' = لا تعرض المتجر، واسلك مسار تثبيت الـ PWA المعتاد
  function storeUrl() {
    if (!PLAY_STORE_LIVE) return '';
    if (!isAndroid() || isStandalone()) return '';
    // داخل الحزمة الأصلية لا معنى لدعوة التثبيت أصلاً
    if (window.__NATIVE__ === true) return '';
    if (window.Capacitor && window.Capacitor.isNativePlatform &&
        window.Capacitor.isNativePlatform()) return '';
    return PLAY_STORE_URL;
  }

  async function promptInstall() {
    if (!deferredPrompt) return { outcome: 'unavailable' };
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      return choice;
    } catch (err) {
      deferredPrompt = null;
      return { outcome: 'unavailable' };
    }
  }

  // طلب تفعيل فوري لإصدار SW جديد (بعد تأكيد المستخدم)
  function applyUpdate() {
    if (registration && registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  }

  function register() {
    if (!('serviceWorker' in navigator)) return;
    const base = window.__BASE__ || '';
    const swUrl = base + '/service-worker.js';
    const scope = (base || '') + '/';

    // updateViaCache:'none' — لا تقرأ ملف الـ SW من كاش HTTP عند فحص التحديث.
    // ضروري لأن Cloudflare يفرض max-age طويلاً على ملفات .js، فبدونه قد يقارن
    // المتصفّح النسخة الجديدة بنسخة مخزّنة قديمة ولا يرى فرقاً فلا يُحدِّث أبداً.
    navigator.serviceWorker.register(swUrl, { scope, updateViaCache: 'none' })
      .then((reg) => {
        registration = reg;

        // تحقق من تحديث كل ساعة بينما التبويب مفتوح
        setInterval(() => { reg.update().catch(() => {}); }, 60 * 60 * 1000);

        // وأيضاً عند العودة إلى التبويب — التطبيق المثبَّت يبقى مفتوحاً أياماً،
        // فانتظار الساعة يعني رؤية نسخة قديمة بعد النشر. حدٌّ أدنى دقيقة بين الفحوص.
        let lastCheck = Date.now();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'visible') return;
          if (Date.now() - lastCheck < 60 * 1000) return;
          lastCheck = Date.now();
          reg.update().catch(() => {});
        });

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent('pwa:update-ready'));
            }
          });
        });
      })
      .catch((err) => {
        console.warn('[PWA] فشل تسجيل service worker:', err);
      });

    // عند تفعيل SW جديد، أعد تحميل الصفحة لضمان اتساق الأصول
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    // استقبل رسائل التنقّل من SW (عند ضغط notification)
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data || {};
      if (data.type === 'NAVIGATE' && data.url) {
        try {
          if (window.router && typeof window.router.navigate === 'function') {
            window.router.navigate(data.url);
          } else {
            window.location.href = (window.__BASE__ || '') + data.url;
          }
        } catch (_) {
          window.location.href = (window.__BASE__ || '') + data.url;
        }
      }
    });
  }

  // ─── التقاط beforeinstallprompt (Chrome/Edge/Samsung) ────
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    window.dispatchEvent(new CustomEvent('pwa:installable'));
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    window.dispatchEvent(new CustomEvent('pwa:installed'));
  });

  // واجهة عامة
  window.pwa = {
    register,
    promptInstall,
    applyUpdate,
    isInstallable,
    isStandalone,
    isIOS,
    isAndroid,
    storeUrl,
    needsManualInstall
  };

  // تخزين دائم: يطلب من المتصفّح عدم مسح localStorage/IndexedDB أثناء الخمول،
  // مما يقلّل فقدان جلسة الدخول (سبب شائع لتسجيل الخروج بعد أيام، خاصة على الجوال).
  async function requestPersistentStorage() {
    try {
      if (navigator.storage && navigator.storage.persist && navigator.storage.persisted) {
        const already = await navigator.storage.persisted();
        if (!already) await navigator.storage.persist();
      }
    } catch (_) { /* غير حرج */ }
  }
  requestPersistentStorage();

  // تسجيل تلقائي بعد load (لا يحجب الأداء الأولي)
  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register);
  }
})();
