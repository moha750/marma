// إشعار دفعٍ عامّ إلى أجهزة الملعب — تُنادى من قاعدة البيانات بحمولةٍ جاهزة.
// ----------------------------------------------------------------------------
// send-booking-push تعرف الحجوزات: تأخذ booking_id وتقرأه وتصوغ نصّه. وهذا
// صحيحٌ لها وخاطئٌ لغيرها — إشعار «ختم بانتظار موافقتك» لا حجزَ يقرأه ولا
// نصَّ يُشتقّ من جدول. فبقيت تلك على تخصّصها، وهذه تأخذ النصّ كما هو.
//
// من يصوغ النصّ إذن؟ قاعدة البيانات، حيث الحدث يقع. والقاعدة تكتب سطر
// notifications بعنوانٍ ونصّ أصلاً — فتمرّرهما هنا بدل أن يُعاد بناؤهما.
// نصٌّ واحد للجرس وللجوال، فلا يفترقان بمرور الوقت.
//
// الإرسال نفسه في _shared/push.ts — نفس النواة التي تستعملها دالّة الحجوزات.
//
// الأسرار: INTERNAL_HOOK_SECRET · VAPID_* · APPLE_APNS_* · FCM_SERVICE_ACCOUNT

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { initWebPush, pushToTenant } from "../_shared/push.ts";

interface RequestBody {
  tenant_id: string;
  title: string;
  body: string;
  /** وجهة النقر داخل اللوحة — نفس رابط سطر notifications */
  url?: string;
  /** وسم الحدث: نداءٌ لاحق بنفس الوسم يستبدل الإشعار بدل أن يتكدّس */
  tag?: string;
}

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  try {
    const expected = Deno.env.get("INTERNAL_HOOK_SECRET");
    const provided = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!expected || provided !== expected) return json({ error: "unauthorized" }, 401);

    const b = (await req.json()) as RequestBody;
    if (!b?.tenant_id || !b?.title || !b?.body) {
      return json({ error: "tenant_id, title, body required" }, 400);
    }

    initWebPush();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const result = await pushToTenant(supabase, b.tenant_id, {
      title: b.title,
      body: b.body,
      url: b.url || "/",
      tag: b.tag || "marma",
    });

    return json(result);
  } catch (err) {
    console.error("send-owner-push failed:", err);
    return json({ error: String(err) }, 500);
  }
});
