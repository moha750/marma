// Cloudflare Pages Function — وسيط شفّاف لخدمتَي Apple Wallet و Google Wallet.
// ----------------------------------------------------------------------------
// لماذا وسيط بدل توجيه آبل مباشرةً إلى *.functions.supabase.co؟
//
//  1) webServiceURL يُخبز داخل كل بطاقة صادرة ولا يمكن تغييره بعدها. توجيهه إلى
//     نطاقنا يعني أن تبديل الخلفية لاحقاً لا يُبطل بطاقات في جيوب العملاء.
//  2) هوية النطاق: العميل يرى marma.help لا رابطاً غامضاً.
//  3) طبقة تحكّم على الحافة: نمرّر رؤوس التخزين المؤقت (If-Modified-Since /
//     Last-Modified / 304) التي تعتمد عليها آبل لتقليل الطلبات.
//
// شفّاف عمداً: لا يفسّر المسار ولا يتحقّق من شيء — كل المنطق في Edge Function
// حيث الأسرار. وظيفته نقل الطلب والرد كما هما. الاستثناء الوحيد أول جزء من
// المسار: google/* تذهب إلى دالة جوجل وما عداها إلى خدمة PassKit.

const FORWARD_REQ = ['authorization', 'content-type', 'if-modified-since', 'user-agent'];
const FORWARD_RES = ['content-type', 'content-disposition', 'last-modified', 'cache-control', 'location'];

export async function onRequest(context) {
  const { request, env, params } = context;

  const base = env.SUPABASE_URL;
  if (!base) return new Response('wallet service unavailable', { status: 503 });

  // params.path مصفوفة الأجزاء بعد /api/wallet
  const segs = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const isGoogle = segs[0] === 'google';
  const fn = isGoogle ? 'wallet-google' : 'wallet-apple';
  const tail = (isGoogle ? segs.slice(1) : segs).join('/');
  const src = new URL(request.url);
  const target = `${base}/functions/v1/${fn}/${tail}${src.search}`;

  const headers = new Headers();
  for (const h of FORWARD_REQ) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  // Supabase يشترط apikey على كل نداء لدوال الحافة، حتى مع verify_jwt = false
  if (env.SUPABASE_KEY) headers.set('apikey', env.SUPABASE_KEY);

  let upstream;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      // redirect يدوي: مسار جوجل يردّ 302 إلى pay.google.com، والاتّباع التلقائي
      // كان سيجلب صفحة جوجل ويقدّمها من نطاقنا بدل تحويل المتصفّح إليها.
      redirect: 'manual',
    });
  } catch (_) {
    return new Response('wallet service unreachable', { status: 502 });
  }

  const out = new Headers();
  for (const h of FORWARD_RES) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  // 204/304 لا يحملان جسماً — إرجاع جسم معهما يكسر عميل PassKit
  const bodyless = upstream.status === 204 || upstream.status === 304;
  return new Response(bodyless ? null : upstream.body, {
    status: upstream.status,
    headers: out,
  });
}
