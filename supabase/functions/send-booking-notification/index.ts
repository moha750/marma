// Edge function يستقبل booking_id من trigger DB ويُرسل إشعار البريد للمالك.
//
// يُستدعى من tg_notify_new_booking (في migration السابق) عبر pg_net.
//
// المتطلبات في Edge Functions secrets:
//   RESEND_API_KEY         — مفتاح Resend
//   APP_URL                — رابط التطبيق (مثال: https://USERNAME.github.io/marma)
//   INTERNAL_HOOK_SECRET   — سر مشترك للتحقق من أن النداء من قاعدتنا

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail } from "../_shared/resend.ts";
import { newBookingNotification } from "../_shared/templates.ts";

interface RequestBody {
  booking_id: string;
}

Deno.serve(async (req) => {
  try {
    // تحقق من السر المشترك
    const expectedSecret = Deno.env.get("INTERNAL_HOOK_SECRET");
    const authHeader = req.headers.get("authorization") ?? "";
    const provided = authHeader.replace(/^Bearer\s+/i, "");
    if (!expectedSecret || provided !== expectedSecret) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { booking_id } = (await req.json()) as RequestBody;
    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // اقرأ الحجز + كل العلاقات في استعلام واحد
    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select(`
        id, tenant_id, start_time, end_time, total_price,
        customer_input_name,
        customers ( full_name, phone ),
        fields ( name ),
        tenants ( name )
      `)
      .eq("id", booking_id)
      .single();

    if (bookingErr || !booking) {
      throw new Error(`فشل تحميل الحجز ${booking_id}: ${bookingErr?.message ?? "not found"}`);
    }

    // اقرأ بريد المالك
    const { data: ownerProfile, error: profileErr } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("tenant_id", booking.tenant_id)
      .eq("role", "owner")
      .single();

    if (profileErr || !ownerProfile) {
      throw new Error(`لم يُعثر على مالك للملعب ${booking.tenant_id}: ${profileErr?.message ?? "not found"}`);
    }

    const { data: ownerUser, error: userErr } = await supabase.auth.admin.getUserById(ownerProfile.id);
    if (userErr || !ownerUser?.user?.email) {
      throw new Error(`فشل قراءة بريد المالك: ${userErr?.message ?? "no email"}`);
    }

    // ابنِ المحتوى
    const appUrl = Deno.env.get("APP_URL") ?? "";
    const dashboardUrl = `${appUrl}/bookings`;

    const customer = Array.isArray(booking.customers) ? booking.customers[0] : booking.customers;
    const field = Array.isArray(booking.fields) ? booking.fields[0] : booking.fields;
    const tenant = Array.isArray(booking.tenants) ? booking.tenants[0] : booking.tenants;

    const customerName = customer?.full_name || booking.customer_input_name || "غير محدّد";
    const customerPhone = customer?.phone || "—";

    const { subject, html } = newBookingNotification({
      ownerName: ownerProfile.full_name || "",
      tenantName: tenant?.name || "ملعبك",
      fieldName: field?.name || "غير محدّد",
      customerName,
      customerPhone,
      startTime: booking.start_time,
      endTime: booking.end_time,
      totalPrice: Number(booking.total_price) || 0,
      dashboardUrl,
    });

    await sendEmail({ to: ownerUser.user.email, subject, html });

    return new Response(JSON.stringify({ sent: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-booking-notification failed:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
