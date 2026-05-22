// Edge Function: ملخّص أسبوعي push للمالك (الأحد 9 صباحاً السعودية)
//
// المدخلات من send_weekly_summaries() cron:
//   tenant_id, total_bookings, total_revenue, busiest_day, busiest_count
//
// المخرج: "23 حجز · أعلى يوم الخميس · 3,450 ر.س"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

interface RequestBody {
  tenant_id: string;
  total_bookings: number;
  total_revenue: number;
  busiest_day: string | null;
  busiest_count: number;
}

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n) + " ر.س";
}

Deno.serve(async (req) => {
  try {
    const expectedSecret = Deno.env.get("INTERNAL_HOOK_SECRET");
    const authHeader = req.headers.get("authorization") ?? "";
    const provided = authHeader.replace(/^Bearer\s+/i, "");
    if (!expectedSecret || provided !== expectedSecret) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { tenant_id, total_bookings, total_revenue, busiest_day } =
      (await req.json()) as RequestBody;

    if (!tenant_id || typeof total_bookings !== "number") {
      return new Response(
        JSON.stringify({ error: "tenant_id and total_bookings required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
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

    // اقرأ معرّفات المالكين (push_subscriptions.user_id يربط بـ auth.users لا profiles)
    const { data: ownerProfiles, error: profilesErr } = await supabase
      .from("profiles")
      .select("id")
      .eq("tenant_id", tenant_id)
      .eq("role", "owner");

    if (profilesErr) throw new Error(`فشل قراءة المالكين: ${profilesErr.message}`);
    if (!ownerProfiles || ownerProfiles.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, reason: "no owner profile" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const ownerIds = ownerProfiles.map((p: { id: string }) => p.id);

    const { data: subscriptions, error: subsErr } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh_key, auth_key")
      .eq("tenant_id", tenant_id)
      .in("user_id", ownerIds);

    if (subsErr) throw new Error(`فشل قراءة الاشتراكات: ${subsErr.message}`);
    if (!subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, reason: "no owner subscriptions" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // ابنِ body بأسلوب A: أرقام مختصرة
    const parts: string[] = [`${total_bookings} حجز`];
    if (busiest_day) parts.push(`أعلى يوم ${busiest_day}`);
    if (total_revenue > 0) parts.push(formatMoney(total_revenue));
    const bodyText = parts.join(" · ");

    const payload = JSON.stringify({
      title: "أسبوعك في مَرمى 📊",
      body: bodyText,
      url: "/dashboard",
      tag: "weekly-summary",
    });

    const results = await Promise.allSettled(
      (subscriptions as PushSubscriptionRow[]).map(async (sub) => {
        const pushSub = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh_key, auth: sub.auth_key },
        };
        try {
          await webpush.sendNotification(pushSub, payload, { TTL: 60 * 60 });
          await supabase
            .from("push_subscriptions")
            .update({ last_used_at: new Date().toISOString(), failed_count: 0 })
            .eq("id", sub.id);
          return { ok: true };
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await supabase.from("push_subscriptions").delete().eq("id", sub.id);
            return { ok: false, deleted: true };
          }
          return { ok: false, error: String(err) };
        }
      }),
    );

    const sent = results.filter(
      (r) => r.status === "fulfilled" && (r.value as { ok: boolean }).ok,
    ).length;

    return new Response(
      JSON.stringify({ sent, total: subscriptions.length }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-weekly-summary failed:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
