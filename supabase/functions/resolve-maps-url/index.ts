// Edge Function: يحلّ روابط Google Maps المختصرة (maps.app.goo.gl, goo.gl/maps)
// ويستخرج إحداثيات lat,lng لاستخدامها في iframe embed بدون API key.
//
// الاستدعاء (GET): /functions/v1/resolve-maps-url?url=<encoded_short_url>
// الرد الناجح: { "coords": "25.3273913,49.6511872", "long_url": "..." }
// الرد إذا لم تُستخرج إحداثيات: { "coords": null, "long_url": "..." }
// الأخطاء: 400 (url مفقود/غير صالح) | 502 (تعذّر حلّ الرابط)
//
// CORS: مفتوح (* ) لأن الـ frontend العام يستدعيه مباشرة.
// لا يحتاج auth — هو خدمة public utility.

const ALLOWED_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "www.google.com",
  "google.com",
  "maps.google.com",
]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function extractCoords(url: string): string | null {
  // الترتيب مُهم: نُفضّل إحداثيات الـ pin الفعلي على إحداثيات view center.
  // pattern A (الأدق): !3d<lat>!4d<lng> — موقع place_id الفعلي
  let m = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (m) return `${m[1]},${m[2]}`;
  // pattern B: ?q=lat,lng — صريح من البحث
  m = url.match(/[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return `${m[1]},${m[2]}`;
  // pattern C: ll=lat,lng — صريح
  m = url.match(/[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return `${m[1]},${m[2]}`;
  // pattern D (أقل دقة — view center): /@lat,lng,zoom
  m = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return `${m[1]},${m[2]}`;
  return null;
}

// يستخرج اسم المكان من URL طويل بنمط /maps/place/<encoded_name>/...
// مفيد جداً لـ embed: استخدامه كـ q=<name> يجعل Google يعرض POI marker
// الرسمي بدلاً من pin جنريك على إحداثيات منفصلة.
function extractPlaceName(url: string): string | null {
  const m = url.match(/\/maps\/place\/([^/?]+)/);
  if (!m) return null;
  try {
    let name = decodeURIComponent(m[1]).replace(/\+/g, " ");
    // أزل علامات الاتجاه (LRM/RLM/LRE/RLE/PDF/LRO/RLO)
    name = name.replace(/[‎‏‪-‮]/g, "").trim();
    return name || null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const url = new URL(req.url);
    const target = url.searchParams.get("url");
    if (!target) {
      return new Response(JSON.stringify({ error: "url parameter required" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // تحقق أن الـ URL لخادم Google معروف — يمنع SSRF لأي مضيف عشوائي
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return new Response(JSON.stringify({ error: "invalid url" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
      return new Response(JSON.stringify({ error: "host not allowed" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // إذا الإحداثيات موجودة في الـ URL أصلاً، نرجعها فوراً (لا داعي لـ network call)
    const directCoords = extractCoords(target);
    const directName = extractPlaceName(target);
    if (directCoords || directName) {
      return new Response(
        JSON.stringify({
          coords: directCoords,
          place_name: directName,
          long_url: target,
        }),
        {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=86400",
          },
        },
      );
    }

    // نتبع redirect واحد (Google غالباً يعطي 302 إلى الرابط الطويل)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    let longUrl = target;
    try {
      const resp = await fetch(target, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; Marma/1.0; +https://marma.help)",
          "Accept-Language": "ar,en;q=0.9",
        },
        signal: controller.signal,
      });

      const location = resp.headers.get("location");
      if (location) {
        longUrl = location;
      } else if (resp.status === 200) {
        // أحياناً Google يعيد HTML مباشرة بدون redirect — ابحث عن إحداثيات/اسم في الـ body
        const text = await resp.text();
        const bodyCoords = extractCoords(text);
        const bodyName = extractPlaceName(text);
        if (bodyCoords || bodyName) {
          clearTimeout(timeoutId);
          return new Response(
            JSON.stringify({
              coords: bodyCoords,
              place_name: bodyName,
              long_url: target,
            }),
            {
              status: 200,
              headers: {
                ...CORS_HEADERS,
                "Content-Type": "application/json",
                "Cache-Control": "public, max-age=86400",
              },
            },
          );
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }

    const coords = extractCoords(longUrl);
    const placeName = extractPlaceName(longUrl);
    return new Response(
      JSON.stringify({ coords, place_name: placeName, long_url: longUrl }),
      {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=86400",
        },
      },
    );
  } catch (err) {
    console.error("resolve-maps-url failed:", err);
    return new Response(
      JSON.stringify({ error: String(err && (err as Error).message || err) }),
      {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      },
    );
  }
});
