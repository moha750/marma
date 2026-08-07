// يولّد الأصول المرئية التي يطلبها المتجران — من نفس مصادر الشعار المتّجهة.
//
// لماذا سكربت لا تصميم يدوي؟ لأن هذه الأصول تُطلَب مرّة عند الإطلاق ثم عند كل
// تغيير في الهوية، ونسخةٌ يدوية واحدة تتباعد عن الشعار عند أول تعديل عليه —
// فتصبح أيقونة المتجر مخالفةً لأيقونة التطبيق نفسه.
//
// المخرجات في store-assets/ (في .gitignore — مولَّدة):
//   play-icon-512.png       512×512    أيقونة متجر Play (بلا شفافية)
//   play-feature-1024.png   1024×500   صورة الغلاف — إلزامية في Play
//   appstore-icon-1024.png  1024×1024  أيقونة App Store (بلا شفافية ولا تدوير)
//
// الاستخدام: node scripts/generate-store-assets.mjs

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'store-assets');

const BRAND_GREEN = '#0F9D58';
const DEEP_GREEN = '#0B7B45';

// نقرأ ملفات الشعار كما هي — لا نعيد رسم شيء بأيدينا
async function svgOf(name) {
  return readFile(resolve(ROOT, 'assets', name), 'utf8');
}

// يقتطع الهوامش الشفّافة حول الرسم ثم يعيده كصورة بأبعادها الحقيقية
async function renderTrimmed(svg, renderWidth, recolor) {
  let s = svg;
  if (recolor) {
    s = s.replace(/fill:#[0-9A-Fa-f]{3,6}/g, `fill:${recolor}`)
         .replace(/fill="#[0-9A-Fa-f]{3,6}"/g, `fill="${recolor}"`);
  }
  return sharp(Buffer.from(s), { density: 600 })
    .resize({ width: renderWidth })
    .trim({ threshold: 1 })
    .png()
    .toBuffer({ resolveWithObject: true });
}

// يضع رسماً مقتطعاً في وسط لوحة ملوّنة
async function centerOn({ width, height, background, art, scale, offsetY = 0 }) {
  const { data, info } = art;
  const factor = Math.min(
    (width * scale) / info.width,
    (height * scale) / info.height
  );
  const w = Math.max(1, Math.round(info.width * factor));
  const h = Math.max(1, Math.round(info.height * factor));
  const resized = await sharp(data).resize(w, h).png().toBuffer();

  return sharp({ create: { width, height, channels: 4, background } })
    .composite([{
      input: resized,
      left: Math.round((width - w) / 2),
      top: Math.round((height - h) / 2) + offsetY
    }])
    // بلا قناة شفافية: المتجران يرفضان أيقونات شفّافة
    .flatten({ background })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const markSvg = await svgOf('logo-mark.svg');
  const wordSvg = await svgOf('logo-wordmark.svg');

  const markWhite = await renderTrimmed(markSvg, 1600, '#FFFFFF');
  const wordWhite = await renderTrimmed(wordSvg, 1600, '#FFFFFF');

  const outputs = [];

  // ── أيقونة متجر Play ──
  // العلامة عند ٦٢٪ — نفس نسبة أيقونة التطبيق، فتتطابق صفحة المتجر مع ما
  // يراه المستخدم على شاشته بعد التثبيت.
  outputs.push(['play-icon-512.png', await centerOn({
    width: 512, height: 512, background: BRAND_GREEN, art: markWhite, scale: 0.62
  })]);

  // ── أيقونة App Store ──
  outputs.push(['appstore-icon-1024.png', await centerOn({
    width: 1024, height: 1024, background: BRAND_GREEN, art: markWhite, scale: 0.62
  })]);

  // ── صورة غلاف Play ──
  // تُعرَض مقصوصةً بنسب مختلفة على أجهزة مختلفة، ويُغطّى جزء منها بزرّ التشغيل
  // في بعض التخطيطات. لذلك: الشعار في الوسط تماماً وبمساحة ٥٥٪ فقط — أي قصٍّ
  // معقول يُبقيه كاملاً.
  const feature = await sharp({
    create: { width: 1024, height: 500, channels: 4, background: DEEP_GREEN }
  })
    .composite([
      // تدرّج خفيف يعطي عمقاً بدل مسطّح أخضر
      {
        input: Buffer.from(
          `<svg width="1024" height="500" xmlns="http://www.w3.org/2000/svg">
             <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
               <stop offset="0%" stop-color="${BRAND_GREEN}"/>
               <stop offset="100%" stop-color="${DEEP_GREEN}"/>
             </linearGradient></defs>
             <rect width="1024" height="500" fill="url(#g)"/>
           </svg>`
        ),
        top: 0, left: 0
      }
    ])
    .png()
    .toBuffer();

  // الشعار الكامل (العلامة + الاسم) لا الكلمة وحدها — الغلاف أوّل ما يراه
  // المتصفّح في صفحة المتجر، والكلمة المجرّدة لا تُعرّف بالتطبيق.
  const lockupWhite = await renderTrimmed(await svgOf('logo.svg'), 1600, '#FFFFFF');
  const { data: lData, info: lInfo } = lockupWhite;

  const lockupH = 230;                                   // ٤٦٪ من الارتفاع
  const lFactor = lockupH / lInfo.height;
  const lw = Math.round(lInfo.width * lFactor);
  const lh = Math.round(lInfo.height * lFactor);
  const lockupResized = await sharp(lData).resize(lw, lh).png().toBuffer();

  // الجملة التعريفية — تحقّقنا أن librsvg يُشكّل العربية ويصلها صحيحاً
  const tagline = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="70">
       <text x="512" y="48" text-anchor="middle" direction="rtl"
             font-family="sans-serif" font-size="40" font-weight="600"
             fill="#FFFFFF" fill-opacity="0.92">كل حجوزاتك .. في مَرمى واحد</text>
     </svg>`
  );

  outputs.push(['play-feature-1024.png', await sharp(feature)
    .composite([
      // الشعار أعلى المنتصف والجملة تحته — والمجموعة كلها داخل الـ٦٠٪ الوسطى
      // لأن Play يقصّ الغلاف بنسبٍ مختلفة على الأجهزة المختلفة.
      { input: lockupResized, left: Math.round((1024 - lw) / 2), top: 95 },
      { input: tagline, left: 0, top: 350 }
    ])
    .flatten({ background: DEEP_GREEN })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer()]);

  for (const [name, buf] of outputs) {
    await writeFile(resolve(OUT, name), buf);
    const meta = await sharp(buf).metadata();
    console.log(`   ${name.padEnd(26)} ${meta.width}×${meta.height}  ${(buf.length / 1024).toFixed(0)} ك.ب  ${meta.hasAlpha ? '⚠ شفافية' : 'بلا شفافية ✓'}`);
  }
  console.log(`\n[store] ${outputs.length} أصول في store-assets/`);
}

main().catch((err) => {
  console.error('[store] فشل:', err.message);
  process.exit(1);
});
