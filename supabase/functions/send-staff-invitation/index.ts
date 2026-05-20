// Edge function يستقبل invitation_id من trigger DB ويُرسل دعوة الموظف بالبريد.
//
// يُستدعى من tg_notify_staff_invitation عبر pg_net.
//
// المتطلبات في Edge Functions secrets:
//   RESEND_API_KEY         — مفتاح Resend
//   APP_URL                — رابط التطبيق (مثال: https://USERNAME.github.io/marma)
//   INTERNAL_HOOK_SECRET   — سر مشترك للتحقق من أن النداء من قاعدتنا

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail } from "../_shared/resend.ts";
import { staffInvitation } from "../_shared/templates.ts";

interface RequestBody {
  invitation_id: string;
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

    const { invitation_id } = (await req.json()) as RequestBody;
    if (!invitation_id) {
      return new Response(JSON.stringify({ error: "invitation_id required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: invite, error: inviteErr } = await supabase
      .from("staff_invitations")
      .select(`
        id, email, full_name, code, expires_at, tenant_id,
        tenants ( name )
      `)
      .eq("id", invitation_id)
      .single();

    if (inviteErr || !invite) {
      throw new Error(`فشل تحميل الدعوة ${invitation_id}: ${inviteErr?.message ?? "not found"}`);
    }

    const appUrl = Deno.env.get("APP_URL") ?? "";
    const signupUrl = `${appUrl}/auth/signup?invite=${encodeURIComponent(invite.code)}`;
    const tenant = Array.isArray(invite.tenants) ? invite.tenants[0] : invite.tenants;

    const { subject, html } = staffInvitation({
      recipientName: invite.full_name || "",
      tenantName: tenant?.name || "ملعب على مَرمى",
      signupUrl,
      expiresAt: invite.expires_at,
    });

    await sendEmail({ to: invite.email, subject, html });

    return new Response(JSON.stringify({ sent: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-staff-invitation failed:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
