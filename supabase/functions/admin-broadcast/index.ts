// Edge Function: بثّ إشعار/بريد لكل ملّاك الملاعب.
// يُستدعى من لوحة المشرف (المتصفّح) بـ JWT المشرف العام.
//
// التدفّق:
//   1) تحقّق من جلسة المستخدم (getUser).
//   2) admin_broadcast_targets (SECURITY DEFINER + is_super_admin) → الملّاك + اشتراكات Push.
//      تُستدعى بـ JWT المشرف، فهي تتحقّق من الصلاحية وتُرجع البيانات معًا.
//   3) admin_log_broadcast → سجّل البثّ واحصل على المعرّف (للوسم tag).
//   4) أرسل Push (web-push) و/أو بريد (Resend) بالتوازي، نظّف الاشتراكات الميتة.
//   5) حدّث الأعداد في صفّ السجلّ (service role).
//
// Secrets المطلوبة: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
//                   RESEND_API_KEY, EMAIL_FROM (اختياري), SUPABASE_* (تلقائية).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

interface RequestBody {
  title?: string;
  body?: string;
  push?: boolean;
  email?: boolean;
  url?: string;
  recipients?: string[]; // معرّفات ملّاك محدّدين؛ غياب/فراغ = كل الملّاك
}

interface OwnerRow { user_id: string; email: string; name: string }
interface PushRow { id: string; endpoint: string; p256dh: string; auth: string }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!
  ));
}

function emailHtml(title: string, body: string): string {
  const safeBody = escapeHtml(body).replace(/\n/g, "<br>");
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><body style="margin:0;background:#f4f5f7;font-family:'Segoe UI',Tahoma,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6e8eb;">
        <tr><td style="background:#0F9D58;padding:20px 28px;color:#fff;font-size:20px;font-weight:bold;">مَرمى</td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 16px;font-size:20px;color:#111;">${escapeHtml(title)}</h1>
          <div style="font-size:15px;line-height:1.9;color:#374151;">${safeBody}</div>
        </td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #eee;color:#9ca3af;font-size:12px;">
          هذه رسالة من فريق مَرمى إلى أصحاب الملاعب. كل حجوزاتك .. في مَرمى واحد.
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    // عميل بهويّة المستخدم — للتحقّق من الجلسة واستدعاء الدوال المحميّة
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: "unauthorized" }, 401);

    const reqBody = (await req.json()) as RequestBody;
    const title = (reqBody.title || "").trim();
    const body = (reqBody.body || "").trim();
    const wantPush = reqBody.push !== false; // افتراضي true
    const wantEmail = reqBody.email === true;
    const targetUrl = reqBody.url || "/dashboard";

    const selected = Array.isArray(reqBody.recipients)
      ? reqBody.recipients.filter((x) => typeof x === "string" && x)
      : [];
    const hasSelection = selected.length > 0;

    if (!title || !body) return json({ error: "العنوان والنص مطلوبان" }, 400);
    if (!wantPush && !wantEmail) return json({ error: "اختر قناة واحدة على الأقل" }, 400);

    // المستلمون (هذه الدالة تتحقّق من is_super_admin؛ ترفع خطأ لو ليس مشرفًا)
    const { data: targets, error: targetsErr } = await userClient.rpc("admin_broadcast_targets", {
      p_user_ids: hasSelection ? selected : null,
    });
    if (targetsErr) {
      const forbidden = /forbidden/i.test(targetsErr.message || "");
      return json({ error: forbidden ? "ليست لديك صلاحية" : targetsErr.message }, forbidden ? 403 : 500);
    }
    const owners: OwnerRow[] = (targets?.owners || []) as OwnerRow[];
    const pushSubs: PushRow[] = (targets?.push || []) as PushRow[];

    const channels: string[] = [];
    if (wantPush) channels.push("push");
    if (wantEmail) channels.push("email");

    // سجّل البثّ واحصل على المعرّف
    const { data: broadcastId, error: logErr } = await userClient.rpc("admin_log_broadcast", {
      p_title: title, p_body: body, p_channels: channels, p_recipients: owners.length,
      p_audience: hasSelection ? "selected" : "owners",
    });
    if (logErr) return json({ error: logErr.message }, 500);

    const svc = createClient(SUPABASE_URL, SERVICE_KEY);
    let pushSent = 0;
    let emailSent = 0;

    // ── Push ──
    if (wantPush && pushSubs.length) {
      const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
      const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
      const vapidSubject = Deno.env.get("VAPID_SUBJECT");
      if (vapidPublic && vapidPrivate && vapidSubject) {
        webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
        const payload = JSON.stringify({
          title, body, url: targetUrl, tag: `broadcast-${broadcastId}`,
        });
        const results = await Promise.allSettled(pushSubs.map(async (sub) => {
          const pushSub = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
          try {
            await webpush.sendNotification(pushSub, payload, { TTL: 24 * 60 * 60 });
            return true;
          } catch (err: unknown) {
            const code = (err as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) {
              await svc.from("push_subscriptions").delete().eq("id", sub.id);
            }
            return false;
          }
        }));
        pushSent = results.filter((r) => r.status === "fulfilled" && r.value === true).length;
      }
    }

    // ── البريد ──
    if (wantEmail && owners.length) {
      const apiKey = Deno.env.get("RESEND_API_KEY");
      const from = Deno.env.get("EMAIL_FROM") ?? "مَرمى <onboarding@resend.dev>";
      if (apiKey) {
        const html = emailHtml(title, body);
        const results = await Promise.allSettled(owners.map(async (o) => {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from, to: o.email, subject: title, html }),
          });
          if (!res.ok) throw new Error(await res.text());
          return true;
        }));
        emailSent = results.filter((r) => r.status === "fulfilled").length;
      }
    }

    // حدّث الأعداد
    await svc.from("broadcasts").update({ push_sent: pushSent, email_sent: emailSent }).eq("id", broadcastId);

    return json({
      ok: true,
      broadcast_id: broadcastId,
      recipients: owners.length,
      push_sent: pushSent,
      push_total: pushSubs.length,
      email_sent: emailSent,
      email_total: owners.length,
    });
  } catch (err) {
    console.error("admin-broadcast failed:", err);
    return json({ error: String(err) }, 500);
  }
});
