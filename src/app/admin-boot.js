// إقلاع SPA لوحة المشرف العام — يُحمَّل آخر شيء بعد كل page modules.
//   1. تركيب الـ shell (sidebar + header) عبر requireSuperAdmin
//   2. تسجيل مسارات المشرف
//   3. بدء الراوتر (الافتراضي: admin-subscriptions)
(async function () {
  window.app = window.app || {};
  window.app.defaultRoute = 'admin-overview'; // افتراضي الراوتر للوحة المشرف

  try {
    const ctx = await window.layout.mountShell();
    window.app.ctx = ctx;

    const routes = window.appRoutes || [];
    routes.forEach((r) => window.router.register(r.name, r));

    window.router.start();
  } catch (err) {
    // requireSuperAdmin يتولّى إعادة التوجيه عند عدم الصلاحية (NOT_SUPER_ADMIN / UNAUTHENTICATED)
    if (err && err.message && !['UNAUTHENTICATED', 'NOT_SUPER_ADMIN', 'FORBIDDEN'].includes(err.message)) {
      console.error('فشل إقلاع لوحة المشرف:', err);
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
