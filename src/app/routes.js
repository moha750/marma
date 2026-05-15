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
  { name: 'calendar',         path: '/calendar',         title: 'التقويم' },
  { name: 'bookings',         path: '/bookings',         title: 'الحجوزات' },
  { name: 'customers',        path: '/customers',        title: 'العملاء' },
  { name: 'customer-details', path: '/customers/:id',    title: 'تفاصيل العميل',     activeNav: 'customers' },
  { name: 'fields',           path: '/fields',           title: 'الأرضيات',          ownerOnly: true },
  { name: 'schedule',         path: '/schedule',         title: 'أيام وفترات العمل', ownerOnly: true },
  { name: 'reports',          path: '/reports',          title: 'التقارير',          ownerOnly: true },
  { name: 'staff',            path: '/staff',            title: 'الموظفون',          ownerOnly: true },
  { name: 'subscription',     path: '/subscription',     title: 'الاشتراك',          ownerOnly: true },
  { name: 'settings',         path: '/settings',         title: 'إعدادات الملعب' }
];
