// Google Wallet — إصدار بطاقة الولاء على أندرويد.
// ----------------------------------------------------------------------------
// المسار الوحيد:
//   GET /wallet-google/save/<serial>.<sig>   →  302 إلى pay.google.com
//
// لماذا مساران فقط لا خمسة كما في آبل؟ لأن جوجل لا تسأل عن البطاقة أبداً: نحن
// نكتب حالتها على خادمها فتظهر على الجهاز. لا تسجيل أجهزة، ولا خدمة ويب،
// ولا إشعارات دفع. كل التحديث في _shared/google-wallet.ts يستدعيه wallet-sync.
//
// الفشل لا يُعرض كصفحة خطأ: نعيد العميل إلى بطاقته مع ?gw=err فيرى ملاحظة
// عربية ويبقى الـ QR في يده عاملاً. بطاقةٌ تعمل خيرٌ من رسالة ٥٠٣.
//
// الأسرار: GOOGLE_SA_JSON · GOOGLE_ISSUER_ID · QR_SECRET
//          PUBLIC_SITE_URL (اختياري، افتراضه https://marma.help)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  checkPayload,
  loadCard,
  SITE,
} from "../_shared/loyalty-card.ts";
import {
  googleWalletConfigured,
  saveUrl,
  syncGoogleCard,
} from "../_shared/google-wallet.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const redirect = (url: string) =>
  new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store" } });

/** العودة إلى صفحة البطاقة برمز سبب — الصفحة تعرض الملاحظة المناسبة */
const backToCard = (payload: string, reason: string) =>
  redirect(`${SITE}/card?c=${encodeURIComponent(payload)}&gw=${reason}`);

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // المسار يصل بثلاث صور حسب المنفذ (نداء مباشر / وسيط Cloudflare / تشغيل محلي)
  // فنرسو على أول جزء يطابق اسم الدالة بدل قصّ بادئة ثابتة — نفس علّة wallet-apple.
  const segs = url.pathname.split("/").filter(Boolean);
  const anchor = segs.findIndex((s) => s === "wallet-google");
  const parts = anchor >= 0 ? segs.slice(anchor + 1) : segs;

  try {
    if (req.method !== "GET" || parts[0] !== "save" || !parts[1]) {
      return new Response("not found", { status: 404 });
    }

    const payload = parts[1];
    const check = await checkPayload(payload);
    if (!check.ok) {
      return new Response(check.status === 403 ? "forbidden" : "bad request", { status: check.status });
    }
    const serial = check.serial;

    if (!googleWalletConfigured()) {
      console.error("[wallet-google] GOOGLE_SA_JSON أو GOOGLE_ISSUER_ID غير مضبوط");
      return backToCard(payload, "off");
    }

    const card = await loadCard(db, serial);
    if (!card) return new Response("not found", { status: 404 });
    if (card.status !== "active") return new Response("gone", { status: 410 });

    const res = await syncGoogleCard(db, card, { create: true });
    if (!res.ok || !res.objectId || !res.classId) {
      console.error("[wallet-google] فشل إنشاء الكائن:", res.error);
      return backToCard(payload, "err");
    }

    const link = await saveUrl(res.objectId, res.classId);
    if (!link) return backToCard(payload, "err");

    return redirect(link);
  } catch (err) {
    console.error("wallet-google error:", err);
    return new Response("internal error", { status: 500 });
  }
});
