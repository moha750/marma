// Cloudflare Pages Function — معاينة مشاركة ديناميكية لرابط الحجز
// ----------------------------------------------------------------------------
// المشكلة: زواحف واتساب/تويتر/فيسبوك تقرأ HTML الخام دون تشغيل JavaScript، فلا
// ترى بيانات الملعب التي يحمّلها التطبيق لاحقاً — فتظهر صورة/عنوان عامّان للجميع.
//
// الحل: نعترض طلب /book?t=<tenantId> على حافة Cloudflare، نجلب اسم الملعب وصورة
// غلافه من Supabase (دالة get_public_tenant_info العامة)، ونحقن وسوم Open Graph
// في الـ HTML عبر HTMLRewriter قبل إرساله. يعمل للجميع: البشر يحصلون على الصفحة
// نفسها (مع وسوم صحيحة) ثم يُكمل JS التحميل المعتاد؛ الزواحف تحصل على المعاينة.
//
// لا أسرار جديدة: SUPABASE_URL و SUPABASE_KEY (anon) متوفّران أصلاً في إعدادات
// Cloudflare Pages وتصل للدالة عبر context.env.
//
// مبدأ أساسي: هذه الدالة لا يجوز أن تكسر صفحة الحجز أبداً. أي خطأ → نرجع الصفحة
// الأصلية كما هي (وسوم عامة). لذا كل المنطق داخل try/catch، ونُرجع نتيجة
// transform() مباشرةً (HTMLRewriter يضبط الطول تلقائياً — إعادة بناء Response
// يدوياً مع نسخ Content-Length القديمة تسبّب 500).

const GENERIC_IMAGE = 'https://marma.help/assets/og/booking.png';

export async function onRequest(context) {
  const { request, env, next } = context;

  // الصفحة الثابتة الأصلية (book.html) — next() يتخطّى هذه الدالة للأصل الثابت
  const page = await next();

  try {
    const url = new URL(request.url);
    const tenantId = url.searchParams.get('t');

    // بلا معرّف ملعب أو بلا إعدادات Supabase → الصفحة كما هي (وسوم عامة)
    if (!tenantId || !env.SUPABASE_URL || !env.SUPABASE_KEY) return page;

    const tenant = await fetchTenant(env, tenantId);
    if (!tenant || !tenant.id) return page; // ملعب غير موجود أو خطأ → وسوم عامة

    const name = String(tenant.name || 'احجز ملعبك');
    const title = `${name} — احجز الآن عبر مَرمى`;
    const desc = tenant.description
      ? clip(String(tenant.description), 200)
      : `احجز ملعبك في ${name} بسهولة عبر مَرمى — اختر اليوم والموعد المناسب.`;
    const image = pickImage(tenant) || GENERIC_IMAGE;
    const canonical = `${url.origin}/book?t=${encodeURIComponent(tenantId)}`;

    // نُرجع نتيجة transform مباشرةً (لا نعيد بناء Response يدوياً)
    return new HTMLRewriter()
      .on('title',                            new TextSetter(title))
      .on('meta[name="description"]',         new AttrSetter('content', desc))
      .on('meta[property="og:title"]',        new AttrSetter('content', title))
      .on('meta[property="og:description"]',  new AttrSetter('content', desc))
      .on('meta[property="og:image"]',        new AttrSetter('content', image))
      .on('meta[property="og:image:alt"]',    new AttrSetter('content', name))
      .on('meta[property="og:url"]',          new AttrSetter('content', canonical))
      .on('meta[name="twitter:title"]',       new AttrSetter('content', title))
      .on('meta[name="twitter:description"]', new AttrSetter('content', desc))
      .on('meta[name="twitter:image"]',       new AttrSetter('content', image))
      .transform(page);
  } catch (_) {
    // أي خطأ غير متوقّع → الصفحة الأصلية سليمة بوسومها العامة
    return page;
  }
}

// ── جلب بيانات الملعب من Supabase (REST RPC, anon) ──────────────────────────
async function fetchTenant(env, tenantId) {
  try {
    const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/get_public_tenant_info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      },
      body: JSON.stringify({ p_tenant_id: tenantId }),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (_) {
    return null; // أي فشل شبكة → نرجع للوسوم العامة بدل كسر الصفحة
  }
}

// أولوية الصورة: غلاف الملعب → أول صورة لأول أرضية → الصورة العامة
function pickImage(tenant) {
  if (tenant.cover_image_url) return tenant.cover_image_url;
  const fields = Array.isArray(tenant.fields) ? tenant.fields : [];
  for (const f of fields) {
    if (f && Array.isArray(f.image_urls) && f.image_urls[0]) return f.image_urls[0];
  }
  return null;
}

function clip(text, max) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

// ── معالِجات HTMLRewriter ───────────────────────────────────────────────────
class AttrSetter {
  constructor(attr, value) { this.attr = attr; this.value = value; }
  element(el) { el.setAttribute(this.attr, this.value); }
}
class TextSetter {
  constructor(text) { this.text = text; }
  element(el) { el.setInnerContent(this.text); }
}
