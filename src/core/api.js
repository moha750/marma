// API Aggregator - يدمج كل feature APIs في window.api للتوافق مع الصفحات الحالية
//
// يجب تحميل هذا الملف **بعد** كل ملفات features/<domain>/api.js
// لكي يضمّ كل النطاقات.
//
// النمط الجديد: ينبغي للكود الجديد استخدام window.<domain>Api مباشرة:
//   window.fieldsApi.listFields()      ← يفضّل
//   window.api.listFields()            ← يعمل (للتوافق)

window.api = Object.assign({},
  window.fieldsApi        || {},
  window.customersApi     || {},
  window.bookingsApi      || {},
  window.staffApi         || {},
  window.dashboardApi     || {},
  window.reportsApi       || {},
  window.scheduleApi      || {},
  window.subscriptionsApi || {},
  window.tenantApi        || {},
  window.adminApi         || {}
);

// تحذير لو في تطوير وأحدها مفقود
(function checkLoaded() {
  const required = [
    'fieldsApi', 'customersApi', 'bookingsApi', 'staffApi',
    'dashboardApi', 'reportsApi', 'scheduleApi',
    'subscriptionsApi', 'tenantApi', 'adminApi'
  ];
  const missing = required.filter((k) => !window[k]);
  if (missing.length) {
    console.warn('API aggregator: لم تُحمَّل بعد:', missing.join(', '));
  }
})();
