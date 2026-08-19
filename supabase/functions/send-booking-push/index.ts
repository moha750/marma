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
import { initWebPush, type PushPayload, pushToTenant } from "../_shared/push.ts";

// الإرسال نفسه في ‎_shared/push.ts — يخدم هذه الدالّة و send-owner-push معاً.
// ما بقي هنا هو ما يخصّ الحجز وحده: قراءته وصياغة نصّه.

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

    initWebPush();

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

    // ابنِ الـ payload
    const customer = Array.isArray(booking.customers) ? booking.customers[0] : booking.customers;
    const field = Array.isArray(booking.fields) ? booking.fields[0] : booking.fields;

    const customerName = customer?.full_name || booking.customer_input_name || "عميل جديد";
    const fieldName = field?.name || "ملعب";

    // ملاحظة: iOS يضيف "from <اسم التطبيق>" تلقائياً قبل title.
    // tag موحّد لكل حجز → التذكير يستبدل الإشعار السابق (حالة واحدة في مركز الإشعارات).
    let payload: PushPayload;
    if (type === "reminder") {
      const elapsed = REMINDER_ELAPSED[Math.max(1, Math.min(4, reminder_count))] || "منذ فترة";
      payload = ({
        title: "حجز ينتظر موافقتك ⏰",
        body: `${customerName} · ${fieldName} · معلّق ${elapsed}`,
        url: "/bookings",
        tag: `booking-${booking.id}`,
      });
    } else if (type === "cancelled_by_customer") {
      const timeLabel = formatArabicDateTime(booking.start_time);
      payload = ({
        title: "ألغى العميل حجزه",
        body: `${customerName} · ${fieldName} · ${timeLabel}`,
        url: "/bookings",
        tag: `booking-${booking.id}`,
      });
    } else {
      const timeLabel = formatArabicDateTime(booking.start_time);
      payload = ({
        title: "حجز جديد",
        body: `${customerName} · ${fieldName} · ${timeLabel}`,
        url: "/bookings",
        tag: `booking-${booking.id}`,
      });
    }

    const result = await pushToTenant(supabase, booking.tenant_id, payload);

    return new Response(JSON.stringify(result), {
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
