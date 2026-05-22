// تسجيل Service Worker + إدارة prompt التثبيت.
// يُحمَّل في app.html. تلقائي: يسجّل SW عند load ويلتقط beforeinstallprompt.
//
// واجهة عامة على window.pwa:
//   isInstallable() → bool
//   isStandalone()  → bool (هل التطبيق يعمل كـ app مُثبَّت)
//   promptInstall() → Promise<{ outcome: 'accepted'|'dismissed'|'unavailable' }>
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

    navigator.serviceWorker.register(swUrl, { scope })
      .then((reg) => {
        registration = reg;

        // تحقق من تحديث كل ساعة بينما التبويب مفتوح
        setInterval(() => { reg.update().catch(() => {}); }, 60 * 60 * 1000);

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
    isStandalone
  };

  // تسجيل تلقائي بعد load (لا يحجب الأداء الأولي)
  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register);
  }
})();
