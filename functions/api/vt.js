// Cloudflare Pages Function — استقبال إشارات تتبع الزيارات (/api/vt)
// ----------------------------------------------------------------------------
// العميل (src/core/analytics.js) يرسل حمولة صغيرة، وهذه الدالة تُثريها بما لا
// يتوفر إلا على الحافة: الجغرافيا من request.cf (دولة/مدينة)، وتحليل User-Agent
// إلى جهاز/متصفح/نظام، وتجزئة IP يومية مُملّحة (ip_hash) تُستخدم في قاعدة
// البيانات لحدود المعدل فقط — لا يُخزَّن IP خام أبدًا ولا تُستخدم كهوية.
//
// ثم تستدعي دوال RPC العامة (record_visit / record_visit_leave /
// record_visit_event) عبر REST بمفتاح anon — نفس نمط functions/book.js.
// لا أسرار جديدة إلزامية: SUPABASE_URL وSUPABASE_KEY موجودان أصلًا في إعدادات
// Cloudflare Pages؛ TRACK_SALT اختياري لتقوية ملح التجزئة.
//
// المسار /api/vt اسم محايد عمدًا (أسماء مثل /track و/analytics تحجبها قوائم
// مانعات الإعلانات). الدالة fail-silent بالكامل: أي خلل → 204 — التتبع يجب
// ألا يكسر صفحة زائر أبدًا، والمرسل لا يهمه الرد أصلًا.

// زواحف ومتصفحات آلية — تُسقَط قبل أي تسجيل (زواحف OG لا تنفذ JS أصلًا،
// هذا يلتقط ما ينفذه أو يستدعي المسار مباشرة)
const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|skype|slack|discord|headless|lighthouse|pingdom|uptime|monitor|scrapy|curl|wget|python-requests/i;

const EMPTY = new Response(null, { status: 204 });

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return EMPTY;

    // نفس الأصل فقط: الوسم يعمل على صفحاتنا نفسها، فأي Origin غريب = إغراق
    const url = new URL(request.url);
    if (!sameOrigin(request, url.hostname)) return EMPTY;

    const ua = request.headers.get('user-agent') || '';
    if (!ua || BOT_UA.test(ua)) return EMPTY;

    // sendBeacon يرسل text/plain — نقرأ النص ونحلله يدويًا مهما كان النوع
    const raw = await request.text();
    if (!raw || raw.length > 4096) return EMPTY;
    const body = JSON.parse(raw);

    if (body.type === 'view') {
      const id = await recordView(env, request, body, ua);
      return new Response(JSON.stringify({ id: id || null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (body.type === 'leave') {
      await callRpc(env, 'record_visit_leave', {
        p_visit_id: str(body.visit_id, 40),
        p_seconds: int(body.seconds),
      });
      return EMPTY;
    }
    if (body.type === 'event') {
      await callRpc(env, 'record_visit_event', {
        p_event_type: str(body.event_type, 40),
        p_tenant_id: str(body.tenant_id, 40),
        p_field_id: str(body.field_id, 40),
        p_visitor_id: str(body.visitor_id, 40),
        p_session_id: str(body.session_id, 40),
        p_booking_id: str(body.booking_id, 40),
      });
      return EMPTY;
    }

    return EMPTY;
  } catch (_) {
    return EMPTY; // أي خطأ غير متوقع → صمت تام
  }
}

// ── تسجيل مشاهدة: إثراء ثم استدعاء record_visit، يعيد id الصف (توكن المغادرة) ──
async function recordView(env, request, body, ua) {
  const cf = request.cf || {}; // غير متاح في wrangler dev المحلي — الجغرافيا null
  const ip = request.headers.get('cf-connecting-ip') || '';
  const referrer = str(body.referrer, 500);

  const result = await callRpc(env, 'record_visit', {
    p_page: str(body.page, 20),
    p_tenant_id: str(body.tenant_id, 40),
    p_field_id: str(body.field_id, 40),
    p_visitor_id: str(body.visitor_id, 40),
    p_session_id: str(body.session_id, 40),
    p_referrer: referrer,
    p_utm_source: str(body.utm_source, 100),
    p_utm_medium: str(body.utm_medium, 100),
    p_utm_campaign: str(body.utm_campaign, 100),
    p_device: deviceType(ua),
    p_browser: browserName(ua),
    p_os: osName(ua),
    p_country: cf.country ? String(cf.country) : null,
    p_city: cf.city ? String(cf.city) : null,
    p_language: str(body.language, 10),
    p_ip_hash: ip ? await dailyIpHash(env, ip) : null,
  });
  return typeof result === 'string' ? result : null;
}

// ── استدعاء RPC عبر REST بمفتاح anon (نمط fetchTenant في functions/book.js) ──
async function callRpc(env, fn, args) {
  try {
    const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      },
      body: JSON.stringify(args),
    });
    if (!resp.ok) return null;
    const text = await resp.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

// ── تجزئة IP اليومية المُملّحة: sha256(تاريخ اليوم UTC + ملح + IP) ──
// تتغير كل يوم فلا يمكن تتبع زائر عبر الأيام بها — غرضها الوحيد حدود المعدل.
async function dailyIpHash(env, ip) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const salt = env.TRACK_SALT || 'marma-vt-2026';
    const data = new TextEncoder().encode(`${day}|${salt}|${ip}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    return null;
  }
}

// ── فحص نفس الأصل: Origin أو Referer يجب أن يطابق مضيف الطلب ──
function sameOrigin(request, hostname) {
  const src = request.headers.get('origin') || request.headers.get('referer');
  if (!src) return false;
  try {
    return new URL(src).hostname === hostname;
  } catch (_) {
    return false;
  }
}

// ── تحليل User-Agent (تقريبي عمدًا — يكفي للتحليلات) ──
function deviceType(ua) {
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet';
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return 'mobile';
  return 'desktop';
}

function browserName(ua) {
  if (/Edg(e|A|iOS)?\//i.test(ua)) return 'Edge';
  if (/SamsungBrowser\//i.test(ua)) return 'Samsung Internet';
  if (/(OPR|Opera)\//i.test(ua)) return 'Opera';
  if (/(Firefox|FxiOS)\//i.test(ua)) return 'Firefox';
  if (/(Chrome|CriOS)\//i.test(ua)) return 'Chrome';
  if (/Safari\//i.test(ua)) return 'Safari';
  return null;
}

function osName(ua) {
  if (/Windows/i.test(ua)) return 'Windows';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return null;
}

// ── تنظيف مدخلات: نص مقصوص أو null / عدد صحيح ──
function str(v, max) {
  if (v == null) return null;
  const s = String(v).slice(0, max).trim();
  return s || null;
}

function int(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}
