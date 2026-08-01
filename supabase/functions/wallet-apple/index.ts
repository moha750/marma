// Apple Wallet — إصدار بطاقات الولاء وخدمة PassKit.
// ----------------------------------------------------------------------------
// المسارات:
//   GET  /wallet-apple/pkpass/<serial>.<sig>      تنزيل البطاقة (يفتحه العميل)
//   POST /wallet-apple/v1/devices/{d}/registrations/{ptid}/{serial}   تسجيل جهاز
//   DEL  ‏             نفسه                                            إلغاء التسجيل
//   GET  /wallet-apple/v1/devices/{d}/registrations/{ptid}?passesUpdatedSince=
//   GET  /wallet-apple/v1/passes/{ptid}/{serial}   أحدث نسخة (يحترم If-Modified-Since)
//   POST /wallet-apple/v1/log                      أخطاء آبل — وسيلة التشخيص الوحيدة
//
// الأسرار المطلوبة (Supabase → Edge Functions → Secrets):
//   APPLE_PASS_CERT_PEM  APPLE_PASS_KEY_PEM  APPLE_WWDR_PEM
//   APPLE_TEAM_ID        APPLE_PASS_TYPE_ID  WALLET_AUTH_SECRET  QR_SECRET
//   PUBLIC_SITE_URL (اختياري، افتراضه https://marma.help)
//
// نموذج المصادقة: لا توكن مُخزَّن. authenticationToken مُشتقّ حسابياً
// HMAC(secret, serial‖token_version) فيتحقّق بلا استعلام قاعدة، ويُبطَل بزيادة
// token_version على البطاقة. ونفس المبدأ لتوقيع رابط التنزيل ومحتوى الـ QR.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildPkpass, pngSolid, fetchPng, hexToRgb, rgbCss } from "../_shared/pkpass.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TEAM_ID = Deno.env.get("APPLE_TEAM_ID") ?? "";
const PASS_TYPE_ID = Deno.env.get("APPLE_PASS_TYPE_ID") ?? "pass.help.marma.loyalty";
const SITE = Deno.env.get("PUBLIC_SITE_URL") ?? "https://marma.help";

const CERTS = {
  certPem: Deno.env.get("APPLE_PASS_CERT_PEM") ?? "",
  keyPem: Deno.env.get("APPLE_PASS_KEY_PEM") ?? "",
  wwdrPem: Deno.env.get("APPLE_WWDR_PEM") ?? "",
};

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ─── التواقيع ────────────────────────────────────────────────────────────

async function hmac(secretName: string, message: string): Promise<string> {
  const secret = Deno.env.get(secretName) ?? "";
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const linkSig = (serial: string) => hmac("QR_SECRET", serial);
const authToken = (serial: string, version: number) =>
  hmac("WALLET_AUTH_SECRET", `${serial}:${version}`);

// مقارنة ثابتة الزمن — المقارنة العادية تُسرّب طول البادئة الصحيحة
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── جلب البطاقة كاملةً ──────────────────────────────────────────────────

interface CardRow {
  id: string; serial: string; balance: number; rewards_available: number;
  redeem_pin: string | null; status: string; token_version: number;
  pass_updated_at: string; tenant_id: string;
  customers: { full_name: string } | null;
  loyalty_programs: Record<string, unknown> | null;
  tenants: { name: string } | null;
}

async function loadCard(serial: string): Promise<CardRow | null> {
  const { data, error } = await db
    .from("loyalty_cards")
    .select(`id, serial, balance, rewards_available, redeem_pin, status, token_version,
             pass_updated_at, tenant_id,
             customers ( full_name ),
             loyalty_programs ( * ),
             tenants ( name )`)
    .eq("serial", serial)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as CardRow;
}

async function availableReward(cardId: string) {
  const { data } = await db
    .from("loyalty_rewards")
    .select("code, label")
    .eq("card_id", cardId).eq("status", "available")
    .order("issued_at", { ascending: true })
    .limit(1).maybeSingle();
  return data;
}

// أقرب ١٠ مواقع للملعب — تجعل البطاقة تقترح نفسها على شاشة القفل عند وصول العميل
async function tenantLocations(tenantId: string, tenantName: string) {
  const { data } = await db
    .from("fields")
    .select("latitude, longitude")
    .eq("tenant_id", tenantId).eq("is_active", true)
    .not("latitude", "is", null).not("longitude", "is", null)
    .limit(10);
  return (data ?? []).map((f: { latitude: number; longitude: number }) => ({
    latitude: Number(f.latitude),
    longitude: Number(f.longitude),
    relevantText: `بطاقتك جاهزة — أنت عند ${tenantName}`,
  }));
}

// ─── بناء البطاقة ────────────────────────────────────────────────────────

async function buildPassBundle(card: CardRow): Promise<Uint8Array> {
  const prog = (card.loyalty_programs ?? {}) as Record<string, string | number | null>;
  const tenantName = card.tenants?.name ?? "ملعبك";
  const member = card.customers?.full_name ?? "عضو";

  const bg = String(prog.brand_bg ?? "#0F3D2E");
  const fg = String(prog.brand_fg ?? "#FFFFFF");
  const labelColor = String(prog.brand_label ?? "#C9D6CF");
  const threshold = Number(prog.reward_threshold ?? 10);
  const balance = Math.max(0, Math.round(Number(card.balance ?? 0)));
  const template = String(prog.template ?? "classic");

  const reward = await availableReward(card.id);
  const locations = await tenantLocations(card.tenant_id, tenantName);
  const [r, g, b] = hexToRgb(bg);
  const fgRgb = hexToRgb(fg);

  // الصور: الأيقونة مولَّدة دائماً (آبل ترفض الحزمة بدونها)، والشعار من المالك
  // إن كان PNG صالحاً وإلا فبديل مولَّد — بطاقة العميل لا تُحجب بسبب شعار ناقص.
  const files: Record<string, Uint8Array> = {
    "icon.png": await pngSolid(29, 29, [r, g, b], { circle: fgRgb }),
    "icon@2x.png": await pngSolid(58, 58, [r, g, b], { circle: fgRgb }),
    "icon@3x.png": await pngSolid(87, 87, [r, g, b], { circle: fgRgb }),
  };

  const logo = await fetchPng(prog.logo_url as string | null);
  if (logo) {
    files["logo.png"] = logo;
  } else {
    files["logo.png"] = await pngSolid(160, 50, [r, g, b], {});
  }

  if (template === "stamps") {
    const dots = { total: Math.min(threshold, 20), filled: Math.min(balance, threshold), color: fgRgb };
    files["strip.png"] = await pngSolid(375, 123, [r, g, b], { dots });
    files["strip@2x.png"] = await pngSolid(750, 246, [r, g, b], {
      dots: { ...dots },
    });
  } else if (template === "photo") {
    const hero = await fetchPng(prog.hero_url as string | null);
    if (hero) files["strip@2x.png"] = hero;
  }

  const secondary: Record<string, string>[] = [
    { key: "member", label: "العضو", value: member },
  ];
  if (reward) {
    secondary.push({ key: "code", label: "رمز المكافأة", value: reward.code });
  } else {
    secondary.push({
      key: "left", label: "الباقي",
      value: `${Math.max(0, threshold - balance)} حجوزات`,
    });
  }

  const backFields: Record<string, string>[] = [];
  if (prog.redeem_pin_enabled && card.redeem_pin) {
    backFields.push({ key: "pin", label: "رمز الاستبدال", value: card.redeem_pin });
  }
  backFields.push({ key: "book", label: "احجز الآن", value: `${SITE}/book?t=${card.tenant_id}` });
  if (prog.reward_terms) {
    backFields.push({ key: "terms", label: "شروط البرنامج", value: String(prog.reward_terms) });
  }
  backFields.push({
    key: "out", label: "إلغاء الاشتراك",
    value: `${SITE}/card?c=${card.serial}.${await linkSig(card.serial)}#out`,
  });

  const pass = {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE_ID,
    teamIdentifier: TEAM_ID,
    organizationName: `${tenantName} — بواسطة مَرمى`,
    description: `بطاقة ولاء ${tenantName}`,
    serialNumber: card.serial,
    webServiceURL: `${SITE}/api/wallet`,
    authenticationToken: await authToken(card.serial, card.token_version),
    backgroundColor: rgbCss(bg),
    foregroundColor: rgbCss(fg),
    labelColor: rgbCss(labelColor),
    logoText: tenantName,
    sharingProhibited: true,
    ...(locations.length ? { locations, maxDistance: 300 } : {}),
    storeCard: {
      headerFields: [{ key: "bal", label: "الأختام", value: `${balance} / ${threshold}` }],
      primaryFields: [{
        key: "reward",
        label: reward ? "مكافأة جاهزة" : "المكافأة",
        value: reward ? reward.label : String(prog.reward_label ?? "مكافأة"),
      }],
      secondaryFields: secondary,
      backFields,
    },
    barcodes: [{
      format: "PKBarcodeFormatQR",
      message: `MRM1:${card.serial}:${await linkSig(card.serial)}`,
      messageEncoding: "iso-8859-1",
      altText: card.serial.substring(0, 8),
    }],
  };

  files["pass.json"] = new TextEncoder().encode(JSON.stringify(pass));
  return await buildPkpass(files, CERTS);
}

// ─── المسارات ────────────────────────────────────────────────────────────

function passResponse(bytes: Uint8Array, lastModified: string): Response {
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": 'attachment; filename="marma-loyalty.pkpass"',
      "Last-Modified": new Date(lastModified).toUTCString(),
      "Cache-Control": "no-store",
    },
  });
}

// Authorization: ApplePass <token>
async function checkApplePass(req: Request, card: CardRow): Promise<boolean> {
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("ApplePass ")) return false;
  const expected = await authToken(card.serial, card.token_version);
  return safeEqual(header.slice("ApplePass ".length).trim(), expected);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // المسار يصل بثلاث صور مختلفة حسب المنفذ:
  //   /functions/v1/wallet-apple/...  ← نداء مباشر على Supabase
  //   /api/wallet/...                 ← عبر وسيط Cloudflare (وهو ما يُخبز في البطاقات)
  //   /wallet-apple/...               ← تشغيل محلي بـ supabase functions serve
  // فنرسو على أول جزء يطابق اسم الدالة بدل قصّ بادئة ثابتة — قصّ البادئة كان
  // يفشل صامتاً على الصورة الأولى فتسقط كل المسارات إلى 404.
  const segs = url.pathname.split("/").filter(Boolean);
  const anchor = segs.findIndex((s) => s === "wallet-apple" || s === "wallet");
  const parts = anchor >= 0 ? segs.slice(anchor + 1) : segs;

  try {
    // ── تنزيل البطاقة: /pkpass/<serial>.<sig> ──
    if (req.method === "GET" && parts[0] === "pkpass" && parts[1]) {
      // يقبل «serial» و«serial.signature» معاً.
      //
      // لماذا التوقيع اختياري؟ الرقم التسلسلي ٢٤ خانة سداسية عشرية = ٩٦ بت
      // عشوائية، فهو نفسه مفتاح الوصول ولا يُخمَّن. والتوقيع لا يضيف سرّية —
      // ومن يملكه يملك السلسلة كاملة أصلاً. اشتراطه كان يكسر الرابط الذي
      // ترسله اللوحة عبر واتساب، لأنها لا تملك السرّ لتوقّعه. ونفس المنطق
      // مطبَّق سلفاً في loyalty_public_card. فإن وُجد تحقّقنا منه، وإلا كفى
      // الشكل الصارم للرقم.
      const raw = parts[1].replace(/\.pkpass$/, "");
      const dot = raw.indexOf(".");
      const serial = (dot === -1 ? raw : raw.slice(0, dot)).toLowerCase();
      const sig = dot === -1 ? "" : raw.slice(dot + 1);

      if (!/^[0-9a-f]{24}$/.test(serial)) return new Response("bad request", { status: 400 });
      if (sig && !safeEqual(sig, await linkSig(serial))) {
        return new Response("forbidden", { status: 403 });
      }

      const card = await loadCard(serial);
      if (!card) return new Response("not found", { status: 404 });
      if (card.status !== "active") return new Response("gone", { status: 410 });

      return passResponse(await buildPassBundle(card), card.pass_updated_at);
    }

    // ── PassKit: تسجيل جهاز / إلغاؤه ──
    // /v1/devices/{deviceLibraryId}/registrations/{passTypeId}/{serial}
    if (parts[0] === "v1" && parts[1] === "devices" && parts[3] === "registrations" && parts[5]) {
      const deviceId = parts[2];
      const serial = parts[5];
      const card = await loadCard(serial);
      if (!card) return new Response(null, { status: 404 });
      if (!await checkApplePass(req, card)) return new Response(null, { status: 401 });

      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const pushToken = String(body.pushToken ?? "");
        if (!pushToken) return new Response(null, { status: 400 });

        const { data: existing } = await db.from("wallet_apple_registrations")
          .select("id").eq("device_library_id", deviceId).eq("card_id", card.id).maybeSingle();

        await db.from("wallet_apple_registrations").upsert({
          card_id: card.id, device_library_id: deviceId, push_token: pushToken,
        }, { onConflict: "device_library_id,card_id" });

        return new Response(null, { status: existing ? 200 : 201 });
      }

      if (req.method === "DELETE") {
        await db.from("wallet_apple_registrations").delete()
          .eq("device_library_id", deviceId).eq("card_id", card.id);
        return new Response(null, { status: 200 });
      }
    }

    // ── PassKit: أي بطاقات تغيّرت على هذا الجهاز ──
    // /v1/devices/{deviceLibraryId}/registrations/{passTypeId}
    if (req.method === "GET" && parts[0] === "v1" && parts[1] === "devices"
        && parts[3] === "registrations" && !parts[5]) {
      const deviceId = parts[2];
      const since = url.searchParams.get("passesUpdatedSince");

      const { data } = await db.from("wallet_apple_registrations")
        .select("loyalty_cards ( serial, pass_updated_at )")
        .eq("device_library_id", deviceId);

      const rows = (data ?? [])
        .map((r) => (r as unknown as { loyalty_cards: { serial: string; pass_updated_at: string } }).loyalty_cards)
        .filter((c) => c && (!since || new Date(c.pass_updated_at) > new Date(since)));

      if (!rows.length) return new Response(null, { status: 204 });

      const lastUpdated = rows
        .map((c) => new Date(c.pass_updated_at).getTime())
        .reduce((a, b) => Math.max(a, b), 0);

      return Response.json({
        lastUpdated: new Date(lastUpdated).toISOString(),
        serialNumbers: rows.map((c) => c.serial),
      });
    }

    // ── PassKit: أحدث نسخة من البطاقة ──
    // /v1/passes/{passTypeId}/{serial}
    if (req.method === "GET" && parts[0] === "v1" && parts[1] === "passes" && parts[3]) {
      const card = await loadCard(parts[3]);
      if (!card) return new Response(null, { status: 404 });
      if (!await checkApplePass(req, card)) return new Response(null, { status: 401 });

      const since = req.headers.get("if-modified-since");
      if (since && new Date(card.pass_updated_at) <= new Date(since)) {
        return new Response(null, { status: 304 });
      }
      return passResponse(await buildPassBundle(card), card.pass_updated_at);
    }

    // ── PassKit: سجلّ أخطاء آبل ──
    // وسيلة التشخيص الوحيدة عند رفض جهازٍ للبطاقة: آبل لا تُظهر السبب للمستخدم
    if (req.method === "POST" && parts[0] === "v1" && parts[1] === "log") {
      const body = await req.json().catch(() => ({}));
      const logs: string[] = Array.isArray(body.logs) ? body.logs : [];
      for (const line of logs.slice(0, 20)) {
        console.error("[PassKit]", String(line).slice(0, 500));
      }
      return new Response(null, { status: 200 });
    }

    return new Response("not found", { status: 404 });
  } catch (err) {
    console.error("wallet-apple error:", err);
    return new Response("internal error", { status: 500 });
  }
});
