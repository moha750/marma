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
    // المشرف العام يهبط هنا في التطبيق الأصلي — فيجب تسليمه للوحته لا طرده.
    //
    // على الويب لا تقع هذه الحالة: الخادم يعيد كتابة /admin/* إلى admin.html
    // فلا يمرّ المشرف بقوقعة المالك أصلًا. أما في الحزمة الأصلية فلا خادم
    // ولا إعادة كتابة — وCapacitor يفتح index.html عند كل إقلاق. فكان المشرف
    // يصل إلى قوقعة المالك، وهي تطلب صفّ profiles ولا صفّ له (بالتصميم: المشرف
    // ليس مالك ملعب)، فيُقرأ الخطأ حسابًا باطلًا ويُسجَّل خروجه.
    //
    // الفحص قبل mountShell لا بعده: بعده يكون الخروج قد وقع.
    if (window.native && window.native.isNative && window.auth) {
      const session = await window.auth.getSession();
      if (session) {
        const { data: profile } = await window.sb
          .from('profiles').select('id').eq('id', session.user.id).maybeSingle();
        if (!profile && await window.auth.checkIsSuperAdmin()) {
          // إلا أن يكون داخل جلسة نيابة: عندها هو هنا قصداً — يعدّل في حساب
          // ملعبٍ أذن له. تسليمه للوحته حينئذٍ يُخرجه من العمل الذي جاء له.
          const sup = window.supportApi
            ? await window.supportApi.currentSession().catch(() => null)
            : null;
          if (!sup || sup.viewer !== 'support') {
            window.location.replace('/admin.html');
            return;
          }
        }
      }
    }

    // مالك جديد بلا منشأة → شاشة الإعداد أولًا (تُنشئ المنشأة)، ثم يُركَّب الـ shell
    if (window.onboarding && window.auth && await window.auth.needsOwnerOnboarding()) {
      await window.onboarding.show();
    }

    const ctx = await window.layout.mountShell();
    window.app.ctx = ctx;

    // prefetch دافئ
    if (window.store) {
      window.store.prefetch(['fields:active', 'customers:all']);
    }

    // realtime
    if (window.realtime) window.realtime.start();

    // push: أعد تسجيل الجهاز للحساب الحالي (نقل ملكية عند تبديل الحسابات،
    // واستعادة صامتة بعد تنظيف الخروج إن كان الإذن ممنوحًا) — دون انتظار
    if (window.push && window.push.ensureSync) window.push.ensureSync();

    // تسجيل المسارات
    const routes = window.appRoutes || [];
    routes.forEach((r) => window.router.register(r.name, r));

    window.router.start();

    // التطبيق الأصلي: أول صفحة جاهزة فعلاً ⇒ أخفِ شاشة الإقلاق.
    // الترتيب مقصود — الإخفاء قبل هذه النقطة يكشف قوقعة فارغة، وهو أسوأ من
    // انتظار جزء من الثانية أمام شعار.
    window.dispatchEvent(new CustomEvent('marma:app-ready'));

    // العودة من الخلفية: التطبيق المثبَّت يبقى مفتوحاً أياماً، فما على الشاشة قد
    // يكون بعمر يوم كامل. نُبطل الكاش ونعيد الجلب كما لو فُتح الآن.
    if (window.native && window.native.isNative) {
      window.addEventListener('native:resume', () => {
        if (window.store) window.store.invalidate();   // بلا وسيط = كل الخلايا
        if (window.realtime) window.realtime.start();  // قناة قُطعت في الخلفية
        if (window.router && window.router.refresh) window.router.refresh();
      });
    }
  } catch (err) {
    // فشل الإقلاع يجب ألّا يترك المستخدم أمام شاشة إقلاق أبدية
    window.dispatchEvent(new CustomEvent('marma:app-ready'));
    if (err && err.message && !['UNAUTHENTICATED', 'SUBSCRIPTION_EXPIRED', 'FORBIDDEN', 'ACCOUNT_SUSPENDED'].includes(err.message)) {
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
