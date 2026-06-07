// مسارات SPA لوحة المشرف العام (admin.html)
window.appRoutes = [
  { name: 'admin-overview',      path: '/admin/overview',      title: 'نظرة عامة' },
  { name: 'admin-subscriptions', path: '/admin/subscriptions', title: 'طلبات الاشتراك' },
  { name: 'admin-tenants',       path: '/admin/tenants',       title: 'الملاعب' },
  { name: 'admin-tenant-details', path: '/admin/tenants/:id',   title: 'تفاصيل الملعب', activeNav: 'admin-tenants' }
];
