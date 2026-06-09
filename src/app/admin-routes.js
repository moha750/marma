// مسارات SPA لوحة المشرف العام (admin.html)
window.appRoutes = [
  { name: 'admin-overview',      path: '/admin/overview',      title: 'نظرة عامة' },
  { name: 'admin-analytics',     path: '/admin/analytics',     title: 'نموّ المنصّة' },
  { name: 'admin-subscriptions', path: '/admin/subscriptions', title: 'طلبات الاشتراك' },
  { name: 'admin-revenue',       path: '/admin/revenue',       title: 'الإيرادات' },
  { name: 'admin-tenants',       path: '/admin/tenants',       title: 'الملاعب' },
  { name: 'admin-tenant-details', path: '/admin/tenants/:id',   title: 'تفاصيل الملعب', activeNav: 'admin-tenants' },
  { name: 'admin-admins',        path: '/admin/admins',        title: 'المشرفون' },
  { name: 'admin-broadcast',     path: '/admin/broadcast',     title: 'بثّ رسالة' },
  { name: 'admin-audit',         path: '/admin/audit',         title: 'سجلّ النشاط' }
];
