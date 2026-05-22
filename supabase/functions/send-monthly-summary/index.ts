// Edge Function: ملخّص شهري push للمالك (اليوم 1 من كل شهر، 9ص السعودية)
//
// المدخلات من send_monthly_summaries() cron:
//   tenant_id, month_name, prev_month_name, total_bookings, total_revenue, growth_pct (nullable)
//
// المخرج:
//   Title: "شهر مايو — ملخّصك 💰"
//   Body : "142 حجز · 21,500 ر.س · ⬆️ 18% عن أبريل"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

interface RequestBody {
  tenant_id: string;
  month_name: string;
  prev_month_name: string | null;
  total_bookings: number;
  total_revenue: number;
  growth_pct: number | null;
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

function buildGrowthLabel(pct: number | null, prevMonth: string | null): string | null {
  if (pct === null || prevMonth === null) return null;
  if (pct === 0) return `بدون تغيير عن ${prevMonth}`;
  const arrow = pct > 0 ? "⬆️" : "⬇️";
  const abs = Math.abs(pct);
  return `${arrow} ${abs}% عن ${prevMonth}`;
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

    const {
      tenant_id,
      month_name,
      prev_month_name,
      total_bookings,
      total_revenue,
      growth_pct,
    } = (await req.json()) as RequestBody;

    if (!tenant_id || !month_name || typeof total_bookings !== "number") {
      return new Response(
        JSON.stringify({ error: "tenant_id, month_name, total_bookings required" }),
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

    // اقرأ معرّفات المالكين
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

    // ابنِ body: أرقام مختصرة، النمو اختياري
    const parts: string[] = [`${total_bookings} حجز`];
    if (total_revenue > 0) parts.push(formatMoney(total_revenue));
    const growthLabel = buildGrowthLabel(growth_pct, prev_month_name);
    if (growthLabel) parts.push(growthLabel);
    const bodyText = parts.join(" · ");

    const payload = JSON.stringify({
      title: `شهر ${month_name} — ملخّصك 💰`,
      body: bodyText,
      url: "/reports",
      tag: "monthly-summary",
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
    console.error("send-monthly-summary failed:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
