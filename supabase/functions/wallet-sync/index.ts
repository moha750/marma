// مزامنة بطاقات المحافظ — تُخطر جهاز العميل أن بطاقته تغيّرت.
// ----------------------------------------------------------------------------
// آبل لا تُرسل المحتوى في الإشعار: تُرسل نبضة فارغة، فيستدعي الجهاز
// GET /v1/passes/{ptid}/{serial} ويجلب النسخة الجديدة بنفسه. لذلك لا حاجة
// لتضمين الرصيد هنا — يكفي أن نقول «تغيّرت».
//
// المصادقة بالتوكن (‎.p8/ES256) لا بالشهادة: الشهادة تفرض mTLS وهو غير متاح
// في Deno، والتوكن يعمل بـ fetch عادي. الموضوع (apns-topic) هو معرّف الـ Pass
// لا معرّف تطبيق — لا يوجد تطبيق أصلاً.
//
// الاستدعاء بصورتين:
//   POST {card_id}  ← من التريجر عبر pg_net، فور تغيّر الرصيد
//   POST {drain:true} ← من cron كل ٥ دقائق، شبكة أمان لما فشل
//
// الأسرار: APPLE_APNS_KEY_P8، APPLE_APNS_KEY_ID، APPLE_TEAM_ID،
//          APPLE_PASS_TYPE_ID، INTERNAL_HOOK_SECRET

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apnsConfigured, apnsToken } from "../_shared/apns.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const TOPIC = Deno.env.get("APPLE_PASS_TYPE_ID") ?? "pass.help.marma.loyalty";
const HOOK_SECRET = Deno.env.get("INTERNAL_HOOK_SECRET") ?? "";
const APNS_HOST = "https://api.push.apple.com";

const MAX_ATTEMPTS = 5;

// توكن APNs يأتي من الوحدة المشتركة _shared/apns.ts — استُخرج من هنا ليخدم
// إشعارات التطبيق أيضاً بالمفتاح نفسه (المفتاح مربوط بالفريق لا بتطبيق واحد،
// ويتغيّر الموضوع apns-topic فقط). نسختان من توقيع ES256 تعني عيباً يُصلَح في
// واحدة ويبقى في الأخرى.

// ─── إرسال النبضة ────────────────────────────────────────────────────────

interface PushResult { sent: number; gone: number; failed: number; lastError?: string }

async function pushCard(cardId: string): Promise<PushResult> {
  const out: PushResult = { sent: 0, gone: 0, failed: 0 };

  const { data: regs } = await db
    .from("wallet_apple_registrations")
    .select("id, push_token")
    .eq("card_id", cardId);

  if (!regs || !regs.length) return out;   // لم يُضِف أحد البطاقة بعد — ليس خطأ

  const jwt = await apnsToken();

  for (const reg of regs) {
    try {
      const res = await fetch(`${APNS_HOST}/3/device/${reg.push_token}`, {
        method: "POST",
        headers: {
          authorization: `bearer ${jwt}`,
          "apns-topic": TOPIC,
          "apns-push-type": "background",
          "apns-priority": "5",
          "content-type": "application/json",
        },
        body: "{}",   // حمولة فارغة: الجهاز يسحب المحتوى بنفسه
      });

      if (res.status === 200) {
        out.sent++;
      } else if (res.status === 410) {
        // الجهاز لم يعد مسجّلاً — نظّف بدل إعادة المحاولة إلى الأبد
        await db.from("wallet_apple_registrations").delete().eq("id", reg.id);
        out.gone++;
      } else {
        out.failed++;
        out.lastError = `${res.status} ${(await res.text()).slice(0, 200)}`;
      }
    } catch (err) {
      out.failed++;
      out.lastError = String(err).slice(0, 200);
    }
  }
  return out;
}

// ─── تصريف الطابور ───────────────────────────────────────────────────────

async function drain(cardId?: string): Promise<Record<string, number>> {
  let q = db.from("wallet_sync_queue")
    .select("id, card_id, target, attempts")
    .is("done_at", null)
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at")
    .limit(200);
  if (cardId) q = q.eq("card_id", cardId);

  const { data: rows } = await q;
  if (!rows || !rows.length) return { rows: 0, sent: 0 };

  let sent = 0, failed = 0, skipped = 0;

  // بطاقة واحدة قد تحمل صفّي apple و google — نجمع لنرسل مرة واحدة لكل هدف
  const apple = rows.filter((r) => r.target === "apple");
  const google = rows.filter((r) => r.target === "google");

  for (const row of apple) {
    const res = await pushCard(row.card_id);
    sent += res.sent;
    if (res.failed > 0) {
      failed++;
      await db.from("wallet_sync_queue")
        .update({ attempts: row.attempts + 1, last_error: res.lastError ?? null })
        .eq("id", row.id);
    } else {
      await db.from("wallet_sync_queue")
        .update({ done_at: new Date().toISOString(), last_error: null })
        .eq("id", row.id);
      await db.from("loyalty_cards")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", row.card_id);
    }
  }

  // جوجل معلّقة على اعتماد حساب المُصدِر. نُعلّم الصفوف منجَزة بملاحظة صريحة
  // كي لا يتضخّم الطابور ويُخفي أعطالاً حقيقية في مسار آبل.
  if (google.length) {
    skipped = google.length;
    await db.from("wallet_sync_queue")
      .update({ done_at: new Date().toISOString(), last_error: "google: pending issuer approval" })
      .in("id", google.map((r) => r.id));
  }

  return { rows: rows.length, sent, failed, skipped };
}

// ─── المدخل ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // نداء داخلي فقط: من التريجر عبر pg_net أو من cron
  const auth = req.headers.get("authorization") ?? "";
  if (!HOOK_SECRET || auth !== `Bearer ${HOOK_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!apnsConfigured()) {
    console.error("wallet-sync: APNs secrets missing");
    return Response.json({ error: "apns_not_configured" }, { status: 503 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const result = await drain(body.card_id ? String(body.card_id) : undefined);
    return Response.json(result);
  } catch (err) {
    console.error("wallet-sync error:", err);
    return Response.json({ error: String(err).slice(0, 300) }, { status: 500 });
  }
});
