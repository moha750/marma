// Edge Function: يُرسل تنبيه Push للمالك عند اقتراب انتهاء التجربة أو الاشتراك.
//
// يُستدعى من send_subscription_warnings() cron job عبر pg_net.
//
// المدخلات:
//   tenant_id: uuid
//   kind: 'trial_3d' | 'trial_1d' | 'trial_final'
//       | 'sub_3d'   | 'sub_1d'   | 'sub_final'
//       | 'grace_3d' | 'grace_1d' | 'grace_final'
//
// secrets المطلوبة:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, INTERNAL_HOOK_SECRET

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

interface RequestBody {
  tenant_id: string;
  kind: string;
}

interface MessageContent {
  title: string;
  body: string;
}

const MESSAGES: Record<string, MessageContent> = {
  // التجربة المجانية
  trial_3d: {
    title: "تجربتك تنتهي خلال 3 أيام",
    body: "اشترك الآن لتستمر باستقبال الحجوزات بدون انقطاع",
  },
  trial_1d: {
    title: "تجربتك تنتهي خلال 24 ساعة ⏰",
    body: "اشترك اليوم لتفادي توقّف الحجوزات",
  },
  trial_final: {
    title: "تجربتك تنتهي بعد ساعتين 🚨",
    body: "آخر فرصة قبل توقّف الحجوزات تماماً",
  },
  // الاشتراك المدفوع
  sub_3d: {
    title: "اشتراكك ينتهي خلال 3 أيام",
    body: "جدّد لاستمرار استقبال الحجوزات",
  },
  sub_1d: {
    title: "اشتراكك ينتهي خلال 24 ساعة ⏰",
    body: "جدّد لتفادي دخول فترة السماح",
  },
  sub_final: {
    title: "اشتراكك ينتهي بعد ساعتين 🚨",
    body: "جدّد الآن قبل دخول فترة السماح",
  },
  // فترة السماح
  grace_3d: {
    title: "آخر 3 أيام قبل قفل الحساب",
    body: "حسابك في فترة السماح — جدّد قبل القفل الكامل",
  },
  grace_1d: {
    title: "الحساب يُقفل خلال 24 ساعة ⛔",
    body: "جدّد فوراً — يوم واحد متبقي",
  },
  grace_final: {
    title: "الحساب يُقفل بعد ساعتين 🚨",
    body: "جدّد الآن لاستعادة الوصول",
  },
};

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
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

    const { tenant_id, kind } = (await req.json()) as RequestBody;
    if (!tenant_id || !kind) {
      return new Response(JSON.stringify({ error: "tenant_id and kind required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const message = MESSAGES[kind];
    if (!message) {
      return new Response(JSON.stringify({ error: `unknown kind: ${kind}` }), {
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

    // اقرأ معرّفات المالكين للـ tenant (نستعلمها بشكل منفصل لأن
    // push_subscriptions.user_id يربط بـ auth.users وليس profiles مباشرة)
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

    // اقرأ subscriptions للمالكين فقط
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

    // payload — tag موحّد كي يستبدل أي تنبيه اشتراك سابق (حالة واحدة في مركز الإشعارات)
    const payload = JSON.stringify({
      title: message.title,
      body: message.body,
      url: "/subscription",
      tag: "subscription-warning",
    });

    const results = await Promise.allSettled(
      (subscriptions as unknown as PushSubscriptionRow[]).map(async (sub) => {
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
    console.error("send-subscription-warning failed:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
