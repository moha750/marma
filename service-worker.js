// Service Worker لتطبيق مَرمى
//
// الاستراتيجيات:
//   - HTML navigation → network-first مع fallback لكاش (يضمن نضارة + offline support)
//   - الأصول الثابتة (JS/CSS/خطوط/صور) → cache-first
//   - CDN libs (lucide, supabase-js, fullcalendar) → stale-while-revalidate
//   - Supabase API → لا يتدخل (network فقط — البيانات يجب أن تكون طازجة)
//   - config.js و /book.html و الصفحات العامة → لا يتدخل (يبقى ضمن متصفح regular)
//
// عند نشر إصدار جديد: ارفع CACHE_VERSION → SW الجديد ينظّف الكاش القديم ويأخذ السيطرة.

const CACHE_VERSION = 'marma-v2';
const STATIC_CACHE  = `marma-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `marma-runtime-${CACHE_VERSION}`;

// base path للنشر تحت subpath (مثل GitHub Pages /marma/). يُستخرج من scope تلقائياً.
// لا نستخدم self.registration.scope في الـ top-level لأنه قد لا يكون متاحاً قبل install.
function getBasePath() {
  try {
    const scopePath = new URL(self.registration.scope).pathname;  // '/marma/' أو '/'
    return scopePath.endsWith('/') ? scopePath.slice(0, -1) : scopePath;
  } catch (_) { return ''; }
}

// يُسقط base prefix إن وُجد — لتطبيع المسارات قبل المقارنة
function stripBase(pathname) {
  const base = getBasePath();
  if (base && pathname.startsWith(base + '/')) return pathname.slice(base.length);
  if (base && pathname === base) return '/';
  return pathname;
}

// الأصول التي نريد ضمان توفّرها offline من أول زيارة.
// ملاحظة: ملفات CSS و JS الأخرى تتمّ فهرستها بواسطة Vite (hashing) فلا يمكن إدراجها هنا
// بمسار ثابت — يلتقطها الـ cache-first runtime على أول زيارة online.
const PRECACHE_URLS = [
  '/app.html',
  '/auth/login.html',
  '/assets/logo-mark.svg',
  '/assets/logo.svg',
  '/assets/logo-wordmark.svg',
  '/assets/pwa/icon.svg',
  '/assets/pwa/icon-maskable.svg'
];

// مسارات SPA التي يخدمها app.html — لو طُلبت offline، نخدمها من cache app.html
const APP_ROUTES = [
  '/dashboard', '/calendar', '/bookings', '/customers',
  '/fields', '/schedule', '/reports', '/staff',
  '/subscription', '/settings'
];

// ─── lifecycle ────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      // addAll يفشل لو أي URL رجع 404. نستخدم add منفرداً لتجاهل أي ملف ناقص.
      Promise.all(PRECACHE_URLS.map((url) =>
        cache.add(url).catch((err) => {
          console.warn('[SW] فشل precache:', url, err.message);
        })
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('marma-') && k !== STATIC_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// السماح للصفحة بطلب تفعيل فوري للإصدار الجديد
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ─── push notifications ───────────────────────────────────

self.addEventListener('push', (event) => {
  let data = {};
  try {
    if (event.data) data = event.data.json();
  } catch (_) {
    try { data = { title: event.data && event.data.text() }; } catch (__) {}
  }

  const title = data.title || 'مَرمى';
  const options = {
    body: data.body || '',
    icon: '/assets/pwa/icon.svg',
    badge: '/assets/logo-mark.svg',
    tag: data.tag || 'marma-notification',
    dir: 'rtl',
    lang: 'ar',
    renotify: true,
    requireInteraction: false,
    data: { url: data.url || '/dashboard' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/dashboard';
  event.waitUntil(focusOrOpenClient(url));
});

async function focusOrOpenClient(url) {
  const allClients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true
  });
  // إن وُجد تبويب للتطبيق، اجعله focus وأرسل رسالة تنقّل
  for (const client of allClients) {
    if (/\/(app\.html|dashboard|bookings|calendar|customers|fields|schedule|reports|staff|subscription|settings)/.test(client.url)) {
      try { await client.focus(); } catch (_) {}
      try { client.postMessage({ type: 'NAVIGATE', url }); } catch (_) {}
      return;
    }
  }
  // وإلا افتح نافذة جديدة
  return self.clients.openWindow(url);
}

// ─── fetch routing ────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // طلبات خارج origin — نتدخل فقط لـ CDN libs المعروفة
  if (url.origin !== self.location.origin) {
    if (isCdnAsset(url)) {
      event.respondWith(staleWhileRevalidate(req));
    }
    return; // باقي الطلبات الخارجية (Supabase, analytics, …) تمر مباشرة
  }

  // لا نخزّن config.js أبداً — يحوي مفاتيح ويُولَّد وقت البناء
  if (url.pathname.endsWith('/config.js')) return;

  // الصفحات العامة (landing, public booking, admin) — لا تدخل في نطاق التطبيق
  if (isPublicPage(url.pathname)) return;

  // navigation requests → network-first مع fallback ذكي
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(handleNavigation(req, url));
    return;
  }

  // أصولنا الديناميكية (JS/CSS من src/styles) → network-first لضمان النضارة بعد كل نشر
  if (isDynamicAsset(url.pathname)) {
    event.respondWith(networkFirst(req));
    return;
  }

  // باقي الأصول (خطوط، صور، شعارات في /assets) → cache-first
  event.respondWith(cacheFirst(req));
});

// ─── strategies ───────────────────────────────────────────

async function handleNavigation(req, url) {
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (_) {
    // offline — جرّب الكاش
    const cached = await caches.match(req);
    if (cached) return cached;

    // مسار SPA؟ → ارجع app shell
    if (isAppRoute(url.pathname)) {
      const shell = await caches.match('/app.html');
      if (shell) return shell;
    }

    // صفحة auth؟ → ارجع login المخزّن
    if (url.pathname.startsWith('/auth/')) {
      const login = await caches.match('/auth/login.html');
      if (login) return login;
    }

    return new Response(
      '<!DOCTYPE html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>غير متصل</title>' +
      '<style>body{font-family:system-ui;text-align:center;padding:60px 20px;color:#14160F;background:#FAFAF7}' +
      'h1{color:#0F9D58}</style>' +
      '<h1>أنت غير متصل بالإنترنت</h1><p>تحقق من اتصالك ثم أعد المحاولة.</p>' +
      '<p><button onclick="location.reload()" style="padding:10px 24px;background:#0F9D58;color:#fff;border:0;border-radius:8px;cursor:pointer">إعادة المحاولة</button></p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && (fresh.ok || fresh.type === 'opaque')) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (_) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

// network-first: يجلب من الشبكة دائماً إن كانت متاحة، ويسقط للكاش فقط لو فشلت.
// مناسب لأصولنا الديناميكية (JS/CSS) لتجنّب خدمة نسخة قديمة بعد deploy جديد.
async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    if (fresh && (fresh.ok || fresh.type === 'opaque')) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (_) {
    const cached = await caches.match(req);
    if (cached) return cached;
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req);
  const networkPromise = fetch(req)
    .then((fresh) => {
      if (fresh && (fresh.ok || fresh.type === 'opaque')) {
        cache.put(req, fresh.clone());
      }
      return fresh;
    })
    .catch(() => cached);
  return cached || networkPromise;
}

// ─── helpers ──────────────────────────────────────────────

function isPublicPage(pathname) {
  const p = stripBase(pathname);
  return p === '/'
      || p === '/index.html'
      || p === '/book.html'
      || p.startsWith('/admin/');
}

function isAppRoute(pathname) {
  const p = stripBase(pathname);
  return APP_ROUTES.some((r) => p === r || p.startsWith(r + '/'));
}

// أصولنا الديناميكية (JS/CSS من src/ و styles/) — تتغيّر مع كل نشر.
// نستخدم network-first لها لضمان أن المستخدم يرى آخر إصدار بعد كل push.
function isDynamicAsset(pathname) {
  const p = stripBase(pathname);
  return p.startsWith('/src/')
      || p.startsWith('/styles/')
      || p.endsWith('/book.js')
      || p.endsWith('/main.css');
}

function isCdnAsset(url) {
  return /(^|\.)unpkg\.com$/.test(url.hostname)
      || /(^|\.)jsdelivr\.net$/.test(url.hostname);
}
