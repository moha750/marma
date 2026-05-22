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

interface RequestBody {
  booking_id: string;
  type?: "new" | "reminder";
  reminder_count?: number;
}

const REMINDER_ELAPSED: Record<number, string> = {
  1: "منذ ساعة",
  2: "منذ ٦ ساعات",
  3: "منذ ١٢ ساعة",
  4: "منذ يوم",
};

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
}

function formatArabicDateTime(iso: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("ar-EG", {
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

    // اقرأ كل subscriptions لهذا الـ tenant
    const { data: subscriptions, error: subsErr } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh_key, auth_key")
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
    } else {
      const timeLabel = formatArabicDateTime(booking.start_time);
      payload = JSON.stringify({
        title: "حجز جديد",
        body: `${customerName} · ${fieldName} · ${timeLabel}`,
        url: "/bookings",
        tag: `booking-${booking.id}`,
      });
    }

    // أرسل بالتوازي، نظّف الـ subscriptions الميتة
    const results = await Promise.allSettled(
      subscriptions.map(async (sub: PushSubscriptionRow) => {
        const pushSub = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh_key, auth: sub.auth_key },
        };
        try {
          await webpush.sendNotification(pushSub, payload, { TTL: 60 * 60 });
          // حدّث last_used_at عند النجاح
          await supabase
            .from("push_subscriptions")
            .update({ last_used_at: new Date().toISOString(), failed_count: 0 })
            .eq("id", sub.id);
          return { id: sub.id, ok: true };
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            // الـ subscription لم تعد صالحة — احذفها
            await supabase.from("push_subscriptions").delete().eq("id", sub.id);
            return { id: sub.id, ok: false, deleted: true };
          }
          // فشل آخر — زِد العدّاد
          await supabase
            .from("push_subscriptions")
            .update({ failed_count: (await getFailedCount(supabase, sub.id)) + 1 })
            .eq("id", sub.id);
          return { id: sub.id, ok: false, error: String(err) };
        }
      }),
    );

    const sent = results.filter((r) => r.status === "fulfilled" && (r.value as { ok: boolean }).ok).length;
    const failed = subscriptions.length - sent;

    return new Response(JSON.stringify({ sent, failed, total: subscriptions.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
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
