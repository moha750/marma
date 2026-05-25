// Edge function يأخذ رابط Google Maps (مختصر أو طويل) ويستخرج الإحداثيات (lat, lng).
// يُستدعى من نموذج الأرضيات في لوحة الإدارة عند فقدان التركيز عن حقل الرابط.
//
// لماذا هذه الـ function؟ متصفّح العميل لا يستطيع متابعة redirects لروابط maps.app.goo.gl
// (CORS)، فنفعل ذلك من السيرفر ثم نخزّن الإحداثيات في DB. النتيجة: embed دقيق ودائم
// بدون مفتاح API ودون أن يتأثر بأي تغيير مستقبلي في سلوك الروابط المختصرة.
//
// الحماية: نطلب JWT لمستخدم مسجّل (يمنع DoS وSSRF abuse من الإنترنت العام)،
// ونحصر hosts المسموح بمتابعة redirects إليها في نطاقات Google فقط.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface RequestBody {
  url?: string;
}

const ALLOWED_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "maps.google.com",
  "www.google.com",
  "google.com",
  "consent.google.com",
]);

const MAX_HOPS = 5;
const FETCH_TIMEOUT_MS = 6000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function extractCoords(urlString: string): { latitude: number; longitude: number } | null {
  const patterns: RegExp[] = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /@(-?\d+\.\d+),(-?\d+\.\d+),\d+(?:\.\d+)?z/,
    /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/,
    /\/maps\/place\/[^/]+\/@(-?\d+\.\d+),(-?\d+\.\d+)/,
  ];
  for (const re of patterns) {
    const m = urlString.match(re);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng)
        && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { latitude: lat, longitude: lng };
      }
    }
  }
  return null;
}

async function resolveMapsUrl(initialUrl: string): Promise<string | null> {
  let current = initialUrl;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return null;
    }
    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
      return null;
    }

    // إذا كانت صفحة موافقة Google، اتبع رابط continue يدوياً
    if (parsed.hostname === "consent.google.com") {
      const cont = parsed.searchParams.get("continue");
      if (!cont) return null;
      current = cont;
      continue;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: {
          "Accept-Language": "ar-SA,ar;q=0.9,en;q=0.8",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        },
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timer);
      return null;
    }
    clearTimeout(timer);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      current = new URL(loc, current).toString();
      continue;
    }

    // وصلنا إلى صفحة 200 — أعد الـ URL الحالي للاستخراج منه
    return current;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  // تحقّق من المستخدم: لا يُسمح بالاستدعاء بلا JWT
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader) {
    return json({ error: "unauthorized" }, 401);
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const rawUrl = (body.url ?? "").trim();
  if (!rawUrl) {
    return json({ error: "url_required" }, 400);
  }
  if (!/^https?:\/\//i.test(rawUrl)) {
    return json({ error: "unresolvable", reason: "invalid_url" }, 422);
  }

  // الإحداثيات قد تكون موجودة أصلاً في رابط طويل — استخرجها بلا fetch
  const direct = extractCoords(rawUrl);
  if (direct) {
    return json(direct, 200);
  }

  // وإلا تتبّع redirects ثم استخرج
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return json({ error: "unresolvable", reason: "invalid_url" }, 422);
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return json({ error: "unresolvable", reason: "invalid_host" }, 422);
  }

  const finalUrl = await resolveMapsUrl(rawUrl);
  if (!finalUrl) {
    return json({ error: "unresolvable", reason: "redirect_failed" }, 422);
  }

  const coords = extractCoords(finalUrl);
  if (!coords) {
    return json({ error: "unresolvable", reason: "no_coords" }, 422);
  }
  return json(coords, 200);
});
