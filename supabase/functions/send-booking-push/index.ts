// Edge Function يستقبل booking_id من trigger DB ويُرسل إشعار Web Push
// لكل من اشترك من جوال أو متصفح ضمن نفس الـ tenant.
//
// يُستدعى من tg_notify_new_booking عبر pg_net (بنفس النمط مع send-booking-notification).
//
// المتطلبات في Edge Functions secrets:
//   VAPID_PUBLIC_KEY       — مفتاح VAPID العام
//   VAPID_PRIVATE_KEY      — مفتاح VAPID السرّي
//   VAPID_SUBJECT          — mailto: أو https: (مثلاً mailto:owner@marma.help)
//   INTERNAL_HOOK_SECRET   — سر مشترك للتحقق من أن النداء من قاعدتنا

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { apnsConfigured, apnsSendAlert, apnsToken } from "../_shared/apns.ts";
import { fcmConfigured, fcmSession } from "../_shared/fcm.ts";

// معرّف التطبيق في المتجرين — هو موضوع إشعار APNs (لا معرّف بطاقة المحفظة)
const APP_BUNDLE_ID = Deno.env.get("APP_BUNDLE_ID") ?? "help.marma.app";

interface RequestBody {
  booking_id: string;
  type?: "new" | "reminder" | "cancelled_by_customer";
  reminder_count?: number;
}

const REMINDER_ELAPSED: Record<number, string> = {
  1: "منذ ساعة",
  2: "منذ 6 ساعات",
  3: "منذ 12 ساعة",
  4: "منذ يوم",
};

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh_key: string | null;
  auth_key: string | null;
  /** web = Web Push · ios = رمز APNs · android = رمز FCM */
  platform: "web" | "ios" | "android";
}

function formatArabicDateTime(iso: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("ar-EG", {
    numberingSystem: "latn",
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(d);
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? "م" : "ص";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  const mm = String(m).padStart(2, "0");
  return `${date} · ${h12}:${mm} ${period}`;
}

Deno.serve(async (req) => {
  try {
    // تحقّق من السر المشترك
    const expectedSecret = Deno.env.get("INTERNAL_HOOK_SECRET");
    const authHeader = req.headers.get("authorization") ?? "";
    const provided = authHeader.replace(/^Bearer\s+/i, "");
    if (!expectedSecret || provided !== expectedSecret) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as RequestBody;
    const { booking_id, type = "new", reminder_count = 1 } = body;
    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT");
    if (!vapidPublic || !vapidPrivate || !vapidSubject) {
      throw new Error("VAPID_* env vars missing");
    }
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // اقرأ الحجز + relations
    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select(`
        id, tenant_id, start_time, customer_input_name,
        customers ( full_name ),
        fields ( name ),
        tenants ( name )
      `)
      .eq("id", booking_id)
      .single();

    if (bookingErr || !booking) {
      throw new Error(`فشل تحميل الحجز ${booking_id}: ${bookingErr?.message ?? "not found"}`);
    }

    // اقرأ كل subscriptions لهذا الـ tenant (الويب والأجهزة الأصلية معاً)
    const { data: subscriptions, error: subsErr } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh_key, auth_key, platform")
      .eq("tenant_id", booking.tenant_id);

    if (subsErr) throw new Error(`فشل قراءة الاشتراكات: ${subsErr.message}`);
    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: "no subscriptions" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ابنِ الـ payload
    const customer = Array.isArray(booking.customers) ? booking.customers[0] : booking.customers;
    const field = Array.isArray(booking.fields) ? booking.fields[0] : booking.fields;

    const customerName = customer?.full_name || booking.customer_input_name || "عميل جديد";
    const fieldName = field?.name || "ملعب";

    // ملاحظة: iOS يضيف "from <اسم التطبيق>" تلقائياً قبل title.
    // tag موحّد لكل حجز → التذكير يستبدل الإشعار السابق (حالة واحدة في مركز الإشعارات).
    let payload: string;
    if (type === "reminder") {
      const elapsed = REMINDER_ELAPSED[Math.max(1, Math.min(4, reminder_count))] || "منذ فترة";
      payload = JSON.stringify({
        title: "حجز ينتظر موافقتك ⏰",
        body: `${customerName} · ${fieldName} · معلّق ${elapsed}`,
        url: "/bookings",
        tag: `booking-${booking.id}`,
      });
    } else if (type === "cancelled_by_customer") {
      const timeLabel = formatArabicDateTime(booking.start_time);
      payload = JSON.stringify({
        title: "ألغى العميل حجزه",
        body: `${customerName} · ${fieldName} · ${timeLabel}`,
        url: "/bookings",
        tag: `booking-${booking.id}`,
      });
    } else {
      const timeLabel = formatArabicDateTime(booking.start_time);
      payload = JSON.stringify({
        title: "حجز جديد",
        body: `${customerName} · ${fieldName} · ${timeLabel}`,
        url: "/bookings",
        tag: `booking-${booking.id}`,
      });
    }

    // ─── الإرسال: ثلاث قنوات، حمولة واحدة ───────────────────────────────────
    //
    // كل منصّة تُخاطَب بقناتها: الويب بـ Web Push، وأبل بـ APNs مباشرةً، وأندرويد
    // بـ FCM. الحمولة المنطقية واحدة (عنوان + نص + وجهة نقر) فلا يتفرّق نصّ
    // الإشعار بين المنصّات — تفرُّقه هو ما يجعل صياغةً تُصلَح في مكان وتبقى
    // خاطئة في مكانين.
    const parsed = JSON.parse(payload) as {
      title: string; body: string; url: string; tag: string;
    };

    // نُجهّز توكنَي القناتين مرّةً واحدة لكل دفعة، وفقط إن وُجد لهما مشترك فعلاً:
    // لا معنى لرحلة شبكةٍ إلى أبل وقوقل لملعبٍ كل أجهزته على الويب.
    const hasIos = subscriptions.some((s: PushSubscriptionRow) => s.platform === "ios");
    const hasAndroid = subscriptions.some((s: PushSubscriptionRow) => s.platform === "android");

    let jwt: string | null = null;
    if (hasIos) {
      if (apnsConfigured()) {
        try { jwt = await apnsToken(); } catch (err) {
          console.error("[push] فشل توكن APNs:", err);
        }
      } else {
        console.warn("[push] أجهزة أبل مسجّلة لكن أسرار APNs غير مضبوطة");
      }
    }

    const fcm = hasAndroid
      ? (fcmConfigured() ? await fcmSession() : (console.warn("[push] أجهزة أندرويد مسجّلة لكن FCM_SERVICE_ACCOUNT غير مضبوط"), null))
      : null;

    // نتيجة موحّدة لكل قناة: نجاح، أو جهاز ميّت يُحذف، أو فشل يُعَدّ
    const markOk = (id: string) =>
      supabase.from("push_subscriptions")
        .update({ last_used_at: new Date().toISOString(), failed_count: 0 })
        .eq("id", id);
    const markGone = (id: string) =>
      supabase.from("push_subscriptions").delete().eq("id", id);
    const markFailed = async (id: string) =>
      supabase.from("push_subscriptions")
        .update({ failed_count: (await getFailedCount(supabase, id)) + 1 })
        .eq("id", id);

    const results = await Promise.allSettled(
      subscriptions.map(async (sub: PushSubscriptionRow) => {
        // ── أبل ──
        if (sub.platform === "ios") {
          if (!jwt) return { id: sub.id, ok: false, skipped: true };
          const r = await apnsSendAlert(jwt, sub.endpoint, APP_BUNDLE_ID, {
            title: parsed.title,
            body: parsed.body,
            threadId: parsed.tag,
            url: parsed.url,
          });
          if (r.status === 200) { await markOk(sub.id); return { id: sub.id, ok: true }; }
          if (r.gone) { await markGone(sub.id); return { id: sub.id, ok: false, deleted: true }; }
          await markFailed(sub.id);
          return { id: sub.id, ok: false, error: `apns ${r.status} ${r.error ?? ""}` };
        }

        // ── أندرويد ──
        if (sub.platform === "android") {
          if (!fcm) return { id: sub.id, ok: false, skipped: true };
          const r = await fcm.send(sub.endpoint, {
            title: parsed.title,
            body: parsed.body,
            tag: parsed.tag,
            url: parsed.url,
          });
          if (r.status >= 200 && r.status < 300) { await markOk(sub.id); return { id: sub.id, ok: true }; }
          if (r.gone) { await markGone(sub.id); return { id: sub.id, ok: false, deleted: true }; }
          await markFailed(sub.id);
          return { id: sub.id, ok: false, error: `fcm ${r.status} ${r.error ?? ""}` };
        }

        // ── الويب ──
        // صفّ ويبٍ بلا مفاتيح لا يمكن إرساله؛ يمنعه قيد قاعدة البيانات، والفحص
        // هنا يحمي من صفٍّ قديم سابقٍ للقيد.
        if (!sub.p256dh_key || !sub.auth_key) {
          await markGone(sub.id);
          return { id: sub.id, ok: false, deleted: true };
        }
        const pushSub = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh_key, auth: sub.auth_key },
        };
        try {
          await webpush.sendNotification(pushSub, payload, { TTL: 60 * 60 });
          await markOk(sub.id);
          return { id: sub.id, ok: true };
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await markGone(sub.id);
            return { id: sub.id, ok: false, deleted: true };
          }
          await markFailed(sub.id);
          return { id: sub.id, ok: false, error: String(err) };
        }
      }),
    );

    const ok = (r: PromiseSettledResult<unknown>) =>
      r.status === "fulfilled" && (r.value as { ok: boolean }).ok;
    const sent = results.filter(ok).length;
    const failed = subscriptions.length - sent;

    // تفصيل بالمنصّة: عند شكوى «لا تصلني إشعارات» هذا السجلّ يقول أي قناةٍ صمتت
    const byPlatform = { web: 0, ios: 0, android: 0 } as Record<string, number>;
    results.forEach((r, i) => { if (ok(r)) byPlatform[subscriptions[i].platform]++; });

    return new Response(
      JSON.stringify({ sent, failed, total: subscriptions.length, byPlatform }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-booking-push failed:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

async function getFailedCount(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  id: string,
): Promise<number> {
  const { data } = await supabase
    .from("push_subscriptions")
    .select("failed_count")
    .eq("id", id)
    .single();
  return data?.failed_count ?? 0;
}
