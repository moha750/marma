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
 * الشكل الصارم قبل أي استعلام (§11.3): ٢٤ خانة سداسية عشرية ثم توقيع مطابق.
 * فحص الشكل أولاً يقطع الفحص العشوائي قبل أن يلمس أي طلبٍ قاعدةَ البيانات.
 */
export async function verifyLinkSig(serial: string, sig: string): Promise<boolean> {
  if (!/^[0-9a-f]{24}$/.test(serial)) return false;
  return safeEqual(sig, await linkSig(serial));
}

/** يفصل «serial.sig» — الرابط الواحد يخدم الصفحة وزرَّي المحفظتين */
export function splitPayload(payload: string): [string, string] {
  const [serial, sig] = String(payload ?? "").replace(/\.pkpass$/, "").split(".");
  return [serial ?? "", sig ?? ""];
}

export type PayloadCheck =
  | { ok: true; serial: string }
  | { ok: false; status: 400 | 403 };

/**
 * التوقيع اختياري عمداً.
 *
 * الرابط الذي يصل العميل في واتساب يحمل الرقم التسلسلي وحده (cards.js) — لا
 * توقيع معه، لأن الواجهة لا تملك QR_SECRET ولا يجوز أن تملكه. والتوقيع يبقى
 * مخبوزاً في webServiceURL داخل البطاقات الصادرة، فيصل في نداءات PassKit.
 *
 * ولا خسارة أمنية: الحارس الفعلي ٢٤ خانة سداسية عشرية = ٩٦ بت عشوائية، وهو
 * نفسه ما تكتفي به loyalty_public_card التي تعرض بيانات البطاقة كاملة. فإن
 * جاء توقيع تحقّقنا منه (فلا يمرّ رابط مزوَّر بتوقيع خاطئ)، وإن غاب اكتفينا
 * بالشكل الصارم.
 */
export async function checkPayload(payload: string): Promise<PayloadCheck> {
  const [serial, sig] = splitPayload(payload);
  if (!/^[0-9a-f]{24}$/.test(serial)) return { ok: false, status: 400 };
  if (sig && !await verifyLinkSig(serial, sig)) return { ok: false, status: 403 };
  return { ok: true, serial };
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

/**
 * آخر حركة على البطاقة — بها وحدها تعرف طبقةُ المحفظة **ماذا** تقول للعميل
 * و**هل** تقول شيئاً أصلاً. الحالةُ في قاعدتنا رصيدٌ مجرّد لا يحمل قصّته،
 * فنسأل الدفتر عن آخر سطرٍ حرّكه.
 *
 * وتُقرأ الحركة بإشارتها لا بسببها وحده، لأن الرصيد ينقص في أربع حالات كلّها
 * لا تُشكر عليها: تصحيح المالك، سحبُ ختمٍ عند إلغاء الحجز، انتهاء الصلاحية،
 * وإصدارُ القسيمة عند العتبة (يخصم العتبة كاملةً فيعود الرصيد صفراً). ولو
 * نظرنا إلى آخر حركةٍ **موجبة** كما كنا نفعل، لصمتت هذه الأربع في الدفتر
 * وصرخت في جوال العميل بنصّ «تم زيادة رصيدك» — وأسوأها بلوغُ العتبة: يُخبَر
 * بأن رصيده زاد إلى صفر في اللحظة التي استحقّ فيها مكافأته.
 */
export interface LastTx { reason: string; delta: number }

export async function lastTx(
  db: SupabaseClient,
  cardId: string,
): Promise<LastTx | null> {
  const { data } = await db
    .from("loyalty_transactions")
    .select("reason, delta")
    .eq("card_id", cardId)
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  if (!data) return null;
  const row = data as { reason: string; delta: number | string };
  return { reason: row.reason, delta: Number(row.delta) };
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
