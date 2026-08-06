// حذف الحساب نهائياً — يستدعيه المستخدم من داخل التطبيق.
// ----------------------------------------------------------------------------
// لماذا Edge Function ولا تكفي دالة SQL؟ لأن حذف صفّ المستخدم من auth.users لا
// يجوز إلا بمفتاح service_role، وهو مفتاحٌ لا يُوضع في متصفّح أبداً. فتقسيم العمل:
//
//   1) purge_my_account (SQL, security definer) تحذف بيانات التطبيق. هويتها
//      auth.uid() من رمز المستخدم نفسه، فلا تستطيع لمس حساب غيره.
//   2) هذه الدالة تحذف مستخدم المصادقة بمفتاح service_role بعد نجاح (١).
//
// الترتيب مقصود: لو حذفنا المصادقة أولاً وفشلت (١)، لبقيت بيانات منشأةٍ لا مالك
// لها ولا رمزَ وصولٍ لحذفها — عطبٌ لا يُصلحه إلا تدخّل يدوي في قاعدة البيانات.
//
// أسرار مطلوبة (موجودة تلقائياً في بيئة Supabase Edge):
//   SUPABASE_URL · SUPABASE_ANON_KEY · SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

interface RequestBody {
  // المالك وحده: تأكيد صريح أن حذف حسابه يمحو الملعب وكل بياناته
  delete_business?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) {
    console.error("[delete-account] SUPABASE_SERVICE_ROLE_KEY غير مضبوط");
    return json({ error: "server_misconfigured" }, 500);
  }

  // عميل بهوية المستخدم — للتحقّق ولتشغيل الدالة بصلاحياته
  const asUser = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
  const userId = userData.user.id;

  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    // جسم فارغ مقبول — الموظّف لا يحتاج تأكيداً
  }

  // (1) بيانات التطبيق
  const { data: purge, error: purgeErr } = await asUser.rpc("purge_my_account", {
    p_delete_business: body.delete_business === true,
  });

  if (purgeErr) {
    const msg = purgeErr.message || "";
    if (msg.includes("OWNER_MUST_CONFIRM_BUSINESS_DELETION")) {
      return json({ error: "confirmation_required" }, 409);
    }
    if (msg.includes("PURGE_INCOMPLETE")) {
      // الفحص الذاتي في الدالة اكتشف بيانات باقية — لا نحذف المصادقة، فبقاء
      // رمز الوصول هو ما يجعل إعادة المحاولة ممكنة بعد إصلاح السبب.
      console.error("[delete-account] الحذف غير مكتمل:", msg);
      return json({ error: "purge_incomplete", detail: msg }, 500);
    }
    console.error("[delete-account] فشل purge_my_account:", msg);
    return json({ error: "purge_failed" }, 500);
  }

  // (2) هوية المصادقة
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) {
    console.error("[delete-account] فشل حذف مستخدم المصادقة:", delErr.message);
    // بيانات التطبيق حُذفت فعلاً. نُبلِغ بالحقيقة كما هي بدل ادّعاء النجاح:
    // حسابٌ بلا بيانات يبقى قابلاً لإعادة المحاولة، والصمت هنا يعني بريداً
    // محجوزاً لا يعرف صاحبه لماذا لا يستطيع التسجيل من جديد.
    return json({ error: "identity_delete_failed", data_deleted: true }, 500);
  }

  return json({ ok: true, ...(purge as Record<string, unknown>) });
});
