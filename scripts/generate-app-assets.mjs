// يولّد أصول التطبيق الأصلي (أيقونة + شاشتا إقلاق) من علامة مَرمى المتّجهة.
//
// المصدر الواحد للحقيقة هو مسار العلامة في assets/pwa/icon-maskable.svg — نستخرجه
// ونعيد تركيبه بالمقاسات والخلفيات التي يطلبها كل متجر، بدل الاحتفاظ بنسخ PNG
// يدوية تتباعد عن الشعار عند أول تعديل عليه.
//
// المخرجات في resources/ ثم يتولّى @capacitor/assets توليد كل المقاسات:
//   icon.png            1024×1024  خلفية خضراء وعلامة بيضاء (بلا شفافية ولا حواف
//                                  مدوّرة — النظامان يطبّقان قناعهما بأنفسهما،
//                                  والتدوير المُخبوز يظهر مزدوجاً على iOS)
//   splash.png          2732×2732  خلفية فاتحة وعلامة خضراء
//   splash-dark.png     2732×2732  خلفية داكنة وعلامة بيضاء
//
// الاستخدام: node scripts/generate-app-assets.mjs

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'resources');

const BRAND_GREEN = '#0F9D58';
const LIGHT_BG = '#FAFAF7';
const DARK_BG = '#14160F';

// دقة عالية للعلامة قبل التصغير — نرسمها مرّة ثم نعيد استخدامها في كل مخرج
const MARK_RENDER = 2048;

// نستخرج مسار العلامة وتحويله كما هما من ملف الشعار، فلا نعيد كتابة إحداثيات
// بيدنا (أي رقم منسوخ يدوياً هنا يصبح فرقاً صامتاً بين الشعار والأيقونة).
async function loadMarkSvg() {
  const svg = await readFile(resolve(ROOT, 'assets/pwa/icon-maskable.svg'), 'utf8');
  const d = /<path[^>]*\sd="([^"]+)"/s.exec(svg);
  if (!d) throw new Error('لم يُعثر على مسار العلامة في assets/pwa/icon-maskable.svg');
  const g = /<g transform="([^"]+)"/.exec(svg);
  const viewBox = /viewBox="([^"]+)"/.exec(svg);
  return {
    d: d[1],
    transform: g ? g[1] : '',
    viewBox: viewBox ? viewBox[1] : '0 0 1080 1080'
  };
}

// ترسم العلامة وحدها على خلفية شفّافة، ثم تقتطع الفراغ المحيط بها.
//
// الاقتطاع هو جوهر الأمر: العلامة في ملف الشعار موضوعة داخل مربّع ١٠٨٠ بإزاحة
// داخلية مقصودة لأيقونة الويب، فحساب مركزها ومقاسها رياضياً يعني تركيب تحويلات
// فوق تحويلات — وأول محاولة خرجت صغيرة ومنزاحة فعلاً. القياس بعد الرسم يعطي
// الحدود الحقيقية بلا أي حساب: ما نراه هو ما نضعه.
async function renderTrimmedMark(mark, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${MARK_RENDER}" height="${MARK_RENDER}" viewBox="${mark.viewBox}">
  <g transform="${mark.transform}"><path fill="${color}" d="${mark.d}"/></g>
</svg>`;
  // threshold أكبر من صفر ضروري: threshold:0 لا يقتطع شيئاً (يرجع المربّع كما هو)
  // فتخرج الأيقونة صغيرةً ومنزاحةً. و١ يكفي لأن الخلفية شفّافة تماماً.
  const trimmed = await sharp(Buffer.from(svg))
    .trim({ threshold: 1 })
    .png()
    .toBuffer({ resolveWithObject: true });
  return trimmed;   // { data, info: { width, height } }
}

// تركّب العلامة المقتطعة في وسط مربّع بلون خلفية، بحيث يشغل بعدها الأطول
// نسبةَ `scale` من ضلع المربّع.
async function compose({ size, background, markColor, mark, scale, file }) {
  const { data, info } = await renderTrimmedMark(mark, markColor);
  const longest = Math.max(info.width, info.height);
  const factor = (size * scale) / longest;
  const w = Math.max(1, Math.round(info.width * factor));
  const h = Math.max(1, Math.round(info.height * factor));
  const resized = await sharp(data).resize(w, h).png().toBuffer();

  const buf = await sharp({
    create: { width: size, height: size, channels: 4, background }
  })
    .composite([{
      input: resized,
      left: Math.round((size - w) / 2),
      top: Math.round((size - h) / 2)
    }])
    .flatten({ background })   // بلا قناة شفافية: أبل ترفض أيقونات شفّافة
    .png({ compressionLevel: 9 })
    .toBuffer();

  await writeFile(resolve(OUT, file), buf);
  return { bytes: buf.length, markSize: `${w}×${h}` };
}

// أيقونة إشعارات أندرويد — حالة مختلفة عن كل ما سبق فلها دالتها.
//
// أندرويد ٥+ يتجاهل ألوان أيقونة الإشعار ويرسم قناة الشفافية وحدها مصبوغةً
// بلون التطبيق. فأي أيقونة ملوّنة أو ذات خلفية مصمتة تظهر **مربّعاً أبيض** في
// شريط الحالة — وهو أشهر عيبٍ مرئيّ في إشعارات أندرويد. لذلك: العلامة بيضاء
// على شفافيةٍ كاملة، بلا خلفية ولا flatten.
//
// وتذهب مباشرةً إلى موارد المشروع (لا إلى resources/) لأن @capacitor/assets لا
// يولّد هذا النوع، فهي أصلٌ مصدريٌّ يُلتزم في المستودع.
async function generateNotificationIcon(mark) {
  // المقاسات التي يطلبها أندرويد لأيقونة شريط الحالة (dp ثابت = 24)
  const DENSITIES = { mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 };
  const { data, info } = await renderTrimmedMark(mark, '#FFFFFF');
  const longest = Math.max(info.width, info.height);

  for (const [density, size] of Object.entries(DENSITIES)) {
    const dir = resolve(ROOT, `android/app/src/main/res/drawable-${density}`);
    await mkdir(dir, { recursive: true });

    // العلامة تشغل ٨٠٪ من المربّع: أندرويد يضيف حشوته الخاصة، والملء الكامل
    // يجعلها تلامس حدود الدائرة في مركز الإشعارات.
    const factor = (size * 0.8) / longest;
    const w = Math.max(1, Math.round(info.width * factor));
    const h = Math.max(1, Math.round(info.height * factor));
    const resized = await sharp(data).resize(w, h).png().toBuffer();

    const buf = await sharp({
      create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
      .composite([{ input: resized, left: Math.round((size - w) / 2), top: Math.round((size - h) / 2) }])
      .png({ compressionLevel: 9 })
      .toBuffer();

    await writeFile(resolve(dir, 'ic_stat_notify.png'), buf);
  }
  return Object.keys(DENSITIES).length;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const mark = await loadMarkSvg();

  const targets = [
    // الأيقونة: العلامة تشغل ٦٢٪ من الضلع. أكبر من ذلك يقصّه قناع أندرويد
    // الدائري عند الحواف، وأصغر يجعلها باهتة بين أيقونات الشاشة الرئيسية.
    { file: 'icon.png', size: 1024, background: BRAND_GREEN, markColor: '#FFFFFF', scale: 0.62 },
    // شاشة الإقلاق مربّعة ٢٧٣٢ لأنها تُقتطع للوسط على كل نسب الشاشات، فتبقى
    // العلامة عند ٢٢٪ كاملةً على الآيباد الأفقي وعلى الجوال الطويل معاً.
    { file: 'splash.png', size: 2732, background: LIGHT_BG, markColor: BRAND_GREEN, scale: 0.22 },
    { file: 'splash-dark.png', size: 2732, background: DARK_BG, markColor: '#FFFFFF', scale: 0.22 }
  ];

  console.log('[assets] المصادر جاهزة في resources/');
  for (const t of targets) {
    const { bytes, markSize } = await compose({ ...t, mark });
    console.log(`   ${t.file.padEnd(17)} ${t.size}×${t.size}  العلامة ${markSize}  ${(bytes / 1024).toFixed(0)} ك.ب`);
  }

  const count = await generateNotificationIcon(mark);
  console.log(`   ic_stat_notify.png  ظلّية بيضاء × ${count} كثافات → android/…/res/drawable-*/`);
}

main().catch((err) => {
  console.error('[assets] فشل:', err.message);
  process.exit(1);
});
