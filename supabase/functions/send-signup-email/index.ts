// Send Email Hook لـ Supabase Auth.
// يستقبل أحداث التسجيل (signup) ويُرسل بريداً مخصّصاً عبر Resend
// بدلاً من القالب الافتراضي.
//
// إعداد Supabase Dashboard:
//   Authentication → Hooks → Send Email Hook → Enable
//   URL: https://<project-ref>.functions.supabase.co/send-signup-email
//   Secret: يُولَّد تلقائياً، يُحفَظ في Edge Functions secrets كـ SEND_EMAIL_HOOK_SECRET
//
// Payload (من Supabase):
//   { user, email_data: { token, token_hash, redirect_to, email_action_type, site_url } }

import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { sendEmail } from "../_shared/resend.ts";
import { signupConfirmation } from "../_shared/templates.ts";

interface SupabaseUser {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown>;
}

interface EmailData {
  token: string;
  token_hash: string;
  redirect_to: string;
  email_action_type: string;
  site_url: string;
}

interface HookPayload {
  user: SupabaseUser;
  email_data: EmailData;
}

Deno.serve(async (req) => {
  try {
    const rawBody = await req.text();
    const headers = Object.fromEntries(req.headers);

    // تحقق من التوقيع (إن وُجد السر — موصى به دائماً في الإنتاج)
    const hookSecret = Deno.env.get("SEND_EMAIL_HOOK_SECRET");
    let payload: HookPayload;

    if (hookSecret) {
      const secretBase64 = hookSecret.replace(/^v1,whsec_/, "");
      const wh = new Webhook(secretBase64);
      payload = wh.verify(rawBody, headers) as HookPayload;
    } else {
      payload = JSON.parse(rawBody) as HookPayload;
    }

    // نتعامل فقط مع رسالة التسجيل (signup). الأنواع الأخرى نتركها لـ Supabase أو لمعالجات لاحقة.
    if (payload.email_data.email_action_type !== "signup") {
      return new Response(JSON.stringify({ skipped: true, reason: "not a signup email" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { user, email_data } = payload;
    const fullName = String(user.user_metadata?.full_name ?? "").trim();

    // رابط التأكيد القياسي لـ Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? email_data.site_url;
    const verifyUrl = `${supabaseUrl}/auth/v1/verify?token=${email_data.token_hash}&type=signup&redirect_to=${encodeURIComponent(email_data.redirect_to || email_data.site_url)}`;

    const { subject, html } = signupConfirmation({ fullName, verifyUrl });
    await sendEmail({ to: user.email, subject, html });

    return new Response(JSON.stringify({ sent: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-signup-email failed:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
