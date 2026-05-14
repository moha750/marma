# Architecture — مَرْمى

## نظرة عامة

نظام SaaS متعدد المستأجرين للملاعب. مبني بـ **Vanilla JavaScript** بدون أدوات بناء، يستخدم Supabase للـ backend.

البنية SPA (تطبيق صفحة واحدة) باستخدام hash router، مع legacy fallback لصفحات HTML قديمة (اختياري).

## الهيكل

```
goal/
├── public-side HTML (root)            ← صفحات لا تحتاج مصادقة
│   ├── index.html                     # landing
│   ├── login.html
│   ├── signup.html
│   └── book.html                      # حجز عام للعملاء
│
├── app/                               ← SPA shell + admin pages
│   ├── index.html                     # SPA entry (#/route)
│   └── admin/
│       ├── tenants.html               # super-admin: قائمة الملاعب
│       └── subscriptions.html         # super-admin: طلبات الاشتراك
│
├── src/                               ← كل JavaScript
│   ├── core/                          # Infrastructure layer
│   │   ├── supabase-client.js         # window.sb
│   │   ├── utils.js                   # window.utils (helpers, toast, modal)
│   │   ├── auth.js                    # window.auth (session, guards)
│   │   ├── api.js                     # window.api (aggregator يدمج features APIs)
│   │   ├── store.js                   # window.store (cache layer)
│   │   ├── realtime.js                # window.realtime (Supabase channels)
│   │   └── router.js                  # window.router (hash router)
│   │
│   ├── shared/components/             # مكونات عابرة للـ features
│   │   └── layout.js                  # window.layout (shell, sidebar, header)
│   │
│   ├── features/                      # vertical slicing - كل feature في مجلد
│   │   ├── dashboard/
│   │   │   ├── api.js                 # window.dashboardApi
│   │   │   └── pages/home.js          # window.pages.dashboard
│   │   ├── bookings/
│   │   │   ├── api.js                 # window.bookingsApi
│   │   │   ├── components/booking-modal.js  # window.bookingModal
│   │   │   ├── pages/list.js          # window.pages.bookings
│   │   │   ├── pages/calendar.js      # window.pages.calendar
│   │   │   └── public/book.js         # ملعب عام (book.html)
│   │   ├── customers/
│   │   ├── fields/
│   │   ├── schedule/
│   │   ├── reports/
│   │   ├── staff/
│   │   ├── subscriptions/
│   │   ├── tenant/                    # API فقط (لا pages)
│   │   └── admin/
│   │       ├── api.js                 # window.adminApi
│   │       ├── components/admin-layout.js
│   │       └── pages/{tenants,subscriptions}.js
│   │
│   └── app/                           # SPA bootstrap
│       ├── routes.js                  # window.appRoutes (تسجيل المسارات)
│       └── boot.js                    # نقطة الإقلاع
│
├── styles/
│   ├── tokens.css                     # CSS variables + Cairo font
│   ├── base.css                       # reset + typography + auth/landing
│   ├── layout.css                     # app-shell + sidebar + header + banners
│   ├── components/                    # مكوّنات UI
│   │   ├── button.css
│   │   ├── form.css
│   │   ├── card.css
│   │   ├── table.css
│   │   ├── badge.css
│   │   ├── modal.css
│   │   ├── calendar.css
│   │   ├── utilities.css
│   │   ├── public.css                 # book.html
│   │   └── subscription.css
│   └── main.css                       # umbrella بـ @import
│
├── assets/                            # static assets
├── docs/                              # هذه التوثيقات
├── config.js                          # public Supabase config (في .gitignore)
├── config.example.js                  # template
└── README.md
```

## مبادئ التنظيم

### 1. Layered architecture
```
core/   ←   shared/   ←   features/   ←   app/
```
- **core**: لا يعرف شيئاً عن features
- **shared**: مكونات يستخدمها عدة features
- **features**: كل feature مستقل، يستهلك core + shared
- **app**: يجمع كل شيء عند الإقلاع

قاعدة ذهبية: لا feature يستهلك feature آخر. لو لزم → ارفع المنطق إلى `shared/` أو `core/`.

### 2. Feature-Sliced
كل nطاق (bookings, customers, ...) في مجلده الخاص يحوي:
- `api.js` — استدعاءات Supabase لهذا النطاق
- `pages/` — صفحات الـ SPA
- `components/` — مكونات داخلية (اختياري)

استثناءات منطقية:
- `booking-modal` في `features/bookings/components/` رغم استخدامه من 3 صفحات (dashboard/bookings/calendar) — لأنه منطقياً تابع للحجوزات.
- `tenant/api.js` لا توجد له pages — يُستخدم داخلياً من باقي الـ features.

### 3. Global namespace (window.*)
بدون ES modules. كل ملف يضع API له على `window`:
- `window.sb` — Supabase client
- `window.auth`, `window.utils`, `window.store`, `window.realtime`, `window.router`, `window.layout`, `window.bookingModal`
- `window.api` — aggregator (للتوافق)
- `window.<domain>Api` — API لكل feature
- `window.pages.<routeName>` — page module
- `window.appRoutes` — تعريف المسارات

## نمط Page Module

كل صفحة في الـ SPA تصدّر:

```js
window.pages = window.pages || {};
window.pages.<routeName> = {
  async mount(container, ctx) {
    container.innerHTML = TEMPLATE;
    // wire event listeners
    // أو fetch + render
    this._cleanup = [/* unsubscribe functions */];
  },
  unmount() {
    this._cleanup.forEach((fn) => fn());
    this._cleanup = null;
  }
};

// legacy MPA fallback (لو تم تحميل الـ JS من صفحة HTML قديمة):
if (!window.__SPA_MODE__) {
  // auto-mount
}
```

`ctx` يحتوي: `{ user, profile, tenant, status, params, query, route }`.

## Boot Order

في `app/index.html`:

1. **CDN**: Lucide, Supabase, FullCalendar
2. **Config**: `config.js`
3. **Core**: supabase-client → utils → auth
4. **Feature APIs**: tenant (أولاً لأن باقي APIs تستخدمه) → fields, customers, bookings, staff, dashboard, reports, schedule, subscriptions, admin
5. **API aggregator**: `src/core/api.js` يدمج كل feature APIs في `window.api`
6. **Shared**: layout, booking-modal
7. **SPA marker**: `window.__SPA_MODE__ = true`
8. **SPA infra**: store, realtime, router
9. **Routes**: `src/app/routes.js`
10. **Pages**: كل page module
11. **Boot**: `src/app/boot.js` (يركّب shell + يبدأ راوتر)

## Router

Hash router (`#/<route>` و `#/<route>/<param>`).

- `window.router.register(name, def)` — تسجيل route
- `window.router.navigate(name, params)` — تنقل برمجي
- `window.router.start()` — بدء الاستماع للـ hashchange

دالة `setActive(routeKey, title)` في `window.layout` تحدّث الـ sidebar + العنوان.

## Store (Cache)

طبقة cache بـ TTL + dedup + invalidation:

```js
// تعريف خلية
store.define('fields:active', () => api.listFields(false), { ttl: 10 * 60 * 1000 });

// جلب (cached أو network)
const fields = await store.get('fields:active');

// تبطيل
store.invalidate('fields:active');

// prefetch
store.prefetch(['fields:active', 'customers:all']);
```

الخلايا المعرّفة حالياً (في `src/app/boot.js`):
- `fields:active` — الأرضيات النشطة (10 دقائق)
- `fields:all` — كل الأرضيات (10 دقائق)
- `customers:all` — كل العملاء (5 دقائق)

## Realtime

اشتراك واحد على مستوى التطبيق:

```js
const off = window.realtime.on('bookings:change', () => refresh());
// عند unmount
off();
```

الأحداث:
- `bookings:change` — أي تغيير في جدول bookings
- `customers:change` — تغيير في customers (يبطّل customers:all)
- `fields:change` — تغيير في fields (يبطّل fields:active و fields:all)

يتطلب تفعيل replication في Supabase:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE bookings, customers, fields;
```

## Auth Flow

1. الجلسة تُحفظ في localStorage (Supabase auth)
2. `auth.requireAuth()` يتحقق من الجلسة + يجلب profile
3. `auth.requireActiveTenant()` يضيف فحص نشاط الاشتراك
4. `auth.requireSuperAdmin()` لصفحات admin
5. `auth.signOut()` يمسح: realtime channels + store + currentProfile + يوجّه لـ login

عند انتهاء الاشتراك:
- `mountShell` يلتقط `SUBSCRIPTION_EXPIRED`
- يعيد التركيب بـ `skipActiveCheck=true`
- يوجّه `#/subscription` (المستخدم يجدد)

## CSS

- `tokens.css` — variables أولاً
- `base.css` — reset + typography + auth/landing pages
- `layout.css` — app shell
- `components/*.css` — مكوّنات منفصلة
- `main.css` — umbrella يستخدم `@import` ⇒ HTML يحمّل ملفاً واحداً

## Multi-tenancy

- RLS في Supabase تعزل كل tenant
- `window.tenantApi.getMyTenantId()` يحتفظ بـ tenant_id الحالي
- جميع INSERTs تتضمّن `tenant_id` (NOT NULL)

## ما هو **خارج** هذه البنية حالياً

- لا بناء (build step) → لا tree-shaking، لا minification
- لا ES modules → اعتماد على ترتيب الـ scripts
- لا types (لا TypeScript ولا JSDoc صارم)
- لا tests
- لا CI/CD
- لا حماية ضد تكرار التحميل لو SPA معطّل

عند التوسّع (فريق أكبر / مستخدمين أكثر) فكّر في:
- Vite + ES Modules + lazy loading
- TypeScript أو JSDoc
- Vitest + Playwright
- ESLint + Prettier
