// يُحضّر لقطات الشاشة لمتجر Play من لقطات الأجهزة الخام.
//
// المشكلة التي يحلّها: شاشات الهواتف الحديثة طويلة (1080×2400 = نسبة 2.22)،
// ومتجر Play يرفض أي لقطة يزيد ضلعها الأطول عن **ضعف** الأقصر. فاللقطة الخام
// من أي جهاز حديث تُرفض — وهو رفضٌ يقع بعد رفع كل شيء، فيُعيدك خطوة للوراء.
//
// الحل: نضع اللقطة كاملةً (بلا قصّ يبتر المحتوى) على لوحة بنسبة 2:1 بالضبط،
// بخلفية بلون العلامة فتبدو مقصودة لا مبتورة.
//
// الاستخدام: node scripts/prepare-screenshots.mjs <ملف> [ملف...]
// المخرجات: store-assets/screenshots/

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'store-assets/screenshots');
const BRAND = '#0F9D58';

// أقصى نسبة يقبلها Play: الضلع الأطول ≤ ضعف الأقصر
const MAX_RATIO = 2.0;

async function prepare(file, index) {
  const img = sharp(file);
  const meta = await img.metadata();
  const ratio = meta.height / meta.width;

  let out;
  if (ratio <= MAX_RATIO) {
    out = await img.png().toBuffer();          // مقبولة كما هي
  } else {
    // نُبقي الارتفاع ونوسّع العرض حتى تصير النسبة 2:1 — بلا قصٍّ للمحتوى
    const targetW = Math.ceil(meta.height / MAX_RATIO);
    const pad = targetW - meta.width;
    out = await img
      .extend({
        left: Math.floor(pad / 2),
        right: Math.ceil(pad / 2),
        background: BRAND
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }

  const name = `${String(index + 1).padStart(2, '0')}-${basename(file, '.png')}.png`;
  await writeFile(resolve(OUT, name), out);
  const m = await sharp(out).metadata();
  return { name, from: `${meta.width}×${meta.height}`, to: `${m.width}×${m.height}`, ok: m.height / m.width <= MAX_RATIO };
}

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('الاستخدام: node scripts/prepare-screenshots.mjs <ملف.png> [ملفات...]');
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });
  for (let i = 0; i < files.length; i++) {
    const r = await prepare(files[i], i);
    console.log(`   ${r.ok ? '✓' : '✗'} ${r.name.padEnd(28)} ${r.from} → ${r.to}`);
  }
  console.log(`\n[shots] جاهزة في store-assets/screenshots/`);
}

main().catch((e) => { console.error('[shots] فشل:', e.message); process.exit(1); });
