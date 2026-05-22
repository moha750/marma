# دليل النشر — مَرمى

التطبيق يعمل على **Cloudflare Pages** (الواجهة الأمامية) + **Supabase** (قاعدة البيانات + Auth + Edge Functions). هذا الدليل يجمع كل الخطوات اليدوية لمرّة واحدة + ما يحدث تلقائياً.

---

## 🚀 ما يحدث تلقائياً (لا تدخّل بشري)

| الحدث | ما يحصل |
|-------|---------|
| `git push` لأي branch | لا شيء على الإنتاج. |
| فتح Pull Request | Cloudflare ينشر معاينة على `<branch>.marma-xxx.pages.dev` — اختبر هنا قبل merge. |
| `git push` لـ `main` | Cloudflare ينشر على `marma.help`. لو ملفات `supabase/` تغيّرت، GitHub Action `supabase.yml` يطبّق migrations وينشر Edge Functions. |

---

## 🔧 إعداد لمرّة واحدة (عند بدء المشروع / استضافة جديدة)

### 1) Cloudflare Pages

1. أنشئ حساباً مجانياً في [cloudflare.com](https://cloudflare.com)
2. Workers & Pages → Create → Pages → Connect to Git → اختر repo `marma`
3. **Build settings**:
   - Production branch: `main`
   - Framework preset: `Vite`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: (فارغ)
4. **Environment variables** (Settings → Environment variables):
   - أضف لـ Production و Preview:
     - `SUPABASE_URL` = `https://<project>.supabase.co`
     - `SUPABASE_KEY` = anon key من Supabase Dashboard
     - `VAPID_PUBLIC_KEY` = من توليد VAPID (انظر أدناه)
5. Deploy → ينشر على `marma-xxx.pages.dev`
6. **Custom domain** (Settings → Custom domains): أضف `marma.help` → اتبع تعليمات DNS

### 2) Supabase Vault Secrets (مرّة واحدة عبر SQL Editor)

```sql
SELECT vault.create_secret('<random-32-char-string>', 'INTERNAL_HOOK_SECRET');
SELECT vault.create_secret('https://<project>.supabase.co', 'PROJECT_URL');
```

### 3) Supabase Edge Function Secrets (عبر CLI أو Dashboard)

```bash
supabase secrets set \
  RESEND_API_KEY="re_..." \
  APP_URL="https://marma.help" \
  INTERNAL_HOOK_SECRET="<same as above>" \
  VAPID_PUBLIC_KEY="..." \
  VAPID_PRIVATE_KEY="..." \
  VAPID_SUBJECT="mailto:owner@marma.help"
```

### 4) GitHub Secrets (لـ `supabase.yml` workflow)

في GitHub repo → Settings → Secrets and variables → Actions → New repository secret:

| الاسم | القيمة | من أين |
|-------|--------|--------|
| `SUPABASE_ACCESS_TOKEN` | personal access token | Supabase Dashboard → Account → Access Tokens |
| `SUPABASE_PROJECT_REF` | `<project-ref>` | URL مشروعك (مثلاً `vwzseueqfghirhyhwbva`) |
| `SUPABASE_DB_PASSWORD` | كلمة سرّ DB | عند إنشاء المشروع، أو من Settings → Database → Reset password |

### 5) توليد VAPID Keys (لإشعارات Push، مرّة واحدة)

```bash
npx -y web-push generate-vapid-keys
```

احتفظ بـ Public + Private. ضع Public في:
- Cloudflare environment variable `VAPID_PUBLIC_KEY`
- Supabase secret `VAPID_PUBLIC_KEY`

ضع Private فقط في Supabase secret `VAPID_PRIVATE_KEY`.

---

## ➕ إضافة ميزة جديدة

### حالة 1: تعديل واجهة فقط (HTML/CSS/JS)
**خطوات يدوية**: صفر. push → Cloudflare ينشر.

### حالة 2: ميزة تحتاج DB migration
**خطوات يدوية**: صفر. push → `supabase.yml` يطبّق migration تلقائياً.

### حالة 3: ميزة تحتاج Edge Function جديد
**خطوات يدوية**: صفر. push → `supabase.yml` ينشر الـ function تلقائياً.

### حالة 4: ميزة تحتاج سر جديد على Supabase
**خطوات يدوية** (لمرّة واحدة):
```bash
supabase secrets set MY_NEW_SECRET="..."
```
ثم push كالمعتاد.

### حالة 5: ميزة تحتاج env variable جديد في الواجهة
**خطوات يدوية**:
1. أضفه في Cloudflare Pages → Settings → Environment variables (لـ Production و Preview)
2. أضفه في [scripts/generate-config.js](scripts/generate-config.js) (في كائن `env` وفي قالب `content`)
3. push

---

## 🆘 حلّ المشاكل

### "الموقع لا يعرض التحديث الجديد"
1. افتح المتصفح وحدّث الصفحة (Ctrl+Shift+R أو Cmd+Shift+R)
2. لو Service Worker عالق: DevTools → Application → Service Workers → Unregister → reload
3. لو ما زال: Cloudflare → Deployments → تأكّد آخر deploy نجح

### "Cloudflare build فشل"
- شِك على log في Cloudflare → Deployments
- أكثر سبب شائع: متغيّر بيئة ناقص → راجع Cloudflare → Settings → Environment variables

### "Edge Function يرجع 500"
- Supabase Dashboard → Edge Functions → اضغط على اسم الـ function → Logs
- أكثر سبب: سرّ ناقص في `supabase secrets`

### "Migration فشل في `supabase.yml`"
- GitHub → Actions → اضغط على الـ run الفاشل → اقرأ الخطأ
- لو SQL syntax: عدّل ملف migration و push مرة أخرى
- لو password خاطئ: تحقّق `SUPABASE_DB_PASSWORD` في GitHub Secrets

### "PWA يفتح نسخة قديمة"
- على الجوال: امسح بيانات الموقع من إعدادات المتصفح
- لاحقاً سنضيف auto cache-versioning (في deferred work)

---

## 🗂️ هيكل النشر

```
┌─────────────────────────────────────────────────┐
│  GitHub Repo (main branch)                       │
│  push يطلق:                                      │
│   ├─ Cloudflare Pages (HTML/CSS/JS) ─────► marma.help
│   └─ GitHub Action `supabase.yml`                │
│       (لو supabase/ تغيّرت)                       │
│       ├─ supabase db push (migrations)          │
│       └─ supabase functions deploy              │
│                                                  │
│  PR يطلق:                                        │
│   └─ Cloudflare preview ──► <branch>.pages.dev  │
└─────────────────────────────────────────────────┘
```

---

## 📦 الـ scripts المحلية

```bash
npm run dev      # تطوير محلي على localhost:5173
npm run build    # يولّد config.js + يبني dist/
npm run preview  # preview للـ dist بعد build
```

محلياً لـ `npm run build`: تحتاج `.env` ملف أو متغيّرات بيئة محدّدة لـ `SUPABASE_URL` إلخ. لو غير موجودة، البناء ينجح لكن الـ Supabase لن يتصل.
