// SPA bootstrap
//
// يجب أن يُحمَّل آخر شيء في app.html بعد كل page modules.
// يقوم بـ:
//   1. تركيب الـ shell مرة واحدة (sidebar + header)
//   2. تعريف خلايا الـ store
//   3. تسجيل المسارات من window.appRoutes
//   4. prefetch دافئ للبيانات الشائعة
//   5. بدء realtime
//   6. بدء الراوتر

// 1) تعريف خلايا الـ store
(function defineStoreCells() {
  if (!window.store) return;
  const TEN_MIN = 10 * 60 * 1000;
  const FIVE_MIN = 5 * 60 * 1000;
  window.store.define('fields:active', () => window.api.listFields(false), { ttl: TEN_MIN });
  window.store.define('fields:all',    () => window.api.listFields(true),  { ttl: TEN_MIN });
  window.store.define('customers:all', () => window.api.listCustomers(''), { ttl: FIVE_MIN });
})();

// 2) إقلاع التطبيق
(async function () {
  window.app = window.app || {};

  try {
    const ctx = await window.layout.mountShell();
    window.app.ctx = ctx;

    // prefetch دافئ
    if (window.store) {
      window.store.prefetch(['fields:active', 'customers:all']);
    }

    // realtime
    if (window.realtime) window.realtime.start();

    // تسجيل المسارات
    const routes = window.appRoutes || [];
    routes.forEach((r) => window.router.register(r.name, r));

    window.router.start();
  } catch (err) {
    if (err && err.message && !['UNAUTHENTICATED', 'SUBSCRIPTION_EXPIRED', 'FORBIDDEN'].includes(err.message)) {
      console.error('فشل إقلاع التطبيق:', err);
      const root = document.getElementById('app-root');
      if (root) {
        root.innerHTML = `
          <div class="card" style="max-width:560px;margin:80px auto">
            <div class="empty-state">
              <p class="text-danger">${window.utils ? window.utils.formatError(err) : (err.message || 'خطأ')}</p>
              <button class="btn btn--primary mt-md" onclick="location.reload()">إعادة المحاولة</button>
            </div>
          </div>
        `;
      }
    }
  }
})();
