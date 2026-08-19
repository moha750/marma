// Google Wallet — مصادقة حساب الخدمة، واجهة walletobjects، ورابط «أضف للمحفظة».
// ----------------------------------------------------------------------------
// لا شيء هنا يمرّ عبر Play Console: بطاقات المحفظة تُصدَر بحساب مُصدِر (Issuer)
// معتمَد + حساب خدمة، ولا علاقة لها بتطبيق أندرويد ولا برسوم مطوّر.
//
// المصادقة نفس نمط _shared/fcm.ts حرفياً: JWT موقّع RS256 بمفتاح حساب الخدمة →
// توكن OAuth. الفرق الوحيد هو النطاق (scope). ونوقّع بـ WebCrypto لا بمكتبة:
// التبعية الوحيدة في هذا المسار هي ما يمنع تحديثاً خارجياً من تعطيل الإنتاج.
//
// نموذج المزامنة يختلف عن آبل جذرياً: لا نبضة ولا سحب — نكتب حالة البطاقة
// على خادم جوجل (PUT) فتظهر على جهاز العميل من نفسها. §6.4
//
// والإشعار جزء من نفس الكتابة لا قناة ثانية: messages[] بـ TEXT_AND_NOTIFY
// داخل الكائن. جوجل تُميّزها بـ id فلا تُعيد الرنين على id رأته.
//
// الأسرار: GOOGLE_SA_JSON (ملف حساب الخدمة كاملاً) · GOOGLE_ISSUER_ID
//   • حساب الخدمة يجب أن يُضاف في Wallet Console → Users بصلاحية Developer،
//     وإلا ردّت كل النداءات 403 بلا سبب ظاهر.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { availableReward, type CardRow, lastTx, linkSig, SITE } from "./loyalty-card.ts";

const ISSUER = Deno.env.get("GOOGLE_ISSUER_ID") ?? "";
const API = "https://walletobjects.googleapis.com/walletobjects/v1";
const SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";

// جوجل تشترط programLogo في كل Class. الملعب بلا شعار لا يجوز أن تُحجب بطاقته،
// فنسقط إلى شعار الملعب ثم إلى شعار مَرمى — ملفٌ ثابت في assets/ يُنشر مع الموقع.
const DEFAULT_LOGO = `${SITE}/assets/wallet/marma-logo.png`;

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function serviceAccount(): ServiceAccount | null {
  const raw = Deno.env.get("GOOGLE_SA_JSON");
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    if (!sa.client_email || !sa.private_key) return null;
    return sa;
  } catch {
    console.error("[gwallet] GOOGLE_SA_JSON ليس JSON صالحاً");
    return null;
  }
}

export function googleWalletConfigured(): boolean {
  return !!(ISSUER && serviceAccount());
}

// معرّفات جوجل: بادئة المُصدِر إجبارية، وما بعدها حرّ ضمن [A-Za-z0-9._-].
// معرّف الملعب UUID بشرطات، والرقم التسلسلي ٢٤ خانة hex — كلاهما ضمن المسموح.
export const classIdFor = (tenantId: string) => `${ISSUER}.marma-${tenantId}`;
export const objectIdFor = (serial: string) => `${ISSUER}.${serial}`;

// ─── التوقيع والتوكن ─────────────────────────────────────────────────────

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

async function signRs256(sa: ServiceAccount, claims: Record<string, unknown>): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key) as BufferSource,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const header = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64urlStr(JSON.stringify(claims));
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}

// توكن OAuth صالح ساعة — نحتفظ به على مستوى الوحدة كما في fcm.ts و apns.ts،
// فتحديث بطاقةٍ واحدة لا يجوز أن يُكلّف رحلتَي شبكة إلى جوجل.
let cachedOAuth: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string | null> {
  const sa = serviceAccount();
  if (!sa) return null;

  const now = Math.floor(Date.now() / 1000);
  if (cachedOAuth && cachedOAuth.exp > now + 60) return cachedOAuth.token;

  try {
    const jwt = await signRs256(sa, {
      iss: sa.client_email,
      scope: SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    });

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });
    if (!res.ok) {
      console.error("[gwallet] فشل توكن OAuth:", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const data = await res.json() as { access_token: string; expires_in: number };
    cachedOAuth = { token: data.access_token, exp: now + (data.expires_in ?? 3600) - 60 };
    return cachedOAuth.token;
  } catch (err) {
    console.error("[gwallet] فشل توليد التوكن:", err);
    return null;
  }
}

// ─── واجهة walletobjects ─────────────────────────────────────────────────

interface ApiResult { status: number; ok: boolean; body: string }

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<ApiResult> {
  const token = await accessToken();
  if (!token) return { status: 0, ok: false, body: "no oauth token" };
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text().catch(() => "");
    return { status: res.status, ok: res.ok, body: text.slice(0, 400) };
  } catch (err) {
    return { status: 0, ok: false, body: String(err).slice(0, 200) };
  }
}

/**
 * تحديث ثم إنشاء عند ٤٠٤. نبدأ بالتحديث لأن الحالة الغالبة «موجود»، ولأن POST
 * على معرّف موجود يردّ ٤٠٩ فنحتاج مساراً ثانياً في الاتجاهين على أي حال.
 *
 * @param insertOnly حقول تُرسَل عند الإنشاء وحده. مثالها reviewStatus: جوجل
 *        تنقل الفئة من UNDER_REVIEW إلى APPROVED بنفسها، وإعادة إرسال الحالة
 *        القديمة في كل تحديث محاولةُ تراجعٍ عن انتقالٍ لا يُتراجع عنه.
 */
async function upsert(
  resource: "loyaltyClass" | "loyaltyObject",
  id: string,
  payload: Record<string, unknown>,
  updateMethod: "PATCH" | "PUT",
  insertOnly: Record<string, unknown> = {},
): Promise<ApiResult> {
  const updated = await api(updateMethod, `/${resource}/${encodeURIComponent(id)}`, payload);
  if (updated.status !== 404) return updated;
  return await api("POST", `/${resource}`, { ...payload, ...insertOnly });
}

// ─── حمولات الفئة والكائن ────────────────────────────────────────────────

function classPayload(card: CardRow, classId: string): Record<string, unknown> {
  const prog = (card.loyalty_programs ?? {}) as Record<string, string | number | null>;
  const tenantName = card.tenants?.name ?? "ملعبك";
  const logo = String(prog.logo_url ?? "") || card.tenants?.logo_url || DEFAULT_LOGO;
  const hero = String(prog.hero_url ?? "");

  return {
    id: classId,
    // نفس صيغة organizationName في بطاقة آبل — «بواسطة مَرمى» تظهر في كل إشعار
    issuerName: `${tenantName} — بواسطة مَرمى`,
    programName: String(prog.name ?? "بطاقة الولاء"),
    programLogo: { sourceUri: { uri: logo } },
    hexBackgroundColor: String(prog.brand_bg ?? "#0F3D2E"),
    ...(hero ? { heroImage: { sourceUri: { uri: hero } } } : {}),
    countryCode: "SA",
    // مقابل sharingProhibited في آبل: بطاقة العميل على أجهزته هو لا على غيره
    multipleDevicesAndHoldersAllowedStatus: "ONE_USER_ALL_DEVICES",
    linksModuleData: {
      uris: [{ uri: `${SITE}/book?t=${card.tenant_id}`, description: "احجز الآن", id: "book" }],
    },
  };
}

/**
 * @param notify يُضيف messages بـ TEXT_AND_NOTIFY فيرنّ جوال العميل. جوجل
 *        تُميّز الرسائل بـ id: نفس الـ id لا يُعيد الرنين مهما تكرّر الـ PUT،
 *        و id جديد يرنّ مرة واحدة. فنشتقّ الـ id من الحالة نفسها (الرصيد،
 *        رمز القسيمة) فتصير المزامنة الدورية صامتة والتغيّر الحقيقي وحده
 *        هو ما يُشعِر. ويُطفأ عند الحفظ الأول: من أضاف بطاقته للتوّ لا يُشكر
 *        على حضورٍ لم يحدث.
 */
async function objectPayload(
  db: SupabaseClient,
  card: CardRow,
  classId: string,
  objectId: string,
  reward: { code: string; label: string } | null,
  notify: boolean,
): Promise<Record<string, unknown>> {
  const prog = (card.loyalty_programs ?? {}) as Record<string, string | number | boolean | null>;
  const threshold = Number(prog.reward_threshold ?? 10);
  const balance = Math.max(0, Math.round(Number(card.balance ?? 0)));
  const sig = await linkSig(card.serial);

  const text: Record<string, string>[] = [{
    id: "reward",
    header: reward ? "مكافأة جاهزة" : "المكافأة",
    body: reward
      ? `${reward.label} — رمز ${reward.code}`
      : `${String(prog.reward_label ?? "مكافأة")} — باقي ${Math.max(0, threshold - balance)} حجوزات`,
  }];
  if (prog.redeem_pin_enabled && card.redeem_pin) {
    text.push({ id: "pin", header: "رمز الاستبدال", body: card.redeem_pin });
  }
  if (prog.reward_terms) {
    text.push({ id: "terms", header: "شروط البرنامج", body: String(prog.reward_terms) });
  }

  const messages: Record<string, string>[] = [];
  const last = notify ? await lastTx(db, card.id) : null;
  const earned = !!last && last.delta > 0;
  if (notify) {
    // رسالة الرصيد لا تُرسَل إلا مع زيادة: النقص (تصحيح، سحب، انتهاء، إصدار
    // قسيمة) يُكتب في البطاقة ولا يُرنّ. والـ id يحمل السبب مع الرصيد — هدية
    // ثم ختمٌ عند الرصيد نفسه حدثان لا واحد.
    const gifted = earned && last.reason === "gift";
    if (earned) {
      messages.push({
        id: `${gifted ? "gift" : "bal"}-${balance}`,
        header: gifted ? "🎁 هدية من الملعب" : "شكراً على حضورك ⚽️",
        body: gifted
          ? `أهداك الملعب أختاماً — رصيدك الآن ${balance} / ${threshold}`
          : `تم زيادة رصيدك — ${balance} / ${threshold}`,
        messageType: "TEXT_AND_NOTIFY",
      });
    }
    // المكافأة تُعلَن دائماً ولو نقص الرصيد — بل **خاصّةً** حينها: إصدار
    // القسيمة هو نفسه ما خصم العتبة وأعاد الرصيد صفراً.
    if (reward) {
      messages.push({
        id: `reward-${reward.code}`,
        header: "🎁 مكافأتك جاهزة",
        body: `${reward.label} — رمز ${reward.code}`,
        messageType: "TEXT_AND_NOTIFY",
      });
    }
  }

  return {
    id: objectId,
    classId,
    // البطاقة الموقوفة أو التي أُلغي اشتراكها تُطفأ ولا تُحذف (§11.4)
    state: card.status === "active" ? "ACTIVE" : "EXPIRED",
    accountId: card.serial,
    accountName: card.customers?.full_name ?? "عضو",
    loyaltyPoints: { label: "الأختام", balance: { string: `${balance} / ${threshold}` } },
    ...(reward
      ? { secondaryLoyaltyPoints: { label: "مكافأة جاهزة", balance: { string: reward.code } } }
      : {}),
    barcode: {
      type: "QR_CODE",
      value: `MRM1:${card.serial}:${sig}`,
      alternateText: card.serial.substring(0, 8),
    },
    textModulesData: text,
    ...(messages.length ? { messages } : {}),
    linksModuleData: {
      uris: [{
        uri: `${SITE}/card?c=${card.serial}.${sig}#out`,
        description: "إلغاء الاشتراك",
        id: "optout",
      }],
    },
  };
}

// ─── المزامنة ────────────────────────────────────────────────────────────

export interface GoogleSyncResult {
  ok: boolean;
  /** true إن كان هناك كائن فعلي على جوجل بعد هذه العملية */
  synced: boolean;
  classId?: string;
  objectId?: string;
  error?: string;
}

/**
 * يضمن أن فئة الملعب وكائن العميل على جوجل يطابقان حالة قاعدتنا.
 *
 * @param create إن كان false لم يُنشئ كائناً غير موجود. بطاقةٌ لم يحفظها صاحبها
 *               في محفظته لا يجوز أن نخلق لها كائناً من طرفنا: المزامنة تُحدّث
 *               ما حفظه العميل فقط، والإنشاء يقع عند ضغطه زرّ «أضف للمحفظة».
 */
export async function syncGoogleCard(
  db: SupabaseClient,
  card: CardRow,
  opts: { create: boolean },
): Promise<GoogleSyncResult> {
  if (!googleWalletConfigured()) {
    return { ok: false, synced: false, error: "google wallet not configured" };
  }

  const prog = (card.loyalty_programs ?? {}) as Record<string, string | null>;
  const classId = classIdFor(card.tenant_id);
  const objectId = card.google_object_id || objectIdFor(card.serial);

  if (!opts.create && !card.google_object_id) {
    return { ok: true, synced: false };   // لم يحفظها أحد بعد — ليس خطأً
  }

  // ── الفئة: تُحدَّث فقط إن تغيّرت هوية البرنامج منذ آخر مزامنة ──
  // المقارنة بـ updated_at بدل تريجر أو طابور ثالث: loyalty_upsert_program يرفع
  // updated_at عند كل حفظ، فالمقارنة وحدها تجعل المسار مُصلِحاً لنفسه.
  const syncedAt = prog.google_synced_at ? Date.parse(prog.google_synced_at) : 0;
  const updatedAt = prog.updated_at ? Date.parse(prog.updated_at) : Date.now();
  // النفي حول المقارنة مقصود: تاريخ غير صالح ⇒ NaN ⇒ كل مقارنة false ⇒ نُزامن.
  // الميل عند الشك إلى المزامنة، لا إلى فئةٍ قديمة تُعرض في جيب العميل.
  const classFresh = !!prog.google_class_id && syncedAt >= updatedAt;
  if (!classFresh) {
    const res = await upsert(
      "loyaltyClass",
      classId,
      classPayload(card, classId),
      "PATCH",
      // UNDER_REVIEW هي حالة النشر: الفئة في DRAFT لا تقبل ربط كائنات بها،
      // ومُصدِرٌ معتمَد لا ينتظر مراجعةً لكل فئة (حُسم Spike B — §6.4).
      { reviewStatus: "UNDER_REVIEW" },
    );
    if (res.ok) {
      await db.from("loyalty_programs")
        .update({ google_class_id: classId, google_synced_at: new Date().toISOString() })
        .eq("id", String(prog.id));
    } else if (!prog.google_class_id) {
      // لا فئة أصلاً ⇒ لا مكان للكائن. هنا وحده يكون الفشل قاتلاً.
      return { ok: false, synced: false, error: `class ${res.status}: ${res.body}` };
    } else {
      // فئة قائمة تعذّر تحديث هويتها: شعارٌ قديم أهون بكثير من رصيدٍ متجمّد،
      // فنُكمل إلى الكائن ونترك الختم الزمني قديماً لتُعاد المحاولة تلقائياً.
      console.error("[gwallet] تعذّر تحديث الفئة:", res.status, res.body);
    }
  }

  // ── الكائن: نرسل الحالة كاملةً (PUT) لا دمجاً (PATCH) ──
  // صرف قسيمة يعني حذف secondaryLoyaltyPoints، والدمج لا يحذف حقلاً غائباً —
  // فتبقى «مكافأة جاهزة» معروضة على بطاقة في جيب عميلٍ صرفها فعلاً.
  const reward = await availableReward(db, card.id);
  const payload = await objectPayload(db, card, classId, objectId, reward, !opts.create);

  const res = opts.create
    ? await upsert("loyaltyObject", objectId, payload, "PUT")
    : await api("PUT", `/loyaltyObject/${encodeURIComponent(objectId)}`, payload);

  // الكائن اختفى من طرف جوجل (حذفه العميل مثلاً) — لا شيء نزامنه، وليس عطلاً
  if (!res.ok && res.status === 404 && !opts.create) {
    return { ok: true, synced: false };
  }
  if (!res.ok) {
    return { ok: false, synced: false, error: `object ${res.status}: ${res.body}` };
  }

  if (card.google_object_id !== objectId) {
    await db.from("loyalty_cards").update({ google_object_id: objectId }).eq("id", card.id);
  }

  return { ok: true, synced: true, classId, objectId };
}

/**
 * رابط «أضف إلى Google Wallet». الكائن يُنشأ عبر REST أولاً ولا يحمل الـ JWT إلا
 * مرجعه (id + classId) — فالرابط يبقى قصيراً، والحالة تبقى ملكنا قابلةً للتحديث.
 */
export async function saveUrl(objectId: string, classId: string): Promise<string | null> {
  const sa = serviceAccount();
  if (!sa) return null;
  const jwt = await signRs256(sa, {
    iss: sa.client_email,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    origins: [SITE],
    payload: { loyaltyObjects: [{ id: objectId, classId }] },
  });
  return `https://pay.google.com/gp/v/save/${jwt}`;
}
