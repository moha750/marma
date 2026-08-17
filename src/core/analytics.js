// تتبع زيارات أول-طرف — للصفحات العامة فقط (الرئيسية، صفحة الحجز، auth)
// ----------------------------------------------------------------------------
// يرسل إشارات إلى /api/vt (دالة حافة Cloudflare) التي تُثريها وتخزنها في
// قاعدة البيانات. بلا كوكيز وبلا خدمات خارجية:
//   - هوية الزائر: uuid عشوائي في localStorage (marma:vid) — لا يحمل أي معلومة شخصية
//   - الجلسة: uuid في sessionStorage بنافذة 30 دقيقة متجددة (marma:sid)
//   - إيقاف التتبع: localStorage.setItem('marma:analytics-optout', '1')
// fail-silent بالكامل: أي خلل هنا يجب ألا يؤثر على الصفحة إطلاقًا.
//
// ملاحظة: معاينات *.pages.dev تسجّل في الإنتاج (مفيد للتحقق، ضجيج مهمل)؛
// التطوير المحلي (localhost) لا يسجّل أبدًا.
//
// استثناء التطبيق الأصلي من شرط localhost مقصود ولازم: Capacitor يخدم الحزمة من
// `https://localhost` على أندرويد و`capacitor://localhost` على iOS
// (capacitor.config.json: androidScheme/iosScheme) — فشرط المضيف وحده كان يُسكت
// القياس داخل التطبيق كلّه بصمت. ونكشفه من window.Capacitor لا من window.native
// لأن index.html و book.html يحمّلان هذا الملف بلا native.js.
window.track = (function () {
  var noop = { event: function () {} };
  try {
    var isNativeApp = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function'
      && window.Capacitor.isNativePlatform());
    if (!isNativeApp && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) return noop;
    if (navigator.webdriver) return noop;
    if (localStorage.getItem('marma:analytics-optout') === '1') return noop;
  } catch (_) {
    return noop;
  }

  var API = (window.__BASE__ || '') + '/api/vt';
  var SESSION_WINDOW_MS = 30 * 60 * 1000;

  function uuid() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (_) {}
    // بديل نادر الاستخدام (متصفحات قديمة جدًا) — عشوائي كفاية لغرض التحليلات
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function visitorId() {
    try {
      var v = localStorage.getItem('marma:vid');
      if (!v) { v = uuid(); localStorage.setItem('marma:vid', v); }
      return v;
    } catch (_) { return uuid(); }
  }

  // جلسة بنافذة 30 دقيقة متجددة: كل إشارة تمدد الجلسة
  function sessionId() {
    try {
      var sid = sessionStorage.getItem('marma:sid');
      var ts = parseInt(sessionStorage.getItem('marma:sid_ts') || '0', 10);
      var now = Date.now();
      if (!sid || now - ts > SESSION_WINDOW_MS) { sid = uuid(); sessionStorage.setItem('marma:sid', sid); }
      sessionStorage.setItem('marma:sid_ts', String(now));
      return sid;
    } catch (_) { return uuid(); }
  }

  // ─── اكتشاف الصفحة الحالية (null = صفحة لا نتتبعها) ───
  function pageInfo() {
    var path = location.pathname;
    var base = window.__BASE__ || '';
    if (base && path.indexOf(base) === 0) path = path.slice(base.length) || '/';

    if (path === '/' || path === '/index.html') return { page: 'landing', tenantId: null, fieldId: null };
    if (path.indexOf('/auth/login') === 0) return { page: 'auth_login', tenantId: null, fieldId: null };
    if (path.indexOf('/auth/signup') === 0) return { page: 'auth_signup', tenantId: null, fieldId: null };
    if (path.indexOf('/book') === 0) {
      var tenantId = null;
      try { tenantId = new URLSearchParams(location.search).get('t'); } catch (_) {}
      if (!tenantId) return null; // صفحة حجز بلا ملعب — لا شيء يُسجَّل
      var m = /^#\/field\/([^\/?#]+)/.exec(location.hash || '');
      return m
        ? { page: 'book_field', tenantId: tenantId, fieldId: m[1] }
        : { page: 'book', tenantId: tenantId, fieldId: null };
    }
    return null;
  }

  var current = null;         // معلومات الصفحة المعروضة حاليًا
  var currentVisitId = null;  // توكن صف الزيارة (من record_visit) لتحديث المدة
  var visibleSeconds = 0;     // ثوانٍ الرؤية المتراكمة للمشاهدة الحالية
  var visibleSince = document.visibilityState === 'visible' ? Date.now() : null;

  function accumulate() {
    if (visibleSince != null) {
      visibleSeconds += (Date.now() - visibleSince) / 1000;
      visibleSince = null;
    }
  }

  function send(payload) {
    try {
      return fetch(API, { method: 'POST', keepalive: true, body: JSON.stringify(payload) });
    } catch (_) { return Promise.reject(); }
  }

  function sendView(info) {
    current = info;
    currentVisitId = null;
    visibleSeconds = 0;
    visibleSince = document.visibilityState === 'visible' ? Date.now() : null;

    var utm = {};
    try {
      var q = new URLSearchParams(location.search);
      utm.source = q.get('utm_source'); utm.medium = q.get('utm_medium'); utm.campaign = q.get('utm_campaign');
    } catch (_) {}

    var ref = null;
    try {
      if (document.referrer && new URL(document.referrer).host !== location.host) ref = document.referrer;
    } catch (_) {}

    send({
      type: 'view',
      page: info.page,
      tenant_id: info.tenantId,
      field_id: info.fieldId,
      visitor_id: visitorId(),
      session_id: sessionId(),
      referrer: ref,
      utm_source: utm.source, utm_medium: utm.medium, utm_campaign: utm.campaign,
      language: navigator.language || null
    }).then(function (resp) { return resp && resp.ok ? resp.json() : null; })
      .then(function (data) { if (data && data.id) currentVisitId = data.id; })
      .catch(function () {});
  }

  // مغادرة/إخفاء: أرسل المدة المتراكمة عبر beacon (يصل حتى أثناء إغلاق التبويب).
  // الدالة في القاعدة لا تقبل إلا الزيادة، فإرسال المجموع تكرارًا آمن.
  function flushLeave() {
    accumulate();
    if (!currentVisitId || visibleSeconds < 1) return;
    var body = JSON.stringify({ type: 'leave', visit_id: currentVisitId, seconds: Math.round(visibleSeconds) });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(API, body);
      else send({ type: 'leave', visit_id: currentVisitId, seconds: Math.round(visibleSeconds) });
    } catch (_) {}
  }

  document.addEventListener('visibilitychange', function () {
    try {
      if (document.visibilityState === 'hidden') flushLeave();
      else if (visibleSince == null) visibleSince = Date.now();
    } catch (_) {}
  });
  window.addEventListener('pagehide', function () { try { flushLeave(); } catch (_) {} });

  // صفحة الحجز تتنقل بالـ hash (الرئيسية ⇄ تفاصيل الأرضية) — كل تنقل مشاهدة جديدة
  window.addEventListener('hashchange', function () {
    try {
      var next = pageInfo();
      if (!next || !current) return;
      if (next.page === current.page && next.fieldId === current.fieldId) return;
      flushLeave();
      sendView(next);
    } catch (_) {}
  });

  // المشاهدة الأولى
  try {
    var info = pageInfo();
    if (info) sendView(info);
  } catch (_) {}

  // ─── واجهة عامة: أحداث القُمع (يستدعيها book.js) ───
  return {
    event: function (type, data) {
      try {
        data = data || {};
        send({
          type: 'event',
          event_type: type,
          tenant_id: data.tenant_id || (current && current.tenantId) || null,
          field_id: data.field_id || (current && current.fieldId) || null,
          booking_id: data.booking_id || null,
          visitor_id: visitorId(),
          session_id: sessionId()
        }).catch(function () {});
      } catch (_) {}
    }
  };
})();
