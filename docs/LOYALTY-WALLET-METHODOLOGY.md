# منهجية بطاقات الولاء الرقمية (Apple Wallet + Google Wallet)

> وثيقة تصميم وتنفيذ لميزة «بطاقات الولاء» في مَرمى — يُنشئها المشترك (صاحب الملعب)
> لعملائه، فتُضاف إلى Apple Wallet على iOS و Google Wallet على Android، وتُحدَّث
> تلقائياً عند كل حجز أو استبدال.
>
> الحالة: مُنفَّذ على المنصّتين. الإصدار 1.2 — 2026-08-06 — **وصلت موافقة نشر
> مُصدِر Google Wallet، وطبقة جوجل مبنيّة ومنشورة** (§6). ما يتبقّى تشغيلي لا
> برمجي: ضبط `GOOGLE_SA_JSON` و`GOOGLE_ISSUER_ID` ثم اختبار على جهاز أندرويد.

---

## 0. الخلاصة التنفيذية

### الجواب المباشر على سؤالك

| السؤال | الجواب |
|---|---|
| رخصة مطوّر أبل ($99/سنة) | **مطلوبة** ✅ عندك — منها نُصدر Pass Type ID + شهادة التوقيع |
| رخصة مطوّر أندرويد ($25 مرة واحدة / Play Console) | **غير مطلوبة إطلاقاً** ❌ — Google Wallet لا يمرّ عبر Play Console |
| تطبيق جوال (iOS/Android) | **غير مطلوب** ❌ — البطاقات تُوزَّع كرابط ويب فقط |
| ما نحتاجه إضافةً للرخص | 1) **حساب مُصدِر Google Wallet** (Issuer — مجاني، يحتاج موافقة نشر)<br>2) مشروع Google Cloud + تفعيل Wallet API + Service Account<br>3) **Pass Type ID + شهادة توقيع** من حساب أبل (مجانية داخل العضوية)<br>4) **شهادة Apple WWDR G4** الوسيطة (مجانية، تنزيل مباشر)<br>5) **مفتاح APNs** لتحديث البطاقات لحظياً (مجاني — مرحلة 4)<br>6) نطاق HTTPS ✅ (`marma.help` موجود)<br>7) أصول بصرية لكل ملعب (شعار 660×660، hero 1032×336، icon 87×87) |
| تكلفة تشغيلية إضافية | **صفر** — لا Supabase إضافي، لا Cloudflare إضافي، Google Wallet API مجاني |

### الفكرة المعمارية في ٣ أسطر

1. **نحن (مَرمى) المُصدِر التقني الوحيد**: Pass Type ID واحد + Issuer ID واحد لكل النظام. كل ملعب يحصل على *هوية بصرية* داخل البطاقة (شعاره، لونه، اسمه) — **ولا يحتاج أي حساب مطوّر**. هذا هو نموذج منصّات الولاء (Square/Toast/Fivestars) وهو ما يجعل الميزة قابلة للبيع كـ SaaS.
2. **منطق الولاء في PostgreSQL** (RPCs + triggers) تماماً كباقي النظام، و**التكامل الخارجي في Edge Functions**، والجسر بينهما `pg_net` — نفس نمط `send-booking-push` الموجود.
3. **الكسب تلقائي من الحجوزات الفعلية**: كل حجز **مؤكد وانتهى وقته ومُسدَّد بالكامل ولم يُوسم بالغياب** يمنح ختماً. لا مسح، لا عمل يدوي، **ولا تلاعب ممكن** — الأختام مُشتقّة من إيراد حقيقي. المسح يُستخدم للصرف فقط.

---

## 1. نطاق المنتج (ما نبنيه بالضبط)

### 1.1 رحلة صاحب الملعب (المشترك)

```
/loyalty  ← صفحة جديدة في اللوحة (ownerOnly)
├── تبويب «البرنامج»  : عدد الأختام المطلوبة + نوع المكافأة وقيمتها + قيودها + تفعيل/إيقاف
├── تبويب «الهوية»    : قالب من ٣ + شعاره + لون من لوحة معتمدة + الشروط + معاينة حيّة
├── تبويب «البطاقات»  : قائمة المنضمّين + الرصيد + القسائم + إصدار/حظر + إرسال الرابط
└── تبويب «السجل»     : كل حركة وقسيمة (كسب/صرف/تعديل) بمن نفّذها ومتى
```

**المالك يحدّد كل شيء** (§4.4): «كم ختماً؟» و«ما المكافأة؟» — حجز مجاني، أو خصم نسبة، أو خصم مبلغ، أو مكافأة عينية — وقيمتها وسقفها وصلاحيتها.

### 1.2 رحلة العميل

```
حجز مكتمل → إشعار واتساب/إيميل فيه رابط البطاقة
          → /card?c=<token>  (صفحة عامة، RTL، بهوية الملعب)
             ├── iOS      → زر «إضافة إلى Apple Wallet»   → ملف .pkpass
             ├── Android  → زر «Add to Google Wallet»      → رابط pay.google.com
             └── غير ذلك  → بطاقة ويب (PWA) بنفس الـ QR + إمكانية تثبيتها
```

البطاقة تُحدَّث **من نفسها** في جيب العميل: 7/10 ← 8/10 بعد أي حجز، بلا فتح أي تطبيق.

**الانضمام تلقائي** لكل من يُتمّ حجزاً، مع سطر موافقة ظاهر في صفحة الحجز وإلغاء بضغطة واحدة (§11.4).

### 1.3 رحلة الموظف (الاستبدال)

```
/loyalty/scan  ← ماسح كاميرا في اللوحة (يعمل على جوال الموظف)
   يمسح QR البطاقة → يظهر: اسم العميل + جواله + الرصيد + «مكافأة متاحة ×1»
   → زر «استبدال» → (اختياري) رمز PIN من ظهر البطاقة → خصم + تسجيل + تحديث البطاقة
```

### 1.4 خارج النطاق (v1)

سلّم مكافآت متعدد المستويات (§16)، نقل الأرصدة بين ملاعب، بطاقات هدايا/رصيد مالي، Rotating Barcodes، بطاقات عضوية بأقساط، تكامل نقاط بيع خارجية.

---

## 2. القرارات المعمارية (وبديلها ولماذا رُفض)

| # | القرار | البديل المرفوض | السبب |
|---|---|---|---|
| **D1** | Pass Type ID + Issuer ID **واحد** لمَرمى، وتخصيص بصري لكل ملعب | حساب مطوّر لكل مشترك | لا أحد سيشتري ميزة تطلب منه $99/سنة وشهادات؛ نموذج المنصّة هو المعيار |
| **D2** | منطق النقاط في **RPCs + triggers** داخل Postgres | منطق في Edge Functions | تماسك ذرّي مع الحجوزات، RLS مجاناً، اتساق مع باقي المشروع |
| **D3** | الكسب مُشتقّ من **شرط «الحجز المكتمل الفعلي»** (§4.2)، وإسناده مرة واحدة عبر علم `bookings.loyalty_awarded_at` | مسح QR لإضافة الأختام | يمنع التلاعب تماماً، صفر عمل على الموظف، ويستفيد من وسم `no_show_at` الموجود |
| **D4** | QR = **مُعرِّف موقَّع (HMAC) وليس حاملاً لقيمة** | QR يحمل توكن قابل للصرف | لقطة شاشة للـ QR لا تُمكِّن أحداً من شيء؛ الصرف يحتاج جلسة موظف + PIN |
| **D5** | `authenticationToken` لآبل **مُشتقّ**: `HMAC(secret, serial‖version)` | تخزين توكن لكل بطاقة | تحقّق بلا استعلام قاعدة، وتدوير فوري عبر `token_version` |
| **D6** | توليد وتوقيع `.pkpass` داخل **Supabase Edge Function** (Deno + `npm:node-forge` + `npm:fflate`) | خدمة Node منفصلة | المشروع يستورد `npm:web-push` أصلاً بنجاح → لا حاجة لبنية تحتية جديدة |
| **D7** | `webServiceURL` = **`https://marma.help/api/wallet`** عبر Pages Function وسيطة | رابط `*.functions.supabase.co` مباشر | هوية النطاق، وطبقة تحكّم/كاش على الحافة، ومرونة تبديل الخلفية دون إبطال البطاقات المُصدَرة |
| **D8** | نسخة `.pkpass` **مُخزَّنة في Storage** بمفتاح `card_id/updated_at` | توليد عند كل طلب | التوقيع ~120ms؛ آبل تسأل عن البطاقة كثيراً؛ `Last-Modified` + 304 يخفض الحمل ~90% |
| **D9** | **Google: PATCH على الكائن** لتحديث الرصيد، **آبل: APNs ثم سحب** | إعادة إصدار بطاقة جديدة | إعادة الإصدار تفقد البطاقة القديمة وتربك العميل |
| **D10** | الميزة **حصرية للخطة الأعلى** (`plans.loyalty_included` → `tenants.loyalty_enabled`) | مفتوحة للجميع | نفس نمط `allowed_fields/allowed_staff` الموجود، وتصبح رافعة ترقية للاشتراك |
| **D11** | بلوغ العتبة **يُصدر قسيمة مستقلة** (`loyalty_rewards`) ويخصم الأختام فوراً | عدّاد أختام فقط يُخصم عند الصرف | العميل يرى «مكافأة جاهزة برمز» بدل رصيد غامض، والقسيمة كيان مالي قابل للتتبّع والإلغاء وربطه بحجز |
| **D12** | **٣ قوالب معتمدة** + شعار المالك + لون من لوحة محدودة | منتقي ألوان وصور حر | البطاقة تمثّل مَرمى في جيب العميل؛ الحرية الكاملة تُنتج بطاقات رديئة التباين وتضرّ سمعتنا (D12 يفرض فحص WCAG AA) |
| **D13** | انضمام **تلقائي** + سطر موافقة في صفحة الحجز + إلغاء بضغطة | خانة موافقة صريحة قبل الحجز | أعلى تبنٍّ بفارق كبير؛ الملاحظة القانونية والمقايضة في §11.4 |

---

## 3. المتطلبات الخارجية — قائمة تنفيذية

### 3.1 آبل (من عضويتك الحالية — كل ما يلي مجاني داخلها)

**(أ) إنشاء Pass Type ID**
`developer.apple.com` → Certificates, Identifiers & Profiles → Identifiers → **+** → **Pass Type IDs**
```
Identifier:  pass.help.marma.loyalty     ← يجب أن يبدأ بـ pass.
Description: Marma Loyalty Card
```
سجّل أيضاً **Team ID** (10 أحرف) من صفحة Membership → يدخل في `teamIdentifier`.

**(ب) شهادة التوقيع** (بلا نظام macOS — عبر OpenSSL فقط)
```bash
# 1) مفتاح خاص + CSR
openssl req -new -newkey rsa:2048 -nodes \
  -keyout pass.key -out pass.csr \
  -subj "/CN=Marma Loyalty Pass/O=Marma/C=SA"

# 2) ارفع pass.csr في صفحة الـ Pass Type ID → نزّل pass.cer

# 3) حوّل إلى PEM
openssl x509 -inform DER -in pass.cer -out pass.pem

# 4) شهادة أبل الوسيطة WWDR G4 من www.apple.com/certificateauthority
openssl x509 -inform DER -in AppleWWDRCAG4.cer -out wwdr.pem

# 5) تحقّق أن السلسلة صحيحة قبل أي كود
openssl verify -CAfile AppleIncRootCA-G3.pem -untrusted wwdr.pem pass.pem
```
> ⚠️ **شهادة الـ Pass صالحة سنة واحدة.** انتهاؤها = توقّف إصدار وتحديث كل البطاقات. راجع §12.2 (روتين التدوير) — هذا أخطر بند تشغيلي في المشروع كله.

**(ج) مفتاح APNs** (للمرحلة 4 — التحديث اللحظي)
Keys → **+** → فعّل *Apple Push Notification service* → نزّل `AuthKey_XXXX.p8` (مرة واحدة فقط) + سجّل Key ID.
> عندك أصلاً `AuthKey_CWYQQV925H.p8` لكنه لـ Sign in with Apple — **أنشئ مفتاحاً منفصلاً** ولا تخلط الاستخدامين.

### 3.2 Google (بدون Play Console)

| خطوة | المكان | ملاحظات |
|---|---|---|
| 1. مشروع Google Cloud | `console.cloud.google.com` | يجوز استخدام مشروع قائم |
| 2. تفعيل **Google Wallet API** | APIs & Services → Library | مجاني |
| 3. **حساب مُصدِر (Issuer)** | `pay.google.com/business/console` | مجاني — يعطيك **Issuer ID** رقمي |
| 4. **Service Account** + مفتاح JSON | IAM → Service Accounts | المفتاح = سر (§11) |
| 5. ربط الحساب بالمُصدِر | Wallet Console → Users → أضف بريد الـ SA بصلاحية **Developer** | تُنسى كثيراً → كل النداءات تفشل 403 |
| 6. طلب **موافقة النشر** | Wallet Console → Publishing | ✅ **وصلت 2026-08-06.** قبلها كان **Demo mode**: تُحفظ البطاقات على حسابات اختبار مُضافة يدوياً فقط |

### 3.3 خارج المنصّتين

| البند | الحالة | ملاحظة |
|---|---|---|
| نطاق HTTPS بشهادة صالحة | ✅ `marma.help` | آبل ترفض `webServiceURL` بلا HTTPS سليم |
| مخزن أسرار | ✅ Supabase Function Secrets | الشهادات بصيغة base64 |
| Bucket لأصول البطاقات | يُضاف | `wallet-assets` بنفس سياسات `field-images` (أول مجلد = `tenant_id`) |
| ماسح QR | كود فقط | `BarcodeDetector` أصلاً في Chrome/Android، و`jsQR` كبديل على iOS — لا عتاد مطلوب |
| سياسة خصوصية محدَّثة (PDPL) | مطلوب | البطاقة تحمل اسم العميل ورصيده → §11.4 |
| شروط برنامج الولاء | مطلوب | نص لكل ملعب يظهر في ظهر البطاقة (آبل تطلب وضوح الشروط) |

---

## 4. تصميم قاعدة البيانات

ملف واحد: `supabase/migrations/<timestamp>_loyalty_wallet.sql`
> ⚠️ ذكّر نفسك بانحراف الـ migrations: اسم الملف يجب أن يطابق النسخة المسجّلة قبل الدفع إلى `main`.

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- 1) برنامج الولاء — واحد لكل ملعب
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.loyalty_programs (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null unique references public.tenants(id) on delete cascade,
  name               text not null,
  kind               text not null default 'stamps' check (kind in ('stamps','points')),
  is_active          boolean not null default false,

  -- قواعد الكسب
  earn_on            text not null default 'completed' check (earn_on in ('completed','paid')),
  earn_per_booking   numeric(10,2) not null default 1,       -- أختام لكل حجز
  earn_per_currency  numeric(10,4) not null default 0,       -- نقاط لكل ريال (kind='points')
  min_booking_amount numeric(10,2) not null default 0,
  auto_enroll        boolean not null default true,          -- بطاقة تلقائياً لأول حجز
  signup_bonus       numeric(10,2) not null default 0,

  -- ★ المكافأة — كلها من اختيار المالك (§4.4)
  reward_threshold   numeric(10,2) not null default 10        -- كم ختماً؟
                       check (reward_threshold between 2 and 50),
  reward_kind        text not null default 'free_booking' check (reward_kind in
                       ('free_booking','percent_discount','amount_discount','free_item')),
  reward_value       numeric(10,2),                           -- دقائق | نسبة % | ريال
  reward_max_value   numeric(10,2),                           -- سقف الخصم بالريال
  reward_label       text not null default 'حجز مجاني',       -- يُولَّد تلقائياً وقابل للتحرير
  reward_valid_days  integer,                                 -- null = القسيمة لا تنتهي (الافتراضي)
  reward_excludes_offers boolean not null default true,        -- لا تُجمع مع عرض سعري
  reward_terms       text,
  points_expire_days integer,                                 -- null = الأختام لا تنتهي
  redeem_pin_enabled boolean not null default true,

  -- الهوية البصرية (قالب من ٣ + لون من لوحة معتمدة — §4.5)
  template    text not null default 'classic'
                check (template in ('classic','photo','stamps')),
  brand_bg    text not null default '#0F3D2E',
  brand_fg    text not null default '#FFFFFF',
  brand_label text not null default '#C9D6CF',
  logo_url text, hero_url text, icon_url text,
  terms    text,

  google_class_id text,                                      -- {issuerId}.marma-{tenant_id}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) البطاقات
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.loyalty_cards (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  program_id    uuid not null references public.loyalty_programs(id) on delete cascade,
  customer_id   uuid not null references public.customers(id) on delete cascade,

  serial        text not null unique default encode(gen_random_bytes(12),'hex'),  -- serialNumber لآبل + محتوى QR
  balance          numeric(12,2) not null default 0,
  lifetime_earned  numeric(12,2) not null default 0,
  rewards_available integer not null default 0,
  rewards_redeemed  integer not null default 0,
  redeem_pin    text,                                        -- 4 أرقام، تظهر في ظهر البطاقة
  status        text not null default 'active' check (status in ('active','blocked')),
  token_version integer not null default 1,                  -- تدوير authenticationToken

  google_object_id text,
  pass_updated_at  timestamptz not null default now(),        -- Last-Modified لآبل
  last_synced_at   timestamptz,
  created_at       timestamptz not null default now(),
  unique (program_id, customer_id)
);
create index on public.loyalty_cards(tenant_id, created_at desc);
create index on public.loyalty_cards(customer_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) دفتر الحركات (append-only — لا UPDATE ولا DELETE)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.loyalty_transactions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  card_id    uuid not null references public.loyalty_cards(id) on delete cascade,
  delta      numeric(12,2) not null,
  reason     text not null check (reason in
               ('booking','manual','reward_issued','reward_void','expiry','adjust','signup_bonus')),
  booking_id uuid references public.bookings(id) on delete set null,
  note       text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.loyalty_transactions(card_id, created_at desc);
create index on public.loyalty_transactions(booking_id) where booking_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3.5) القسائم — تُصدَر تلقائياً عند بلوغ العتبة (§4.4)
--      لقطة (snapshot) من قواعد البرنامج وقت الإصدار: تغيير المالك للقواعد
--      لاحقاً لا يغيّر قسيمة بيد عميل — وهذا شرط عدالة وليس تفصيلاً تقنياً.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.loyalty_rewards (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  card_id     uuid not null references public.loyalty_cards(id) on delete cascade,
  code        text not null,                              -- 6 خانات مقروءة: 7KQ2M4
  kind        text not null check (kind in
                ('free_booking','percent_discount','amount_discount','free_item')),
  value       numeric(10,2),
  max_value   numeric(10,2),
  label       text not null,                              -- «حجز مجاني 60 دقيقة»
  status      text not null default 'available'
                check (status in ('available','redeemed','expired','void')),
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users(id) on delete set null,
  booking_id  uuid references public.bookings(id) on delete set null,
  unique (tenant_id, code)
);
create unique index if not exists loyalty_reward_one_per_booking
  on public.loyalty_rewards(booking_id) where booking_id is not null;
create index on public.loyalty_rewards(card_id, status);

-- ربط الحجز بالقسيمة + أثر مالي ظاهر في التقارير
-- ★ loyalty_awarded_at هو مفتاح عدم الازدواجية: الإسناد يتم بـ
--   UPDATE ... WHERE loyalty_awarded_at IS NULL (ذرّي بقفل الصف)، والسحب يُصفّره
--   فيسمح بإعادة المنح عند التراجع عن «لم يحضر» — وهذا ما يعجز عنه قيد فريد على الدفتر.
alter table public.bookings
  add column if not exists loyalty_reward_id uuid
    references public.loyalty_rewards(id) on delete set null,
  add column if not exists discount_amount   numeric(10,2) not null default 0,
  add column if not exists loyalty_awarded_at timestamptz;

-- سجل الموافقة على البرنامج (§11.4)
alter table public.customers
  add column if not exists loyalty_consent_at  timestamptz,
  add column if not exists loyalty_consent_src text,   -- booking_page | staff | card_page
  add column if not exists loyalty_consent_ver text,   -- نسخة نص الموافقة المعروض
  add column if not exists loyalty_opt_out_at  timestamptz;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) تسجيلات أجهزة آبل (تُدار من Edge Function بمفتاح service_role فقط)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.wallet_apple_registrations (
  id                uuid primary key default gen_random_uuid(),
  card_id           uuid not null references public.loyalty_cards(id) on delete cascade,
  device_library_id text not null,
  push_token        text not null,
  created_at        timestamptz not null default now(),
  unique (device_library_id, card_id)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) طابور المزامنة الخارجية (إعادة محاولة + رصد)
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.wallet_sync_queue (
  id         bigserial primary key,
  card_id    uuid not null references public.loyalty_cards(id) on delete cascade,
  target     text not null check (target in ('apple','google')),
  attempts   integer not null default 0,
  last_error text,
  done_at    timestamptz,
  created_at timestamptz not null default now()
);
create index on public.wallet_sync_queue(done_at, created_at) where done_at is null;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) حدود الخطة — الميزة حصرية للخطة الأعلى (§10)
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.plans
  add column if not exists loyalty_included boolean not null default false;

alter table public.tenants
  add column if not exists loyalty_enabled       boolean not null default false,
  add column if not exists allowed_loyalty_cards integer not null default 0;
```

### 4.1 RLS

```sql
alter table public.loyalty_programs         enable row level security;
alter table public.loyalty_cards            enable row level security;
alter table public.loyalty_transactions     enable row level security;
alter table public.wallet_apple_registrations enable row level security;
alter table public.wallet_sync_queue        enable row level security;

-- القراءة/الكتابة للملعب صاحب الصف فقط (نفس دوال المشروع)
create policy loyalty_programs_tenant on public.loyalty_programs
  for all to authenticated
  using (tenant_id = public.get_my_tenant_id())
  with check (tenant_id = public.get_my_tenant_id());
-- (مثلها لـ loyalty_cards و loyalty_transactions — القراءة للطرفين، الكتابة عبر RPC)

-- جداول المحفظة: بلا أي سياسة → لا وصول إلا بمفتاح service_role من Edge Functions
```

القراءة العامة للعميل (بلا حساب) تمرّ **حصراً** عبر RPC `SECURITY DEFINER` تُرجع الحد الأدنى — نفس نمط `get_public_tenant_info` و`customer_cancellation_v2_phone_lookup` الموجودين.

### 4.2 المحرّك: تريجرات ودوال

> ⚠️ **تصحيح جوهري اكتُشف عند التنفيذ:** الحالة `completed` في هذا النظام **مُشتقّة في الواجهة ولا تُخزَّن أبداً** — انظر `effectiveBookingStatus` في [src/core/utils.js:168](../src/core/utils.js#L168). صف الحجز يبقى `status='confirmed'` إلى الأبد. لذلك تريجر على `status → 'completed'` **لن يعمل ولا مرة واحدة**. الشرط الصحيح هو مرآة دقيقة لدالة الواجهة، ولأن أحد أطرافه **مرور الوقت** فلا يكفي تريجر وحده — نحتاج مكنسة مجدولة معه.

```sql
-- (أ) شرط الاستحقاق — مرآة حرفية لـ effectiveBookingStatus في الواجهة
--     ملاحظة: total_price = NULL يعني «السعر عند التواصل» ⇒ ماليّته غير محسومة ⇒ لا يُكافأ.
create or replace function public.loyalty_booking_qualifies(
  p_status text, p_no_show_at timestamptz, p_end_time timestamptz,
  p_total numeric, p_paid numeric
) returns boolean language sql stable as $$
  select p_status = 'confirmed'
     and p_no_show_at is null
     and p_end_time < now()
     and p_total is not null
     and (p_total <= 0 or coalesce(p_paid,0) >= p_total)
$$;

-- (ب) روتين الإسناد الوحيد — يستدعيه التريجر والمكنسة معاً
--     الذرّية من UPDATE ... WHERE loyalty_awarded_at IS NULL: أول من يمسك الصف يفوز.
create or replace function public.loyalty_award_booking(p_booking_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_b record; v_prog record; v_card_id uuid; v_delta numeric;
begin
  select * into v_b from bookings where id = p_booking_id for update;
  if not found or v_b.customer_id is null then return; end if;
  if v_b.loyalty_awarded_at is not null then return; end if;          -- مُسند سلفاً
  if not public.loyalty_booking_qualifies(v_b.status, v_b.no_show_at,
       v_b.end_time, v_b.total_price, v_b.paid_amount) then return; end if;

  select * into v_prog from loyalty_programs where tenant_id = v_b.tenant_id and is_active;
  if not found then return; end if;
  if coalesce(v_b.total_price,0) < v_prog.min_booking_amount then return; end if;

  select id into v_card_id from loyalty_cards
   where program_id = v_prog.id and customer_id = v_b.customer_id;
  if v_card_id is null then
    if not v_prog.auto_enroll then return; end if;
    v_card_id := public.loyalty_enroll(v_b.customer_id);
  end if;

  v_delta := case v_prog.kind when 'points'
               then round(coalesce(v_b.total_price,0) * v_prog.earn_per_currency, 2)
               else v_prog.earn_per_booking end;

  update bookings set loyalty_awarded_at = now()
   where id = p_booking_id and loyalty_awarded_at is null;
  if not found then return; end if;                                   -- سبقنا أحد

  insert into loyalty_transactions(tenant_id, card_id, delta, reason, booking_id)
  values (v_b.tenant_id, v_card_id, v_delta, 'booking', p_booking_id);
end $$;

-- (ج) السحب عند فقدان الاستحقاق (وسم غياب، إلغاء، استرداد مبلغ)
--
-- ⚠️ عيب اكتُشف في التشغيل الجاف: لو تحوّلت الأختام إلى قسيمة قبل السحب، فطرحها
-- يترك **رصيداً سالباً** على بطاقة في جيب العميل («‎-١ / ١٠»). العلاج: قبل الطرح
-- نُلغي قسيمة **غير مصروفة** ونُعيد أختامها بحركة `reward_void`.
--
-- ولماذا سبب منفصل لا `adjust`؟ لأن إعادة الأختام بسبب عادي تتجاوز العتبة فوراً
-- فيُصدر التريجر قسيمة جديدة مكان التي ألغيناها — عبث دائري. لذا `tg_loyalty_apply_tx`
-- يتخطّى فحص العتبة لـ `reward_issued` و`reward_void` معاً.
create or replace function public.loyalty_revoke_booking(p_booking_id uuid, p_note text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_tx record; v_updated int; v_bal numeric; v_thr numeric; v_rid uuid;
begin
  update bookings set loyalty_awarded_at = null
   where id = p_booking_id and loyalty_awarded_at is not null;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then return; end if;

  select * into v_tx from loyalty_transactions
   where booking_id = p_booking_id and reason = 'booking'
   order by created_at desc limit 1;
  if not found then return; end if;

  select c.balance, p.reward_threshold into v_bal, v_thr
    from loyalty_cards c join loyalty_programs p on p.id = c.program_id
   where c.id = v_tx.card_id;

  while v_bal - v_tx.delta < 0 loop
    select id into v_rid from loyalty_rewards
     where card_id = v_tx.card_id and status = 'available'
     order by issued_at desc limit 1;
    exit when v_rid is null;                    -- صُرفت فعلاً ⇒ السالب سجلّ أمين
    update loyalty_rewards set status = 'void' where id = v_rid;
    insert into loyalty_transactions(tenant_id, card_id, delta, reason, note)
    values (v_tx.tenant_id, v_tx.card_id, v_thr, 'reward_void', 'إلغاء قسيمة إثر سحب أختام');
    select balance into v_bal from loyalty_cards where id = v_tx.card_id;
    v_rid := null;
  end loop;

  insert into loyalty_transactions(tenant_id, card_id, delta, reason, booking_id, note)
  values (v_tx.tenant_id, v_tx.card_id, -v_tx.delta, 'adjust', p_booking_id, p_note);
end $$;

-- (د) التريجر: يلتقط تغيّر الدفع/الحالة/الغياب/الوقت/السعر
create or replace function public.tg_loyalty_booking_change()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if public.loyalty_booking_qualifies(new.status, new.no_show_at, new.end_time,
                                      new.total_price, new.paid_amount) then
    perform public.loyalty_award_booking(new.id);
  elsif new.loyalty_awarded_at is not null then
    perform public.loyalty_revoke_booking(new.id,
      case when new.no_show_at is not null then 'سحب ختم: وُسم بالغياب'
           when new.status = 'cancelled'   then 'سحب ختم: أُلغي الحجز'
           else 'سحب ختم: لم يعد مستوفياً للشرط' end);
  end if;
  return null;
end $$;

create trigger trg_loyalty_booking_change
  after insert or update of status, paid_amount, no_show_at, end_time, total_price
  on public.bookings
  for each row execute function public.tg_loyalty_booking_change();

-- (هـ) المكنسة — الطرف الذي لا يُحدِثه أحد: مرور الوقت.
--      حجز مدفوع مسبقاً ينتهي وقته دون أي UPDATE ⇒ لا تريجر ⇒ تلتقطه هذه.
create or replace function public.loyalty_award_sweep()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_count int := 0;
begin
  for v_id in
    select b.id from bookings b
     join loyalty_programs p on p.tenant_id = b.tenant_id and p.is_active
    where b.loyalty_awarded_at is null
      and b.customer_id is not null
      and b.end_time < now() and b.end_time > now() - interval '30 days'
      and public.loyalty_booking_qualifies(b.status, b.no_show_at, b.end_time,
                                           b.total_price, b.paid_amount)
    limit 500
  loop
    perform public.loyalty_award_booking(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

select cron.schedule('loyalty-award-sweep', '*/15 * * * *',
                     $$select public.loyalty_award_sweep()$$);

-- (ب) كل حركة: تُطبَّق على الرصيد، ثم تُصدر قسيمة إن بلغ العتبة، ثم تُجدول المزامنة
create or replace function public.tg_loyalty_apply_tx()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_prog record; v_balance numeric;
begin
  select p.* into v_prog
    from loyalty_programs p join loyalty_cards c on c.program_id = p.id
   where c.id = new.card_id;

  update loyalty_cards set
    balance         = balance + new.delta,
    lifetime_earned = lifetime_earned + greatest(new.delta, 0),
    pass_updated_at = now()
  where id = new.card_id
  returning balance into v_balance;

  -- ★ الإصدار التلقائي للقسيمة. الحركتان reward_issued (خصم عند الإصدار) و
  --   reward_void (إرجاع عند الإلغاء) تتخطّيان فحص العتبة — وإلا لأعاد الإرجاعُ
  --   الإصدارَ فوراً فدارت الحلقة بلا طائل.
  if new.reason not in ('reward_issued','reward_void') then
    while v_balance >= v_prog.reward_threshold loop
      insert into loyalty_rewards(tenant_id, card_id, code, kind, value, max_value,
                                  label, expires_at)
      values (new.tenant_id, new.card_id, public.loyalty_gen_code(new.tenant_id),
              v_prog.reward_kind, v_prog.reward_value, v_prog.reward_max_value,
              v_prog.reward_label,
              case when v_prog.reward_valid_days is null then null
                   else now() + (v_prog.reward_valid_days || ' days')::interval end);

      insert into loyalty_transactions(tenant_id, card_id, delta, reason, note)
      values (new.tenant_id, new.card_id, -v_prog.reward_threshold,
              'reward_issued', v_prog.reward_label);

      select balance into v_balance from loyalty_cards where id = new.card_id;
    end loop;
  end if;

  insert into wallet_sync_queue(card_id, target) values (new.card_id,'apple'),
                                                        (new.card_id,'google');
  perform public.notify_wallet_sync(new.card_id);   -- pg_net → Edge Function
  return new;
end $$;

create trigger trg_loyalty_apply_tx
  after insert on public.loyalty_transactions
  for each row execute function public.tg_loyalty_apply_tx();

-- (ج) عدّاد القسائم المتاحة على البطاقة (يقرؤه بناء البطاقة مباشرة)
create or replace function public.tg_loyalty_count_rewards()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  update loyalty_cards c set
    rewards_available = (select count(*) from loyalty_rewards r
                          where r.card_id = c.id and r.status = 'available'),
    rewards_redeemed  = (select count(*) from loyalty_rewards r
                          where r.card_id = c.id and r.status = 'redeemed'),
    pass_updated_at   = now()
  where c.id = coalesce(new.card_id, old.card_id);
  return null;
end $$;

create trigger trg_loyalty_count_rewards
  after insert or update of status on public.loyalty_rewards
  for each row execute function public.tg_loyalty_count_rewards();
```

### 4.3 واجهة RPC

| الدالة | من يستدعيها | الوظيفة |
|---|---|---|
| `loyalty_get_program()` | المالك/الموظف | البرنامج + إحصاءاته |
| `loyalty_upsert_program(jsonb)` | المالك | حفظ القواعد والهوية (+ يُجدول تحديث Google Class) |
| `loyalty_enroll(customer_id)` | الموظف/تريجر | إنشاء بطاقة + PIN + مكافأة انضمام، مع فحص `allowed_loyalty_cards` |
| `loyalty_list_cards(search, limit, offset)` | المالك/الموظف | جدول البطاقات |
| `loyalty_scan_lookup(serial, sig)` | الموظف | تحقّق HMAC ثم إرجاع بطاقة نطاقه فقط + قسائمها المتاحة |
| `loyalty_adjust(card_id, delta, note)` | المالك | تعديل يدوي (مسجَّل في الدفتر) |
| `loyalty_redeem(code, pin)` | الموظف | صرف قسيمة عينية (`free_item`) بلا حجز |
| `loyalty_apply_reward(code, booking_id, pin)` | الموظف | ربط القسيمة بحجز + احتساب الخصم (§4.4) |
| `loyalty_release_reward(code)` | الموظف/تريجر | إعادة القسيمة عند إلغاء الحجز |
| `loyalty_set_consent(customer_id, src, ver)` | عام/الموظف | تسجيل الموافقة أو الإلغاء (§11.4) |
| `loyalty_public_card(serial, sig)` | عام (anon) | بيانات صفحة العميل — الحد الأدنى، مع حد معدّل |
| `loyalty_expire_run()` | cron | إنهاء القسائم والأختام المنتهية |

كلها `SECURITY DEFINER` + `set search_path to 'public'` + فحص `is_tenant_active(tenant_id)` — نفس نمط `20260527000000_lock_inactive_tenant_reads.sql`.

### 4.4 محرّك المكافآت — ما يختاره المالك بالضبط

**«كم ختماً؟»** → `reward_threshold` (٢–٥٠، افتراضي ١٠).
**«ما المكافأة؟»** → أربعة أنواع تغطي كل ما يفعله ملعب حقيقي:

| النوع | ما يدخله المالك | التسمية المولّدة | كيف تُصرف |
|---|---|---|---|
| `free_booking` | مدة بالدقائق (٦٠/٩٠/١٢٠) أو «الفترة كاملة» | «حجز مجاني ٦٠ دقيقة» | خصم = سعر الفترة المحجوزة، بحد `reward_max_value` |
| `percent_discount` | نسبة ٥–١٠٠٪ (+ سقف ريالي) | «خصم ٢٥٪» | `total_price × (1 − p)` بحد `reward_max_value` |
| `amount_discount` | مبلغ بالريال | «خصم ٥٠ ريال» | `max(total_price − amount, 0)` |
| `free_item` | نص حر | «مشروبات للفريق» | لا خصم — الموظف يصرفها ويؤكد بالمسح |

**قيود يضبطها المالك:** صلاحية القسيمة (`reward_valid_days` — الافتراضي بلا انتهاء)، سقف الخصم (`reward_max_value` — يحمي من ساعة ذروة غالية)، ومنع الجمع مع عرض سعري (`reward_excludes_offers` — الافتراضي مفعّل، وهو الحاجز الأول ضد استغلال «ساعة مجانية على فترة مخفّضة أصلاً»).

**دورة حياة القسيمة:**
```
الأختام تبلغ العتبة
  └→ (تريجر) خصم العتبة + إصدار قسيمة برمز ٦ خانات   → البطاقة: «٠/١٠» + «مكافأة جاهزة · 7KQ2M4»
       ├→ free_item          → الموظف يمسح → «صرف»            → redeemed
       └→ أنواع الخصم        → loyalty_apply_reward(code, booking_id)
              → bookings.discount_amount + loyalty_reward_id، وخفض total_price → redeemed
                   └→ أُلغي الحجز؟ → loyalty_release_reward → تعود available
```

**لماذا خصم الأختام فوراً عند الاستحقاق؟** لأن «٧ من ١٠» ثم «مكافأة جاهزة» أوضح للعميل من رصيد يتراكم بلا معنى، ولأن القسيمة تصبح كياناً مالياً قابلاً للتتبّع والإلغاء والربط بحجز. **المقايضة:** لو انتهت صلاحية القسيمة ضاعت أختام العميل — لذلك `reward_valid_days` **افتراضه NULL (بلا انتهاء)**، وإن فعّله المالك ظهر تاريخ الانتهاء على وجه البطاقة وفي ظهرها.

**قواعد الحماية (كلها في `loyalty_apply_reward`):**
1. الصرف ذرّي: `update ... where code = ? and status = 'available'` — لا صرف مزدوج ولو ضغط موظفان معاً.
2. قسيمة واحدة لكل حجز (فهرس فريد على `booking_id`).
3. الخصم لا يُنزل `total_price` تحت `paid_amount` (قيد الجدول الأصلي يحرسه).
4. مرفوض إن كانت الفترة تحمل عرضاً نشطاً و`reward_excludes_offers` مفعّل.
5. مرفوض إن كان الحجز `cancelled` أو `no_show_at` مضبوطاً.
6. كل صرف يسجّل `redeemed_by` → تقرير «المكافآت المصروفة لكل موظف» (R5 في §15).

### 4.5 القوالب الثلاثة المعتمدة

| القالب | الشكل | يرفعه المالك | آبل | جوجل |
|---|---|---|---|---|
| **`classic` كلاسيكي** | خلفية صلبة بلون هويته + شعاره + عدّاد نصي «٧ / ١٠» | شعار مربّع | `logo.png` + `backgroundColor` | `programLogo` + `hexBackgroundColor` |
| **`photo` صورة الملعب** | صورة ملعبه شريطاً أعلى البطاقة مع تدرّج داكن يضمن قراءة النص | شعار + صورة عريضة | `strip.png` ٣٧٥×١٢٣pt | `heroImage` ١٠٣٢×٣٣٦ |
| **`stamps` عدّاد الأختام** | شريط فيه دوائر بعدد العتبة، المملوءة ملوّنة — الأجمل والأوضح | شعار فقط | `strip-{n}.png` مُولَّد | نفس الصورة كـ `heroImage` |

**التوليد المسبق (المفتاح الهندسي):** عند حفظ البرنامج نولّد `threshold+1` صورة (٠..N) **مرة واحدة** ونخزنها في `wallet-assets/{tenant_id}/strip-{n}.png`. بناء البطاقة يختار الصورة المطابقة للرصيد — بلا كلفة توليد وقت الطلب، وجوجل تُحدَّث بـ `PATCH heroImage`. التوليد: SVG ← PNG عبر `npm:@resvg/resvg-wasm` (مِسبار صغير في المرحلة ٠).

**حرّاس الجودة:** لوحة ألوان معتمدة (١٢ لوناً) لا منتقي حر، فحص تباين WCAG AA بين `brand_fg` و`brand_bg` يرفض الحفظ عند الفشل، وحد أدنى لأبعاد الشعار (٦٦٠×٦٦٠) والصورة (١٠٣٢×٣٣٦) عند الرفع، ومعاينة حيّة للوجهين تُحاكي شكل البطاقة الفعلي.

---

## 5. طبقة Apple Wallet

### 5.1 بنية ملف `.pkpass`

```
card.pkpass  (ZIP)
├── pass.json
├── manifest.json      ← { "pass.json": "<sha1>", "icon.png": "<sha1>", ... }
├── signature          ← PKCS#7 detached (DER) على manifest.json
├── icon.png           29×29     (إجباري)
├── icon@2x.png        58×58
├── icon@3x.png        87×87
├── logo.png           ≤160×50pt (يظهر أعلى يمين/يسار البطاقة)
├── logo@2x.png
├── strip.png          375×123pt @1x  (اختياري — خلفية شريط storeCard)
└── ar.lproj/pass.strings   (تعريب الحقول)
```
> لا ملفات زائدة (`__MACOSX`, `.DS_Store`) وإلا رفضت آبل الحزمة. الأسماء حسّاسة لحالة الأحرف. أبقِ الحزمة تحت ~200KB لسرعة الإضافة.

### 5.2 `pass.json` (storeCard — عربي RTL)

```json
{
  "formatVersion": 1,
  "passTypeIdentifier": "pass.help.marma.loyalty",
  "teamIdentifier": "<TEAM_ID>",
  "organizationName": "ملاعب المطر — بواسطة مَرمى",
  "description": "بطاقة ولاء ملاعب المطر",
  "serialNumber": "9f2c7a10bd3e4c5f6a7b8c9d",
  "webServiceURL": "https://marma.help/api/wallet",
  "authenticationToken": "<HMAC(serial‖token_version)>",
  "backgroundColor": "rgb(15,61,46)",
  "foregroundColor": "rgb(255,255,255)",
  "labelColor": "rgb(201,214,207)",
  "logoText": "ملاعب المطر",
  "sharingProhibited": true,
  "storeCard": {
    "headerFields":    [{ "key": "bal",    "label": "الأختام",        "value": "7 / 10" }],
    "primaryFields":   [{ "key": "reward", "label": "المكافأة",       "value": "حجز مجاني 60 دقيقة" }],
    "secondaryFields": [{ "key": "member", "label": "العضو",          "value": "محمد العلي" },
                        { "key": "left",   "label": "الباقي",         "value": "3 حجوزات" }],
    "backFields":      [{ "key": "pin",    "label": "رمز الاستبدال",  "value": "4821" },
                        { "key": "book",   "label": "احجز الآن",      "value": "https://marma.help/book?t=<tenant>" },
                        { "key": "terms",  "label": "شروط البرنامج",  "value": "<reward_terms>" },
                        { "key": "out",    "label": "إلغاء الاشتراك", "value": "https://marma.help/card?c=<serial>.<sig>#out" }]
  },
  "barcodes": [{
    "format": "PKBarcodeFormatQR",
    "message": "MRM1:9f2c7a10bd3e4c5f6a7b8c9d:<sig>",
    "messageEncoding": "iso-8859-1",
    "altText": "9f2c7a10"
  }],
  "locations": [{ "latitude": 24.7136, "longitude": 46.6753,
                  "relevantText": "بطاقتك جاهزة — أنت عند ملاعب المطر" }],
  "maxDistance": 300
}
```

**ثلاث نقاط تصنع الفرق:**
- **حالتان للوجه**: بلا قسيمة → `primaryFields` = «المكافأة: حجز مجاني ٦٠ دقيقة» مع الأختام «٧ / ١٠». وبقسيمة متاحة → `primaryFields` = «مكافأة جاهزة · 7KQ2M4» مع تغيير `backgroundColor` إلى لون احتفالي. العميل يعرف من نظرة واحدة أن لديه شيئاً يصرفه.
- `locations` تُسحب من `fields.latitude/longitude` الموجودة أصلاً → البطاقة **تظهر على شاشة القفل** عند وصول العميل للملعب. أقوى ميزة تسويقية في الحزمة كلها (حد أبل: 10 مواقع/بطاقة → أول 10 أرضيات).
- `sharingProhibited: true` يمنع تمرير البطاقة لشخص آخر، و`organizationName` يحمل «— بواسطة مَرمى» فيظهر في كل إشعار بطاقة على جهاز العميل.

### 5.3 التوقيع (داخل Deno)

```ts
// supabase/functions/_shared/pkpass.ts
import forge from "npm:node-forge@1.3.1";
import { zipSync } from "npm:fflate@0.8.2";

async function sha1(bytes: Uint8Array) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-1", bytes))]
    .map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function buildPkpass(files: Record<string, Uint8Array>) {
  // 1) manifest
  const manifest: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) manifest[name] = await sha1(bytes);
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));

  // 2) PKCS#7 detached: signer = شهادة الـ Pass، والوسيطة = WWDR G4
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifestBytes);
  p7.addCertificate(forge.pki.certificateFromPem(Deno.env.get("APPLE_PASS_CERT_PEM")!));
  p7.addCertificate(forge.pki.certificateFromPem(Deno.env.get("APPLE_WWDR_PEM")!));
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(Deno.env.get("APPLE_PASS_KEY_PEM")!),
    certificate: forge.pki.certificateFromPem(Deno.env.get("APPLE_PASS_CERT_PEM")!),
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date().toISOString() },
    ],
  });
  p7.sign({ detached: true });

  const signature = new Uint8Array(
    forge.util.binary.raw.decode(forge.asn1.toDer(p7.toAsn1()).getBytes()));

  return zipSync({ ...files, "manifest.json": manifestBytes, "signature": signature });
}
```

> ✅ **مُثبَت على جهاز حقيقي (2026-07-31) — سقط أكبر خطر في المشروع:**
> الشهادة صادرة لـ `pass.help.marma.loyalty` تحت الفريق `72T373ZM34` (تنتهي 2027-08-29)،
> والمفتاح الخاص يطابقها، وتتحقّق سلسلتها مقابل WWDR G4. و**`node-forge`** — نفس المكتبة
> التي ستعمل داخل Deno — أنتجت توقيع PKCS#7 منفصلاً قَبِله OpenSSL، وحُزمت `.pkpass`
> بـ ٨ مُدخلات مسطّحة (٧٫٣ ك.ب).
>
> **Apple Wallet قَبِلها على iPhone**: أُضيفت البطاقة، والعربية سليمة RTL في الوجه والظهر،
> والحقول ظهرت كما صُمِّمت (الأختام، المكافأة، رمز الاستبدال، الشروط، رابط الحجز).
>
> ⇒ قرار D6 (التوقيع داخل Edge Function بلا خدمة Node منفصلة) **صالح**.
>
> ✅ **ثم شُغِّلت الوحدة في Deno نفسه:** `supabase/functions/_shared/pkpass.ts` ولّدت
> ٦ صور PNG عبر `CompressionStream` (منها شريط الأختام ٧٥٠×٢٤٦)، وحزمت ووقّعت عبر
> `npm:node-forge` — والتوقيع الناتج **قَبِله OpenSSL**. حزمة ١٣٫٣ ك.ب.
> فلا مِسبار متبقٍّ في مسار التوقيع: يعمل في Node وفي Deno وعلى iPhone.

**اختبار محلي مكافئ (للتحقّق قبل كتابة أي كود):**
```bash
openssl smime -binary -sign -certfile wwdr.pem -signer pass.pem \
  -inkey pass.key -in manifest.json -out signature -outform DER
zip -r card.pkpass pass.json manifest.json signature icon.png logo.png
# ثم أرسل الملف لنفسك بالبريد وافتحه على iPhone — إن أُضيف، فالتوقيع سليم
```

### 5.4 خدمة ويب PassKit (٥ مسارات إجبارية)

`webServiceURL = https://marma.help/api/wallet` → Pages Function تُمرّر إلى Edge Function `wallet-apple`.

| المسار | الطريقة | الدلالة |
|---|---|---|
| `/v1/devices/{deviceLibId}/registrations/{passTypeId}/{serial}` | `POST` | تسجيل جهاز (body: `{pushToken}`) → **201** جديد / **200** موجود / **401** |
| نفسه | `DELETE` | إلغاء التسجيل → **200** |
| `/v1/devices/{deviceLibId}/registrations/{passTypeId}?passesUpdatedSince=<tag>` | `GET` | الأرقام المتغيرة → `{lastUpdated, serialNumbers}` أو **204** |
| `/v1/passes/{passTypeId}/{serial}` | `GET` | أحدث `.pkpass` (يحترم `If-Modified-Since` → **304**) |
| `/v1/log` | `POST` | أخطاء آبل — **سجّلها**، هي وسيلة التشخيص الوحيدة |

المصادقة في كل نداء: `Authorization: ApplePass <token>` ⇒ تحقّق `timingSafeEqual` مقابل `HMAC(secret, serial‖token_version)` — بلا استعلام قاعدة.

### 5.5 التحديث اللحظي (APNs)

```http
POST https://api.push.apple.com/3/device/<pushToken>
apns-topic: pass.help.marma.loyalty          ← الـ Pass Type ID، ليس bundle id
apns-push-type: background
authorization: bearer <JWT ES256 من مفتاح .p8>

{}                                            ← حمولة فارغة تماماً
```
الجهاز يستقبل ← يستدعي `GET /v1/passes/...` ← يحدّث البطاقة. ثوانٍ.

> 🔬 **بند تحقّق مسبق (Spike A):** المسار المؤكد تاريخياً لتحديث البطاقات هو **mTLS بشهادة الـ Pass**، وهو غير متاح بسهولة في Deno. المصادقة بالتوكن (`.p8`) أبسط بكثير وتعمل في Edge Function عادية. **أثبِت أياً منهما يعمل في يوم واحد قبل بناء المرحلة 4.** إن فشل التوكن: بديلان — (1) Cloudflare Worker مع ربط mTLS، (2) خدمة Node صغيرة (~$0–5/شهر). **لا تعتمد على أي منهما دون إثبات عملي.**

**بلا APNs، النظام يعمل**: المستخدم يسحب لأسفل في ظهر البطاقة فتتحدّث فوراً. لهذا APNs في المرحلة 4 لا الأولى.

---

## 6. طبقة Google Wallet

### 6.1 Class (قالب الملعب) — يُنشأ مرة عند تفعيل البرنامج

```jsonc
// POST https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass
{
  "id": "3388000000012345678.marma-<tenant_id>",
  "issuerName": "ملاعب المطر — بواسطة مَرمى",
  "programName": "بطاقة ولاء ملاعب المطر",
  "programLogo": { "sourceUri": { "uri": "https://.../logo-660.png" } },
  "hexBackgroundColor": "#0F3D2E",
  "heroImage": { "sourceUri": { "uri": "https://.../hero-1032x336.png" } },
  "countryCode": "SA",
  "reviewStatus": "UNDER_REVIEW",
  "linksModuleData": { "uris": [
    { "uri": "https://marma.help/book?t=<tenant_id>", "description": "احجز الآن" },
    { "uri": "tel:+9665xxxxxxx", "description": "اتصل بالملعب" }]},
  "locations": [{ "latitude": 24.7136, "longitude": 46.6753 }]
}
```

### 6.2 Object (بطاقة العميل)

```jsonc
// POST .../loyaltyObject   ثم   PATCH .../loyaltyObject/{id} عند كل تغيير
{
  "id": "3388000000012345678.9f2c7a10bd3e4c5f6a7b8c9d",
  "classId": "3388000000012345678.marma-<tenant_id>",
  "state": "ACTIVE",
  "accountId": "9f2c7a10bd3e4c5f6a7b8c9d",
  "accountName": "محمد العلي",
  "loyaltyPoints": { "label": "الأختام", "balance": { "string": "7 / 10" } },
  "barcode": { "type": "QR_CODE", "value": "MRM1:9f2c...:<sig>", "alternateText": "9f2c7a10" },
  "textModulesData": [{ "header": "المكافأة", "body": "حجز مجاني 60 دقيقة — باقي 3 حجوزات" }]
  // عند توفّر قسيمة: secondaryLoyaltyPoints = { label: "مكافأة جاهزة", balance: { string: "7KQ2M4" } }
}
```

### 6.3 رابط «Add to Google Wallet»

```jsonc
// JWT موقَّع RS256 بمفتاح الـ Service Account
{ "iss": "wallet@<project>.iam.gserviceaccount.com",
  "aud": "google", "typ": "savetowallet", "iat": 1690000000,
  "origins": ["https://marma.help"],
  "payload": { "loyaltyObjects": [{ "id": "...", "classId": "..." }] } }
```
→ `https://pay.google.com/gp/v/save/<jwt>`

نُنشئ الكائن أولاً بـ REST ثم نضع في الـ JWT **مرجعه فقط** (`id` + `classId`) → رابط قصير، والحالة تبقى ملكنا وقابلة للتحديث.

### 6.4 التحديث

`PUT` على الكائن → يظهر على جهاز العميل تلقائياً. لا APNs ولا مكافئ له. أرخص وأبسط جانب في المشروع.

> **لماذا `PUT` لا `PATCH` كما كان في التصميم؟** الدمج لا يحذف حقلاً غائباً. عند
> صرف القسيمة يجب أن يختفي `secondaryLoyaltyPoints`، ومع `PATCH` تبقى «مكافأة
> جاهزة» معروضة على بطاقة عميلٍ صرفها فعلاً. نرسل الحالة كاملةً مبنيّةً من
> قاعدتنا في كل مرة، فالكائن انعكاسٌ للحقيقة لا تراكمٌ فوقها. أما الفئة فتبقى
> `PATCH` — لا نملك كل ما تكتبه جوجل عليها.

> ✅ **Spike B محسوم (2026-08-06):** المُصدِر المعتمَد لا ينتظر مراجعةً لكل فئة.
> الفئة تُنشَأ بـ `reviewStatus: "UNDER_REVIEW"` وتُربط بها الكائنات فوراً
> (`DRAFT` وحدها هي التي لا تقبل كائنات) ⇒ تفعيل الملعب لحظي، ولم يُحتَج بديل
> «الـ Class العام» الموصوف أعلاه.

### 6.5 ما بُني فعلاً

```
supabase/functions/
├── _shared/loyalty-card.ts    # التواقيع + قراءة صفّ البطاقة (تخدم الدوال الثلاث)
├── _shared/google-wallet.ts   # OAuth بحساب خدمة + upsert فئة/كائن + رابط الحفظ
└── wallet-google/index.ts     # GET /save/<serial>.<sig> → 302 إلى pay.google.com
```

| القرار التنفيذي | لماذا |
|---|---|
| الكائن يُنشأ عند ضغط العميل «أضف للمحفظة» فقط، والمزامنة `create:false` | بطاقةٌ لم يحفظها صاحبها لا كائن لها؛ إنشاؤها من طرفنا يعني بطاقات معلّقة في حسابات لم تطلبها |
| الفئة تُحدَّث عند `google_synced_at < loyalty_programs.updated_at` | `loyalty_upsert_program` يرفع `updated_at` عند كل حفظ ⇒ ختم زمني واحد يكفي، بلا تريجر ولا طابور ثالث، والمسار يُصلح نفسه |
| فشل مسار جوجل يُعيد العميل إلى `/card?...&gw=err` | بطاقة تعمل بـ QR خيرٌ من صفحة ٥٠٣؛ الخطأ يُسجَّل عندنا لا في وجه العميل |
| `wallet-sync` يعمل بمنصّة واحدة مضبوطة | كان يسقط بـ 503 إن نقصت أسرار آبل — فيُوقف مزامنة أندرويد معها بلا سبب |
| `/api/*` تتخطّى الـ service worker | ملف البطاقة يتغيّر مع كل ختم، والـ 302 لا شأن له بمنطق التنقّل |

**الأصل الاحتياطي:** جوجل تشترط `programLogo` في كل فئة. الترتيب: شعار البرنامج ← شعار الملعب ← `assets/wallet/marma-logo.png` (٦٦٠×٦٦٠ يُنشر مع الموقع) — ملعبٌ بلا شعار لا تُحجب بطاقته.

> ⚠️ **متبقٍّ غير برمجي:** زرّ «Add to Google Wallet» عندنا بهوية مَرمى لا بأصل
> جوجل الرسمي. إرشادات علامة جوجل تطلب الزرّ الرسمي في الواجهات العامة —
> استبدله بأصل جوجل قبل التوسّع الواسع.

---

## 7. الدوال والمسارات

### 7.1 Supabase Edge Functions (جديدة)

```
supabase/functions/
├── _shared/
│   ├── pkpass.ts          # التوقيع + الحزم (§5.3)
│   ├── wallet-assets.ts   # جلب/تحجيم أصول الملعب من Storage
│   └── google-wallet.ts   # OAuth JWT + REST + save-link
├── wallet-apple/          # خدمة PassKit الخمسة + توليد .pkpass
├── wallet-google/         # upsert class/object + إصدار رابط الحفظ
└── wallet-sync/           # يُنادى من pg_net: PATCH لجوجل + APNs لآبل + تصريف الطابور
```

### 7.2 Cloudflare Pages Functions (جديدة)

```
functions/
├── api/wallet/[[path]].js   # وسيط شفّاف → Edge Function wallet-apple
│                            #  + Content-Type: application/vnd.apple.pkpass
│                            #  + تمرير If-Modified-Since / Last-Modified / 304
└── card.js                  # وسوم OG لصفحة البطاقة (نفس نمط book.js بالحرف)
```

### 7.3 عقود الواجهة العامة

| المسار | الوصف |
|---|---|
| `GET /card?c=<serial>.<sig>` | صفحة البطاقة العامة (HTML) |
| `GET /api/wallet/pkpass/<serial>.<sig>` | تنزيل `.pkpass` |
| `GET /api/wallet/google/<serial>.<sig>` | 302 → `pay.google.com/gp/v/save/<jwt>` |
| `POST /api/wallet/v1/...` | خدمة PassKit (آبل فقط) |

---

## 8. الواجهات (متوافقة مع `docs/ADDING-A-FEATURE.md`)

```
src/features/loyalty/
├── api.js                    →  window.loyaltyApi
└── pages/
    ├── program.js            →  /loyalty        (ownerOnly) — القواعد + الهوية + معاينة حيّة
    ├── cards.js              →  /loyalty/cards  — الجدول + بحث + إرسال الرابط واتساب
    └── scan.js               →  /loyalty/scan   — الماسح (للموظف أيضاً)
```

خطوات الدمج (نفس دليل الـ feature): route في `src/app/routes.js` → عنصر sidebar في `src/shared/components/layout.js` → دمج في `src/core/api.js` → `<script>` في `app.html` → مسار جذر في `vite.config.js` (`APP_ROUTES`) → قناة realtime في `src/core/realtime.js`:

```js
{ channel: 'rt-loyalty', table: 'loyalty_transactions',
  invalidates: ['loyalty:cards','loyalty:stats'], event: 'loyalty:change' }
```

**الماسح:**
```js
// BarcodeDetector أصلاً (Android/Chrome) → jsQR كبديل (iOS Safari)
const supported = 'BarcodeDetector' in window &&
  (await BarcodeDetector.getSupportedFormats()).includes('qr_code');
```
مع خيار **إدخال يدوي** لآخر 8 خانات من الـ serial — الكاميرا تفشل في ملعب مساءً أكثر مما تتصور.

**صفحة العميل** `card.html` (على نمط `book.html`): كشف المنصّة → عرض الزر الصحيح، شارة تقدّم (7/10)، سجل آخر 5 حركات، زر «احجز الآن»، وبطاقة ويب بديلة.

---

## 9. مصفوفة التكامل مع ما هو مبني فعلاً

| الموجود | كيف يُستثمر |
|---|---|
| `effectiveBookingStatus` في `src/core/utils.js` | مصدر شرط الاستحقاق حرفياً — الخادم يعكس ما تراه الواجهة (§4.2) |
| `no_show_at` (وسم «لم يحضر») | يسحب الختم، والتراجع عنه يعيده — قيمة فورية بلا كود إضافي |
| `customers (tenant_id, phone) unique` | هوية حامل البطاقة، بلا حساب مستخدم |
| `fields.latitude/longitude` | `locations` في آبل و Google → البطاقة على شاشة القفل |
| `tenants.logo_url` | مصدر افتراضي لشعار البطاقة (اقتراح بضغطة) |
| `field_offers` + `offer_targets` | `reward_excludes_offers` يمنع جمع المكافأة مع فترة مخفّضة أصلاً |
| `fields.image_urls` | مصدر جاهز لصورة قالب `photo` — بلا رفع جديد |
| `bookings.total_price` / `paid_amount` | نقطة تطبيق الخصم، وقيد الجدول يحرس السالب تلقائياً |
| `booking_whatsapp_confirmed` | قناة توزيع البطاقة الأولى — أعلى تحويل من الإيميل |
| نظام `notifications` | إشعار المالك عند كل استبدال |
| `pg_net` في `tg_notify_new_booking` | نفس الجسر لـ `wallet-sync` |
| Realtime publication | تحديث لوحة البطاقات لحظياً |
| `account_sessions` + `visit_tracking` | قياس أثر البرنامج على التكرار |
| `allowed_fields/allowed_staff` | نفس نمط تقييد `allowed_loyalty_cards` |
| `assets/vendor/qrcode.min.js` | توليد QR للبطاقة الويب فوراً |

---

## 10. التسعير والتقييد

**القرار: حصرية للخطة الأعلى.** جداول `plans` صفوف يديرها الأدمن (لا enum ثابت)، فالتقييد عبر عمود:

```sql
alter table public.plans add column if not exists loyalty_included boolean not null default false;
update public.plans set loyalty_included = true where name = '<اسم الخطة الأعلى>';
```

نقاط الربط الثلاث:
1. **`approve_subscription`** (`20260515112037_update_subscription_rpcs_for_units.sql:126` حيث تُطبَّق `allowed_fields/staff`): يُشتق `tenants.loyalty_enabled` و`allowed_loyalty_cards` من خطة الاشتراك المعتمَد.
2. **التخفيض عند التجديد** (`subscription_downgrade_at_renewal`): إعادة الاشتقاق — الميزة تُطفأ عند النزول لخطة أدنى.
3. **`loyalty_enroll`**: يرفض بخطأ عربي واضح إن كان `loyalty_enabled = false` أو بلغ `allowed_loyalty_cards` — نفس نمط `enforce_field_staff_limits`.

**سلوك الإطفاء (مقصود):** البطاقات المُصدَرة **تبقى في جيوب العملاء** وتُعرض بحالتها الأخيرة، والقسائم المتاحة **تبقى قابلة للصرف**؛ يتوقف فقط كسب أختام جديدة وإصدار بطاقات جديدة. كسر بطاقة في جيب عميل يضرّ سمعة الملعب وسمعتنا معاً — والمالك يرى بانر «برنامج ولائك متوقف — رقِّ خطتك» وهو أقوى دافع ترقية في المنتج.

**واجهة الأدمن:** مفتاح `loyalty_included` في شاشة إدارة الخطط، وعمود «الولاء» في `admin_list_tenants`.

---

## 11. الأمن والخصوصية

### 11.1 توقيع الـ QR
```
payload = "MRM1:" + serial + ":" + base64url(HMAC_SHA256(QR_SECRET, serial))[:16]
```
لا يحمل قيمة، ولا يُعرِّف أكثر من بطاقة، وأي تغيير في الـ serial يُبطله. لقطة الشاشة عديمة الأثر: الصرف يحتاج **جلسة موظف مصدَّقة + PIN**.

### 11.2 الأسرار (Supabase Function Secrets)
```
APPLE_PASS_CERT_PEM   APPLE_PASS_KEY_PEM   APPLE_WWDR_PEM
APPLE_TEAM_ID         APPLE_PASS_TYPE_ID
APPLE_APNS_KEY_P8     APPLE_APNS_KEY_ID          # مرحلة 4
GOOGLE_SA_JSON        GOOGLE_ISSUER_ID
WALLET_AUTH_SECRET    QR_SECRET                  # عشوائيان 32 بايت
```
`.gitignore` يستثني `*.p8` أصلاً — **أضف** `*.p12 *.pem *.key *.cer` قبل أول تجربة.

### 11.3 حدود ومعدّلات
| المسار | الحد |
|---|---|
| `loyalty_public_card` | 30/دقيقة لكل IP (نفس ملح `ip_hash` في `/api/vt`) |
| PassKit `POST /v1/log` | 100/دقيقة، اقتطاع 4KB |
| `loyalty_redeem` | استبدال واحد/بطاقة/5 دقائق |
| الحقن العام | `/api/wallet/*` يرفض ما لا يطابق نمط `serial.sig` قبل أي استعلام |

### 11.4 الموافقة (PDPL)

**القرار المعتمد: انضمام تلقائي + سطر موافقة ظاهر في صفحة الحجز.**

النص المعروض فوق زر التأكيد في `book.html` (مرئي، غير مطوي، بحجم مقروء):

> بإتمام الحجز أوافق على الانضمام إلى **برنامج ولاء {اسم الملعب}** وإصدار بطاقة ولاء باسمي — [تفاصيل البرنامج](#) · يمكنني إلغاء الاشتراك في أي وقت.

عند إتمام الحجز يُسجَّل: `loyalty_consent_at = now()`، `loyalty_consent_src = 'booking_page'`، و`loyalty_consent_ver = 'v1'` (**نسخة النص المعروض** — بدونها لا تستطيع إثبات *ماذا* وافق عليه العميل بعد تعديل الصياغة).

**الإلغاء بضغطة واحدة** — إلزامي لصحة هذا النموذج: رابط في ظهر بطاقة آبل وفي صفحة البطاقة → `loyalty_opt_out_at` → إيقاف الكسب + `state: EXPIRED` في جوجل + حذف تسجيلات آبل. القسائم المتاحة تبقى صالحة حتى تُصرف.

> ⚖️ **ملاحظة صريحة:** هذا «موافقة بالإشعار مقرونة بفعل إيجابي» — أضعف قانونياً من خانة اختيار غير مفعّلة مسبقاً، وأعلى تبنّياً بفارق كبير. القرار محسوم من مالك المنتج، والتخفيف: نص بارز لا مطوي، تسجيل نسخة النص، وإلغاء بضغطة. راجعه مع مستشار نظامي قبل تجاوز ~١٠٬٠٠٠ بطاقة.

### 11.5 بقية بنود PDPL
- **تصغير البيانات:** لا جوال ولا بريد داخل البطاقة أو الـ QR — الـ serial فقط.
- **حق المحو:** `loyalty_delete_card` → `state: EXPIRED` في جوجل + `DELETE` تسجيلات آبل + حذف صف البطاقة، مع الإبقاء على الحركات مجهّلة للحسابات المالية.
- **نقل عبر الحدود:** التصريح بأن جوجل/آبل يعالجان البيانات خارج المملكة في سياسة الخصوصية.
- **متعدد المستأجرين:** البطاقة تُصدَر باسم الملعب — بيّن في اتفاقية المشترك أنه *مالك البرنامج* ومَرمى *مُصدِر تقني*.

---

## 12. التشغيل

### 12.1 المراقبة
لوحة صحة في `/admin`: صفوف `wallet_sync_queue` غير المنجزة (>50 = إنذار)، معدل فشل APNs، توزيع `POST /v1/log` من آبل، **الأيام المتبقية لشهادة الـ Pass**، عدد البطاقات النشطة/ملعب.

### 12.2 روتين تدوير الشهادة ⚠️
```
T-60 يوماً: تنبيه تلقائي (cron يقرأ notAfter من الشهادة)
T-30: أنشئ CSR جديداً على نفس الـ Pass Type ID → نزّل الشهادة الجديدة
T-14: حدّث السر في Supabase → أصدر بطاقة اختبار → أضفها على iPhone حقيقي
T-0 : الشهادة القديمة تنتهي — البطاقات المُصدَرة تبقى صالحة، والتحديث والإصدار يستمران بالجديدة
```
افشل في هذا ⇒ يتوقف إصدار وتحديث كل البطاقات. اجعله بنداً في التقويم لا في الذاكرة.

### 12.3 وظائف مجدولة (pg_cron)
| المهمة | التكرار |
|---|---|
| `loyalty_award_sweep()` — إسناد الأختام التي استحقّت بمرور الوقت | كل 15 دقيقة |
| تصريف `wallet_sync_queue` (backoff أسّي) | كل 5 دقائق |
| `loyalty_expire_run()` | يومياً 03:00 |
| فحص انتهاء الشهادة | يومياً |
| تنظيف تسجيلات أجهزة ميتة (APNs 410) | أسبوعياً |

---

## 13. خطة التنفيذ

| المرحلة | المخرج | التقدير |
|---|---|---|
| **0. تحقّق مسبق** | Pass Type ID + شهادة، **`.pkpass` مُوقَّع يُضاف على iPhone حقيقي** (openssl محلياً أولاً)، Issuer ID + طلب النشر مُرسَل، إثبات `node-forge` و`resvg-wasm` في Deno، حسم Spike A و B | **1–2 يوم** |
| **1. المحرّك** | Migration + RLS + RPCs + تريجرات + **محرّك القسائم (§4.4)** + سطر الموافقة في `book.html`، اختبارات وحدة (نمط `test/pricing.test.js`) — **بلا محافظ**: الأختام تزيد والقسائم تُصدَر على حجوزات حقيقية | 3–4 أيام |
| **2. لوحة المالك** | `program.js` (تكوين المكافأة كاملاً) + `cards.js` + **القوالب الثلاثة وتوليد الأشرطة** + معاينة حيّة + فحص التباين + تقييد الخطة | 3–4 أيام |
| **3. المحافظ** ✅ | `wallet-apple` منشورة، وسيط Cloudflare، `card.html` + `functions/card.js`، RPCs عامة، زر واتساب في اللوحة. **أول بطاقة حقيقية صدرت وأُضيفت على iPhone (2026-07-31)** | ✔ |
| **4. المزامنة اللحظية** ✅ | `wallet-sync` منشورة (APNs بمصادقة توكن ES256)، جسر `pg_net` مع خنق تدفّق بفهرس فريد جزئي، تنظيف الأجهزة الميتة عند 410، وcron تصريف كل ٥ دقائق. **Spike A محسوم: التوكن لا الشهادة** | ✔ |
| **5. الصرف** ✅ | `scan.js` (كاميرا BarcodeDetector + jsQR لـ iOS + إدخال يدوي)، صرف عيني مباشر، ربط الخصم بحجز فعلي، PIN من العميل، إشعار المالك. متاحة للموظفين | ✔ |
| **5.ب طبقة جوجل** ✅ | **وصلت موافقة المُصدِر 2026-08-06.** `wallet-google` + `_shared/google-wallet.ts` (OAuth بحساب خدمة، upsert للفئة والكائن، رابط savetowallet)، فرع جوجل في `wallet-sync` صار PUT فعليّاً، زرّ أندرويد حقيقي في `card.js`، وتوحيد قراءة البطاقة في `_shared/loyalty-card.ts` | ✔ |
| **6. تجربة مُقيَّدة** | ملعبان حقيقيان، مراقبة أسبوع، أجهزة iOS/Android متعددة | 1 أسبوع |
| **7. الإطلاق** | ربط الخطط، إعلان داخل اللوحة، توثيق | 2 أيام |

**≈ 3.5 أسبوع عمل فعلي** + انتظار موافقة جوجل بالتوازي (لا يحجب مسار آبل).

### مبدأ التسلسل
**كل مرحلة تُشحن قيمة قائمة بذاتها.** المرحلة 1+2 = برنامج ولاء عامل بلوحة تحكم قبل وجود أي بطاقة محفظة. لو تعثّرت طبقة المحافظ، ما بُني قبلها ليس مهدوراً.

---

## 14. الاختبار والقبول

**آبل — على جهاز حقيقي لا محاكي:**
- [ ] إضافة البطاقة من Safari ومن واتساب ومن البريد
- [ ] العربية تظهر RTL سليمة في الوجه والظهر
- [ ] السحب لأسفل في الظهر يجلب الرصيد الجديد
- [ ] `locations`: البطاقة تقترح نفسها قرب الملعب
- [ ] بطاقة محظورة → `GET /v1/passes` يرجع تحديثاً بحالة «موقوفة»
- [ ] توكن خاطئ → 401 (لا 500، ولا كشف وجود البطاقة)
- [ ] `If-Modified-Since` بلا تغيير → 304

**جوجل:**
- [ ] الحفظ يعمل من Chrome/Android ومن رابط واتساب
- [ ] `PATCH` يظهر على الجهاز دون فتح التطبيق
- [ ] `state: EXPIRED` ينقل البطاقة لقسم المنتهية

**المحرّك — ١٨ اختباراً نجحت في تشغيل جاف على سكيما الإنتاج (2026-07-30، داخل `BEGIN…ROLLBACK`):**

| # | الاختبار | النتيجة |
|---|---|---|
| T1–T2 | حجز ماضٍ مُسدَّد ⇒ ختم واحد، والتحديثات المتكررة لا تضاعفه | ✅ |
| T3–T4 | ماضٍ غير مُسدَّد ⇒ صفر، وسداده لاحقاً ⇒ ختم فوري بالتريجر | ✅ |
| T5–T6 | برنامج متوقف ⇒ صفر، وتفعيله ثم المكنسة ⇒ ختم + إصدار قسيمة عند العتبة | ✅ |
| T7 | رمز القسيمة ٦ خانات وعدّاد البطاقة صحيح | ✅ |
| T8–T9 | وسم الغياب يسحب الختم **بلا رصيد سالب** (إلغاء قسيمة)، والتراجع يعيده | ✅ |
| T10 | إلغاء حجز مُكافأ يسحب ختمه ويلغي قسيمته | ✅ |
| T11–T14 | حساب الخصم: نسبة، مجاني تناسبي، سقف، ومبلغ أكبر من السعر (لا سالب) | ✅ |
| T15–T16 | سعر NULL وحجز مستقبلي لا يستحقان | ✅ |
| T17 | طابور مزامنة المحافظ يمتلئ | ✅ |
| T18 | **سلامة الدفتر**: مجموع الحركات = رصيد البطاقة بالضبط | ✅ |

**اختبارات إضافية تُشغَّل بعد التطبيق الفعلي (تحتاج سياق مصادقة):**
- [ ] حجز واحد لا يمنح ختمين ولو أُعيد تشغيل التريجر والمكنسة معاً مرات
- [ ] حجز **مدفوع مسبقاً** ينتهي وقته بلا أي UPDATE → المكنسة تمنحه الختم
- [ ] حجز انتهى وقته ثم سُدِّد → التريجر يمنحه فوراً (لا ينتظر المكنسة)
- [ ] حجز انتهى وقته وغير مُسدَّد → **صفر** (يبقى مطالِباً بالتحصيل)
- [ ] `total_price IS NULL` («عند التواصل») → صفر
- [ ] إلغاء بعد المنح يسحب الختم
- [ ] `no_show_at` يسحب الختم، والتراجع عنه يعيده — مرة واحدة لا أكثر
- [ ] بلوغ العتبة يُصدر قسيمة **واحدة** ويخصم الأختام ذرّياً (بلا تكرار لا نهائي في التريجر)
- [ ] رصيد يعادل ٣ أضعاف العتبة دفعة واحدة → ٣ قسائم بالضبط
- [ ] صرف متزامن للقسيمة نفسها من موظفَين → واحد ينجح والآخر يفشل بخطأ واضح
- [ ] الخصم لا يُنزل `total_price` تحت `paid_amount`
- [ ] `reward_excludes_offers` يرفض التطبيق على فترة ذات عرض نشط
- [ ] إلغاء حجز مربوط بقسيمة يعيدها `available`
- [ ] تعديل المالك لقواعد المكافأة **لا يغيّر** قسيمة صادرة (اختبار اللقطة)
- [ ] رصيد سالب مستحيل
- [ ] بلوغ `allowed_loyalty_cards` أو `loyalty_enabled=false` يرفض بخطأ عربي واضح
- [ ] ملعب A لا يقرأ بطاقة/قسيمة ملعب B (اختبار RLS صريح)
- [ ] `loyalty_opt_out_at` يوقف الكسب فوراً ويُبطل البطاقة على المنصّتين

---

## 15. المخاطر

| # | الخطر | الأثر | التخفيف |
|---|---|---|---|
| R1 | **انتهاء شهادة الـ Pass** | توقف الإصدار والتحديث كلياً | §12.2 + تنبيه T-60 + بند تقويم |
| R2 | تعثّر APNs في Deno (Spike A) | لا تحديث لحظي على iOS | السحب اليدوي يغطي؛ البدائل محسومة سلفاً |
| R3 | ~~تأخّر/رفض موافقة جوجل~~ **انتهى** | — | وصلت الموافقة 2026-08-06؛ أُطلق iOS أولاً كما خُطِّط فلم يحجب شيئاً |
| R4 | ~~مراجعة كل Class (Spike B)~~ **انتهى** | — | مُصدِر معتمَد ⇒ فئة بـ `reviewStatus: UNDER_REVIEW` تُستخدم فوراً؛ لم يُحتَج بديل الـ Class العام |
| R9 | حساب الخدمة غير مضاف في Wallet Console | كل النداءات 403 بلا سبب ظاهر | أضِف بريد الـ SA بصلاحية **Developer** — أكثر خطأ إعداد شيوعاً (§3.2 خطوة 5) |
| R5 | تلاعب الموظفين بالاستبدال | خسارة مباشرة للمالك | كل حركة موقَّعة بـ `created_by`، تقرير «استبدالات لكل موظف»، PIN |
| R6 | أصول بصرية ضعيفة من الملاك | بطاقة رديئة = سمعة سيئة | فحص أبعاد وحد أدنى للدقة عند الرفع + قوالب جاهزة + معاينة حيّة |
| R7 | نمو الطابور بلا رصد | بطاقات «متجمّدة» | لوحة الصحة + backoff + تنبيه >50 |
| R8 | أجهزة بلا أي محفظة | فقدان جزء من العملاء | البطاقة الويب/PWA بنفس الـ QR |

---

## 16. القرارات المعتمدة (2026-07-30)

| # | القرار | أين نُفِّذ في هذه الوثيقة |
|---|---|---|
| 1 | **أختام**، و**المالك يحدّد** عدد الأختام ونوع المكافأة وقيمتها وقيودها | §4.4 + أعمدة `reward_*` + جدول `loyalty_rewards` (D11) |
| 2 | **انضمام تلقائي** + سطر موافقة ظاهر في صفحة الحجز + إلغاء بضغطة | §11.4 + أعمدة `loyalty_consent_*` (D13) |
| 3 | **حصرية للخطة الأعلى** | §10 + `plans.loyalty_included` (D10) |
| 4 | **٣ قوالب معتمدة** + شعار المالك + لوحة ألوان محدودة | §4.5 + عمود `template` (D12) |
| 5 | **«{اسم الملعب} — بواسطة مَرمى»** على البطاقة | §5.2 `organizationName` + §6.1 `issuerName` |

### مؤجَّلات التصميم (لا تحجب شيئاً)

كلها تغييرات في `pngSolid` داخل `_shared/pkpass.ts` أو في ورقة أنماط واحدة —
معزولة تماماً عن المنطق، وكلفتها اليوم = كلفتها بعد شهر. تُنفَّذ بعد اكتمال المسار:

- **شكل الختم**: كرة قدم بدل الدائرة. ملاحظة تقنية: الكرة المرسومة عند ١٢ بكسل
  تصير بقعة غامضة — الحل الصحيح صورة PNG صغيرة مُدمجة تُكرَّر، لا رسم بالكود.
- شريط أغنى لقالب `photo` (تدرّج + اسم الملعب فوق الصورة).
- أيقونة البطاقة: حرف اسم الملعب بدل الدائرة البيضاء.
- ألوان إضافية في اللوحة المعتمدة بعد اختبار التباين.

### ما بقي مفتوحاً عمداً (خارج v1)

- **سلّم مكافآت متعدد** (٥ أختام = خصم، ١٠ = حجز مجاني): مؤجَّل — يفرض على العميل قرار «أصرف الآن أم أدّخر؟» ويستدعي واجهة اختيار في جانب العميل. المخطط لا يعيقه: تُضاف `loyalty_reward_tiers` لاحقاً دون كسر القسائم الصادرة.
- **اسم الخطة الأعلى وسعرها** — تُحدَّد عند التنفيذ (`plans` صفوف يديرها الأدمن).
- **قيمة `allowed_loyalty_cards`** لتلك الخطة (اقتراح: ٥٬٠٠٠ — عملياً بلا سقف لملعب واحد).
