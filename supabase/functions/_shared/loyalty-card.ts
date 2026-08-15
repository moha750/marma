// بطاقة الولاء — التواقيع وقراءة الصفّ، مشتركةً بين دوال المحافظ الثلاث.
// ----------------------------------------------------------------------------
// استُخرجت من wallet-apple عند إضافة طبقة Google Wallet: نفس البطاقة تُقرأ الآن
// في ثلاثة مواضع (إصدار آبل، إصدار جوجل، المزامنة). نسخة ثالثة من الاستعلام
// ومن دوال التوقيع تعني عيباً يُصلَح في واحدة ويبقى في اثنتين — وهو نفس السبب
// الذي استُخرج لأجله _shared/apns.ts.
//
// نموذج المصادقة كما هو: لا توكن مُخزَّن في أي مكان، كل توقيع مُشتقّ حسابياً.
//   linkSig(serial)            → توقيع رابط البطاقة ومحتوى الـ QR   (QR_SECRET)
//   authToken(serial, version) → authenticationToken لآبل           (WALLET_AUTH_SECRET)

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SITE = Deno.env.get("PUBLIC_SITE_URL") ?? "https://marma.help";

// ─── التواقيع ────────────────────────────────────────────────────────────

async function hmac(secretName: string, message: string): Promise<string> {
  const secret = Deno.env.get(secretName) ?? "";
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const linkSig = (serial: string) => hmac("QR_SECRET", serial);
export const authToken = (serial: string, version: number) =>
  hmac("WALLET_AUTH_SECRET", `${serial}:${version}`);

/** مقارنة ثابتة الزمن — المقارنة العادية تُسرّب طول البادئة الصحيحة */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * بوّابة زرَّي المحفظة: تقبل الحمولة بصورتيها «serial» و «serial.sig».
 *
 * الشكل الصارم قبل أي استعلام (§11.3): ٢٤ خانة سداسية عشرية — فحص الشكل أولاً
 * يقطع الفحص العشوائي قبل أن يلمس أي طلبٍ قاعدةَ البيانات.
 *
 * التوقيع لا يولده إلا الخادم (QR_SECRET)، ولا يظهر إلا داخل بطاقةٍ صادرة —
 * في ظهر بطاقة آبل وفي الـ QR. أما الروابط التي تصل العميل فعلاً (مشاركة
 * الواتساب من اللوحة، وبطاقته في موقع الحجز) فتحمل الرقم التسلسلي وحده،
 * فكان اشتراط التوقيع يردّ كل ضغطةٍ على «إضافة إلى المحفظة» بـ 400.
 *
 * فنقبل الرقم وحده — وهو نفس ما تقبله loyalty_public_card وللسبب نفسه: ٢٤
 * خانة سداسية عشرية = ٩٦ بت عشوائية، هي الحارس لا التوقيع. ونُبقي التحقّق
 * صارماً متى حضر التوقيع، فالروابط المخبوزة في البطاقات القديمة تظلّ تُفحَص.
 *
 * يُعيد: ok للقبول، أو reason لسبب الردّ.
 */
export async function acceptCardPayload(
  serial: string,
  sig: string,
): Promise<{ ok: true } | { ok: false; reason: "bad" | "forbidden" }> {
  if (!/^[0-9a-f]{24}$/.test(serial)) return { ok: false, reason: "bad" };
  if (!sig) return { ok: true };
  return safeEqual(sig, await linkSig(serial))
    ? { ok: true }
    : { ok: false, reason: "forbidden" };
}

/** يفصل «serial.sig» — الرابط الواحد يخدم الصفحة وزرَّي المحفظتين */
export function splitPayload(payload: string): [string, string] {
  const [serial, sig] = String(payload ?? "").replace(/\.pkpass$/, "").split(".");
  return [serial ?? "", sig ?? ""];
}

// ─── قراءة البطاقة ───────────────────────────────────────────────────────

export interface CardRow {
  id: string;
  serial: string;
  balance: number;
  rewards_available: number;
  redeem_pin: string | null;
  status: string;
  token_version: number;
  pass_updated_at: string;
  tenant_id: string;
  google_object_id: string | null;
  customers: { full_name: string } | null;
  loyalty_programs: Record<string, unknown> | null;
  tenants: { name: string; logo_url: string | null } | null;
}

const CARD_SELECT = `id, serial, balance, rewards_available, redeem_pin, status, token_version,
   pass_updated_at, tenant_id, google_object_id,
   customers ( full_name ),
   loyalty_programs ( * ),
   tenants ( name, logo_url )`;

/** بالرقم التسلسلي — ما يصل من رابط العميل ومن خدمة PassKit */
export async function loadCard(
  db: SupabaseClient,
  serial: string,
): Promise<CardRow | null> {
  const { data, error } = await db
    .from("loyalty_cards").select(CARD_SELECT).eq("serial", serial).maybeSingle();
  if (error || !data) return null;
  return data as unknown as CardRow;
}

/** بالمعرّف — ما يصل من طابور المزامنة والتريجرات */
export async function loadCardById(
  db: SupabaseClient,
  cardId: string,
): Promise<CardRow | null> {
  const { data, error } = await db
    .from("loyalty_cards").select(CARD_SELECT).eq("id", cardId).maybeSingle();
  if (error || !data) return null;
  return data as unknown as CardRow;
}

export async function availableReward(
  db: SupabaseClient,
  cardId: string,
): Promise<{ code: string; label: string } | null> {
  const { data } = await db
    .from("loyalty_rewards")
    .select("code, label")
    .eq("card_id", cardId).eq("status", "available")
    .order("issued_at", { ascending: true })
    .limit(1).maybeSingle();
  return (data as { code: string; label: string } | null) ?? null;
}

/** أقرب ١٠ مواقع للملعب — تجعل بطاقة آبل تقترح نفسها على شاشة القفل عند الوصول */
export async function tenantLocations(
  db: SupabaseClient,
  tenantId: string,
  tenantName: string,
) {
  const { data } = await db
    .from("fields")
    .select("latitude, longitude")
    .eq("tenant_id", tenantId).eq("is_active", true)
    .not("latitude", "is", null).not("longitude", "is", null)
    .limit(10);
  return (data ?? []).map((f: { latitude: number; longitude: number }) => ({
    latitude: Number(f.latitude),
    longitude: Number(f.longitude),
    relevantText: `بطاقتك جاهزة — أنت عند ${tenantName}`,
  }));
}
