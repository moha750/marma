// Send Email Hook لـ Supabase Auth.
// يستقبل أحداث المصادقة (signup + recovery) ويُرسل بريداً مخصّصاً عبر Resend
// بدلاً من القالب الافتراضي. ملاحظة: ما دام الخطّاف مفعّلاً، Supabase يفوّض له
// كل رسائل المصادقة — فأي نوع لا نعالجه هنا لن تُرسل له رسالة إطلاقاً.
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
import { signupConfirmation, passwordReset } from "../_shared/templates.ts";

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

    const actionType = payload.email_data.email_action_type;
    // نتعامل مع التسجيل (signup) وإعادة تعيين كلمة المرور (recovery).
    // الأنواع الأخرى نتركها (لا قالب مخصّص لها بعد).
    if (actionType !== "signup" && actionType !== "recovery") {
      return new Response(JSON.stringify({ skipped: true, reason: `unhandled type: ${actionType}` }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { user, email_data } = payload;
    const fullName = String(user.user_metadata?.full_name ?? "").trim();
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? email_data.site_url;

    // رابط verify القياسي لـ Supabase (يحمل المستخدم بعده إلى redirect_to)
    const buildVerifyUrl = (type: string) =>
      `${supabaseUrl}/auth/v1/verify?token=${email_data.token_hash}&type=${type}&redirect_to=${encodeURIComponent(email_data.redirect_to || email_data.site_url)}`;

    let subject: string;
    let html: string;
    if (actionType === "recovery") {
      ({ subject, html } = passwordReset({ fullName, resetUrl: buildVerifyUrl("recovery") }));
    } else {
      ({ subject, html } = signupConfirmation({ fullName, verifyUrl: buildVerifyUrl("signup") }));
    }

    await sendEmail({ to: user.email, subject, html });

    return new Response(JSON.stringify({ sent: true, type: actionType }), {
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
