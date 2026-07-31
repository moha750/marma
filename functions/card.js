// Cloudflare Pages Function — معاينة مشاركة ديناميكية لرابط بطاقة الولاء.
// ----------------------------------------------------------------------------
// نفس مبدأ functions/book.js: زواحف واتساب لا تُشغّل JavaScript، فلولا هذا
// لظهرت كل بطاقة بعنوان عام واحد. هنا نحقن اسم الملعب في الوسوم قبل الإرسال.
//
// خصوصية مقصودة: لا نكشف اسم العميل ولا رصيده في المعاينة — الرابط يُعاد
// توجيهه في المحادثات ولقطات الشاشة، والاسم فيه لا يخدم أحداً.

const GENERIC_IMAGE = 'https://marma.help/assets/og/booking.png';

export async function onRequest(context) {
  const { request, env, next } = context;

  try {
    const url = new URL(request.url);
    const payload = (url.searchParams.get('c') || '').trim();
    const page = await next();

    if (!payload || !env.SUPABASE_URL || !env.SUPABASE_KEY) return page;

    const card = await fetchCard(env, payload);
    if (!card || !card.tenant) return page;

    const name = String(card.tenant.name || 'ملعبك');
    const title = `بطاقة ولاء ${name}`;
    const desc = 'أضِف بطاقتك إلى محفظة جوالك — أختامك تُضاف تلقائياً بعد كل حجز.';
    const image = pickImage(card) || GENERIC_IMAGE;

    const rewriter = new HTMLRewriter()
      .on('title', new TextSetter(title))
      .on('meta[name="description"]', new AttrSetter('content', desc))
      .on('meta[property="og:title"]', new AttrSetter('content', title))
      .on('meta[property="og:description"]', new AttrSetter('content', desc))
      .on('meta[property="og:image"]', new AttrSetter('content', image))
      .on('meta[name="twitter:title"]', new AttrSetter('content', title))
      .on('meta[name="twitter:description"]', new AttrSetter('content', desc))
      .on('meta[name="twitter:image"]', new AttrSetter('content', image));

    const html = await rewriter.transform(page).text();
    return new Response(html, {
      status: page.status,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  } catch (_) {
    // هذه الدالة يجب ألّا تكسر صفحة بطاقة عميل أبداً
    return next();
  }
}

async function fetchCard(env, payload) {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/loyalty_public_card`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`
      },
      body: JSON.stringify({ p_payload: payload })
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

function pickImage(card) {
  const p = card.program || {};
  return p.hero_url || p.logo_url || (card.tenant && card.tenant.logo) || null;
}

// ملاحظة من functions/book.js: أسماء element/text/comments محجوزة كدوال في
// معالِجات HTMLRewriter — فلا تُسمَّ أي خاصية `text` هنا وإلا انهار التحويل.
class AttrSetter {
  constructor(attr, value) { this.attr = attr; this.value = value; }
  element(el) { el.setAttribute(this.attr, this.value); }
}

class TextSetter {
  constructor(value) { this.value = value; }
  element(el) { el.setInnerContent(this.value); }
}
