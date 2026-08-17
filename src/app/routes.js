// تسجيل مسارات الـ SPA مركزياً
//
// كل route يحتوي:
//   - name: اسم الـ route (مفتاح في window.pages)
//   - path: نمط مسار History API (مثل '/customers/:id') — يطابق location.pathname
//   - title: عنوان الصفحة في الـ header
//   - ownerOnly: إذا true → ممنوع على الموظفين، يُحوَّل لـ dashboard
//   - activeNav: لإبراز عنصر مختلف في الـ sidebar (للصفحات الفرعية)
//
// إضافة مسار جديد:
//   1. أضف العنصر هنا
//   2. أنشئ page module في src/features/<domain>/pages/<file>.js
//      يصدّر window.pages[name] = { mount(container, ctx), unmount() }
//   3. أضف <script> tag في app.html
//   4. إذا أضفت مسار جذر جديد (مثل /products) — أضفه إلى APP_ROUTES في vite.config.js
//      و إلى rewrites في vercel.json

window.appRoutes = [
  { name: 'dashboard',        path: '/dashboard',        title: 'لوحة التحكم' },
  // «الحجوزات» وجهةٌ واحدة بعرضين — والمساران باقيان كما هما:
  // /bookings مكتوب في تريجرات SQL وحمولات الدفع (انظر الملاحظة أدناه).
  { name: 'bookings',         path: '/bookings',         title: 'الحجوزات' },
  { name: 'calendar',         path: '/calendar',         title: 'الحجوزات', activeNav: 'bookings' },
  { name: 'customers',        path: '/customers',        title: 'العملاء' },
  { name: 'customer-details', path: '/customers/:id',    title: 'تفاصيل العميل',     activeNav: 'customers' },
  // «ملاعبي» وجهةٌ واحدة بتبويبين — المسارات باقية كما هي عمداً: عمود
  // notifications.link يُكتب من تريجرات SQL، وحمولة الدفع من دوال الحافة،
  // وكلاهما يحمل مسارات مخزّنة في صفوفٍ وأجهزةٍ لا تُرحَّل.
  { name: 'fields',           path: '/fields',           title: 'ملاعبي',            ownerOnly: true },
  { name: 'schedule',         path: '/schedule',         title: 'ملاعبي',            ownerOnly: true, activeNav: 'fields' },
  { name: 'offers',           path: '/offers',           title: 'العروض',            ownerOnly: true },
  { name: 'loyalty',          path: '/loyalty',          title: 'برنامج الولاء',     ownerOnly: true },
  { name: 'loyalty-cards',    path: '/loyalty/cards',    title: 'برنامج الولاء',     ownerOnly: true, activeNav: 'loyalty' },
  // تبويبٌ ثالث داخل وجهة الولاء، فيرث ownerOnly منها. والموظف يوافق من
  // الماسح — هو سطحه عند الكاونتر، والعميل أمامه.
  { name: 'loyalty-stamps',   path: '/loyalty/stamps',   title: 'برنامج الولاء',     ownerOnly: true, activeNav: 'loyalty' },
  // الماسح متاح للموظفين عمداً — هم من يصرفون المكافآت عند الكاونتر
  { name: 'loyalty-scan',     path: '/loyalty/scan',     title: 'مسح البطاقة',       activeNav: 'loyalty-scan' },
  // متابعة العملاء: تُشارَك من لوحة المشرف لأشخاصٍ بأعيانهم. ownerOnly لأن
  // المشاركة تُمنح للمالك لا للموظفين، والبوّاب الحقيقي في القاعدة
  // (can_access_leads) لا هنا — هذا حجبٌ للواجهة فقط.
  { name: 'leads',            path: '/leads',            title: 'متابعة العملاء',    ownerOnly: true },
  { name: 'reports',          path: '/reports',          title: 'التقارير',          ownerOnly: true },
  { name: 'visits',           path: '/visits',           title: 'الزيارات',          ownerOnly: true },
  { name: 'staff',            path: '/staff',            title: 'الموظفون',          ownerOnly: true },
  { name: 'subscription',     path: '/subscription',     title: 'الاشتراك',          ownerOnly: true },
  { name: 'account',          path: '/account',          title: 'حسابي' },
  { name: 'settings',         path: '/settings',         title: 'إعدادات الملعب' }
];
