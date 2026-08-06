// إرسال إشعارات FCM HTTP v1 (أندرويد).
// ----------------------------------------------------------------------------
// أندرويد لا يقبل إشعارات إلا عبر FCM، وهذا يعني مشروع Firebase. (أبل لا تحتاجه:
// نُرسل إلى APNs مباشرةً بمفتاحك — انظر _shared/apns.ts.)
//
// نستخدم HTTP v1 لا الواجهة القديمة (legacy server key): أوقفتها قوقل، وأي كود
// يعتمدها اليوم يعمل حتى تُغلق البوابة ثم يصمت بلا تفسير.
//
// المصادقة: حساب خدمة (service account) → JWT موقّع بـ RS256 → توكن OAuth.
// نوقّع الـ JWT هنا بـ WebCrypto بدل مكتبة جاهزة: التبعية الوحيدة في هذا المسار
// هي ما يمنع تحديثاً في حزمةٍ خارجية من تعطيل إشعارات الإنتاج.
//
// السرّ المطلوب: FCM_SERVICE_ACCOUNT — محتوى ملف JSON لحساب الخدمة كاملاً.
//   Firebase Console → Project settings → Service accounts → Generate new private key

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

function serviceAccount(): ServiceAccount | null {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT");
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    if (!sa.client_email || !sa.private_key || !sa.project_id) return null;
    return sa;
  } catch {
    console.error("[fcm] FCM_SERVICE_ACCOUNT ليس JSON صالحاً");
    return null;
  }
}

export function fcmConfigured(): boolean {
  return serviceAccount() !== null;
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const b64urlStr = (s: string) => b64url(new TextEncoder().encode(s));

function pemToPkcs8(pem: string): Uint8Array {
  // مفتاح حساب الخدمة يأتي بأسطر \n مُهرَّبة داخل الـ JSON
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----[^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// توكن OAuth صالح ساعة — نخزّنه على مستوى الوحدة كما في APNs، فإشعارٌ واحد
// لا يجوز أن يُكلّف رحلتَي شبكة إلى قوقل.
let cachedOAuth: { token: string; exp: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedOAuth && cachedOAuth.exp > now + 60) return cachedOAuth.token;

  try {
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pemToPkcs8(sa.private_key) as BufferSource,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const header = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64urlStr(JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }));
    const sig = await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      new TextEncoder().encode(`${header}.${claims}`),
    );
    const jwt = `${header}.${claims}.${b64url(new Uint8Array(sig))}`;

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });
    if (!res.ok) {
      console.error("[fcm] فشل توكن OAuth:", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const data = await res.json() as { access_token: string; expires_in: number };
    cachedOAuth = { token: data.access_token, exp: now + (data.expires_in ?? 3600) - 60 };
    return cachedOAuth.token;
  } catch (err) {
    console.error("[fcm] فشل توليد التوكن:", err);
    return null;
  }
}

export interface FcmSendResult {
  status: number;
  /** الرمز لم يعد صالحاً — يُحذف الصفّ بدل إعادة المحاولة إلى الأبد */
  gone: boolean;
  error?: string;
}

export interface FcmAlert {
  title: string;
  body: string;
  /** إشعارات الحجز الواحد تُجمَّع بنفس الوسم فيستبدل الجديد القديم */
  tag?: string;
  url?: string;
}

/** يفتح جلسة إرسال: يجلب توكن OAuth مرّة واحدة لكل دفعة إشعارات. */
export async function fcmSession(): Promise<
  { send: (token: string, alert: FcmAlert) => Promise<FcmSendResult> } | null
> {
  const sa = serviceAccount();
  if (!sa) return null;
  const oauth = await accessToken(sa);
  if (!oauth) return null;

  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

  return {
    async send(deviceToken: string, alert: FcmAlert): Promise<FcmSendResult> {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${oauth}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: deviceToken,
              notification: { title: alert.title, body: alert.body },
              android: {
                priority: "HIGH",
                ttl: "3600s",   // إشعار حجزٍ متأخّرٌ يوماً لا قيمة له
                notification: {
                  ...(alert.tag ? { tag: alert.tag } : {}),
                  sound: "default",
                  // الأيقونة ظلّية بيضاء يولّدها scripts/generate-app-assets.mjs
                  // في android/…/res/drawable-*/. أندرويد يرسم قناة الشفافية
                  // وحدها مصبوغةً باللون أدناه — فأي أيقونة ملوّنة = مربّع أبيض.
                  icon: "ic_stat_notify",
                  color: "#0F9D58",
                },
              },
              // بيانات نقرأها في التطبيق عند النقر للانتقال للصفحة الصحيحة
              data: alert.url ? { url: alert.url } : {},
            },
          }),
        });

        if (res.ok) return { status: res.status, gone: false };

        const text = await res.text().catch(() => "");
        // UNREGISTERED / INVALID_ARGUMENT على الرمز = جهاز ميت
        const gone = res.status === 404 ||
          /UNREGISTERED|NOT_FOUND/i.test(text) ||
          (res.status === 400 && /registration token|invalid.*token/i.test(text));
        return { status: res.status, gone, error: text.slice(0, 200) };
      } catch (err) {
        return { status: 0, gone: false, error: String(err).slice(0, 200) };
      }
    },
  };
}
