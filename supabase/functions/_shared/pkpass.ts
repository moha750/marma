// بناء وتوقيع حزم Apple Wallet (.pkpass).
// ----------------------------------------------------------------------------
// دالة signManifest أدناه هي حرفياً ما أُثبت على جهاز حقيقي في 2026-07-31:
// وقّعت manifest، قَبِله OpenSSL، وأُضيفت البطاقة الناتجة إلى Apple Wallet
// على iPhone بعربية سليمة. لا تُعدّلها دون إعادة الاختبار على جهاز.
//
// لا اعتماد على أي واجهة خاصة بـ Node: crypto.subtle للـ SHA-1،
// CompressionStream للـ PNG، وكاتب ZIP يدوي — فتعمل في Deno كما هي.
//
// ملاحظتان تُسقطان الحزمة عند آبل إن أُهملتا:
//  1) manifest يستخدم SHA-1 تحديداً (لا SHA-256) رغم أن التوقيع نفسه SHA-256.
//  2) الحزمة يجب أن تكون مسطّحة تماماً: بلا مجلدات ولا __MACOSX ولا .DS_Store،
//     وملف signature نفسه لا يدخل في manifest.

import forge from "npm:node-forge@1.3.1";

export interface PassCerts {
  certPem: string;   // شهادة الـ Pass Type ID
  keyPem: string;    // مفتاحها الخاص
  wwdrPem: string;   // شهادة أبل الوسيطة G4
}

// ─── SHA-1 لبصمات manifest ───────────────────────────────────────────────

async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── التوقيع (PKCS#7 منفصل، DER) ─────────────────────────────────────────

export function signManifest(manifestBytes: Uint8Array, certs: PassCerts): Uint8Array {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(forge.util.binary.raw.encode(manifestBytes));

  const cert = forge.pki.certificateFromPem(certs.certPem);
  p7.addCertificate(cert);
  p7.addCertificate(forge.pki.certificateFromPem(certs.wwdrPem));

  p7.addSigner({
    key: forge.pki.privateKeyFromPem(certs.keyPem),
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });

  p7.sign({ detached: true });
  return forge.util.binary.raw.decode(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

// ─── كاتب ZIP (STORE فقط) ────────────────────────────────────────────────
// طريقة STORE عمداً: الحزمة أصلاً صغيرة (~10 ك.ب) وصورها PNG مضغوطة سلفاً،
// فالضغط يضيف تعقيداً بلا مكسب — والمقابل بساطة يمكن التحقّق منها بالعين.

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipStore(files: Record<string, Uint8Array>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const [name, data] of Object.entries(files)) {
    const nameBuf = enc.encode(name);
    const crc = crc32(data);

    const lh = new Uint8Array(30);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);          // STORE
    lv.setUint16(12, 0x2821, true);    // تاريخ ثابت ⇒ حزمة قابلة لإعادة الإنتاج
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBuf.length, true);
    locals.push(lh, nameBuf, data);

    const ch = new Uint8Array(46);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(14, 0x2821, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBuf.length, true);
    cv.setUint32(42, offset, true);
    centrals.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + data.length;
  }

  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, Object.keys(files).length, true);
  ev.setUint16(10, Object.keys(files).length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, eocd];
  const total = parts.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

// ─── مولّد PNG ───────────────────────────────────────────────────────────
// نولّد الأيقونة دائماً بدل الاعتماد على رفع المالك: آبل ترفض الحزمة بلا
// icon.png، وشعار مالك مفقود أو بصيغة خاطئة يجب ألّا يمنع إصدار بطاقة.

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const typeBuf = enc.encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(typeBuf, 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(typeBuf.length + data.length);
  crcInput.set(typeBuf, 0);
  crcInput.set(data, typeBuf.length);
  view.setUint32(8 + data.length, crc32(crcInput), false);
  return out;
}

async function deflateZlib(raw: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");   // 'deflate' = إطار zlib، وهو ما يطلبه IDAT
  const writer = cs.writable.getWriter();
  writer.write(raw as BufferSource);
  writer.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(buf);
}

export interface PngOptions {
  circle?: [number, number, number];   // دائرة بلون مختلف في المنتصف
  dots?: { total: number; filled: number; color: [number, number, number] };
}

export async function pngSolid(
  w: number, h: number, rgb: [number, number, number], opts: PngOptions = {},
): Promise<Uint8Array> {
  const stride = 1 + w * 4;
  const raw = new Uint8Array(h * stride);

  const cx = w / 2, cy = h / 2, rad = Math.min(w, h) * 0.3;
  // عدّاد الأختام: دوائر أفقية بعدد العتبة، المملوءة منها بلون النص
  const dots = opts.dots;
  const dotR = dots ? Math.min(h * 0.22, (w / (dots.total + 1)) * 0.34) : 0;
  const gap = dots ? w / (dots.total + 1) : 0;

  for (let y = 0; y < h; y++) {
    const off = y * stride;
    raw[off] = 0;   // filter: none
    for (let x = 0; x < w; x++) {
      const p = off + 1 + x * 4;
      let [r, g, b] = rgb;

      if (opts.circle && (x - cx) ** 2 + (y - cy) ** 2 < rad * rad) {
        [r, g, b] = opts.circle;
      }
      if (dots) {
        for (let i = 0; i < dots.total; i++) {
          const dx = gap * (i + 1), dy = h / 2;
          const d2 = (x - dx) ** 2 + (y - dy) ** 2;
          if (d2 < dotR * dotR) {
            if (i < dots.filled) [r, g, b] = dots.color;
          } else if (d2 < (dotR + 1.5) ** 2) {
            [r, g, b] = dots.color;   // حلقة رفيعة للفارغة
          }
        }
      }

      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = 255;
    }
  }

  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, w, false);
  iv.setUint32(4, h, false);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // RGBA
  const idat = await deflateZlib(raw);

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

// ─── التركيب النهائي ─────────────────────────────────────────────────────

export async function buildPkpass(
  files: Record<string, Uint8Array>,
  certs: PassCerts,
): Promise<Uint8Array> {
  const manifest: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) {
    manifest[name] = await sha1Hex(bytes);
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  const signature = signManifest(manifestBytes, certs);

  return zipStore({
    ...files,
    "manifest.json": manifestBytes,
    "signature": signature,
  });
}

// ─── أدوات مساعدة ────────────────────────────────────────────────────────

// "#0F3D2E" → [15, 61, 46]
export function hexToRgb(hex: string): [number, number, number] {
  const s = (hex || "#000000").replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.substring(i, i + 2), 16) || 0) as [number, number, number];
}

// آبل تطلب الألوان بصيغة rgb(r,g,b)
export function rgbCss(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${r},${g},${b})`;
}

// جلب صورة المالك من Storage. أي فشل ⇒ null والمولّد يتكفّل ببديل —
// شعار مفقود يجب ألّا يمنع عميلاً من الحصول على بطاقته.
export async function fetchPng(url?: string | null): Promise<Uint8Array | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    // تحقّق من التوقيع السحري لا من Content-Type: الأخير يكذب أحياناً
    const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 &&
                  bytes[2] === 0x4e && bytes[3] === 0x47;
    return isPng ? bytes : null;
  } catch {
    return null;
  }
}
