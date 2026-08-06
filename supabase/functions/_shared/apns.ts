// إرسال إشعارات APNs بمصادقة التوكن (‎.p8/ES256).
// ----------------------------------------------------------------------------
// هذا الملف استُخرج من wallet-sync حيث كان يعمل في الإنتاج، ليُشارَك بين
// استخدامَين مختلفَين لنفس المفتاح:
//
//   • بطاقات المحفظة  → apns-topic = معرّف الـ Pass Type، حمولة فارغة
//   • تطبيق مَرمى      → apns-topic = معرّف التطبيق (bundle id)، حمولة alert
//
// ولماذا التوكن لا الشهادة: الشهادة تفرض mTLS وهو غير متاح في Deno، والتوكن
// يعمل بـ fetch عادي.
//
// نقطة مهمّة عمليّاً: **المفتاح نفسه يخدم الاثنين**. مفتاح APNs في حساب أبل
// مربوط بالفريق لا بتطبيقٍ واحد، فلا يلزم مفتاحٌ جديد للتطبيق — يتغيّر الموضوع
// (topic) فقط. وهذا يوفّر عليك إعداداً كاملاً.
//
// الأسرار: APPLE_APNS_KEY_P8 · APPLE_APNS_KEY_ID · APPLE_TEAM_ID

const TEAM_ID = Deno.env.get("APPLE_TEAM_ID") ?? "";
const KEY_ID = Deno.env.get("APPLE_APNS_KEY_ID") ?? "";
const P8 = Deno.env.get("APPLE_APNS_KEY_P8") ?? "";

// بيئة الإنتاج. التطبيقات المبنيّة بـ debug (وTestFlight يستخدم الإنتاج) تسجّل
// على sandbox؛ لذا نسمح بتجاوز المضيف عند الاختبار على جهاز تطوير.
const APNS_HOST = Deno.env.get("APNS_HOST") ?? "https://api.push.apple.com";

export function apnsConfigured(): boolean {
  return !!(TEAM_ID && KEY_ID && P8);
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const b64urlStr = (s: string) => b64url(new TextEncoder().encode(s));

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// التوكن صالح ساعة عند أبل، وهي ترفض توليداً أكثر من مرة كل ٢٠ دقيقة.
// نحتفظ به على مستوى الوحدة فيُعاد استخدامه ما دام العزل حياً.
let cached: { token: string; exp: number } | null = null;

export async function apnsToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp > now + 60) return cached.token;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(P8) as BufferSource,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = b64urlStr(JSON.stringify({ alg: "ES256", kid: KEY_ID }));
  const payload = b64urlStr(JSON.stringify({ iss: TEAM_ID, iat: now }));
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  // ES256 في JWT = r‖s خامّين (٦٤ بايت)، وهو ما تُخرجه WebCrypto مباشرةً
  const token = `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
  cached = { token, exp: now + 45 * 60 };
  return token;
}

export interface ApnsAlert {
  title: string;
  body: string;
  /** يُجمَّع الإشعار بنفس المُعرّف فيستبدل السابق بدل تكديس إشعارات لحجزٍ واحد */
  threadId?: string;
  /** يصل إلى التطبيق عند النقر — نستخدمه للانتقال إلى الصفحة الصحيحة */
  url?: string;
}

export interface ApnsSendResult {
  status: number;
  /** 410 = الجهاز لم يعد مسجّلاً؛ الصفّ يجب أن يُحذف لا أن يُعاد إليه */
  gone: boolean;
  error?: string;
}

/**
 * يُرسل إشعاراً مرئياً إلى جهاز واحد.
 * @param deviceToken رمز الجهاز من APNs
 * @param topic معرّف التطبيق (bundle id) — لا معرّف الـ Pass
 */
export async function apnsSendAlert(
  jwt: string,
  deviceToken: string,
  topic: string,
  alert: ApnsAlert,
): Promise<ApnsSendResult> {
  const payload: Record<string, unknown> = {
    aps: {
      alert: { title: alert.title, body: alert.body },
      sound: "default",
      badge: 1,
      // thread-id يجمع إشعارات الحجز الواحد في مجموعة واحدة
      ...(alert.threadId ? { "thread-id": alert.threadId } : {}),
    },
  };
  // بيانات خاصة بنا خارج aps — يقرأها التطبيق عند النقر
  if (alert.url) payload.url = alert.url;

  try {
    const res = await fetch(`${APNS_HOST}/3/device/${deviceToken}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        // انقضاء بعد ساعة: إشعار حجزٍ متأخّرٌ يوماً لا قيمة له
        "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600),
        ...(alert.threadId ? { "apns-collapse-id": alert.threadId.slice(0, 64) } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 200) return { status: 200, gone: false };

    const text = await res.text().catch(() => "");
    return {
      status: res.status,
      gone: res.status === 410,
      error: text.slice(0, 200),
    };
  } catch (err) {
    return { status: 0, gone: false, error: String(err).slice(0, 200) };
  }
}
