// ينسخ مكتبات الطرف الثالث من node_modules إلى assets/vendor/ لتُخدَم من نطاقنا.
//
// لماذا لا CDN؟ ثلاثة أسباب، كلٌّ منها كافٍ وحده:
//   1) الإنتاج: كان lucide يُحمَّل بـ @latest — أي إصدار جديد من المكتبة يهبط على
//      مستخدمينا بلا مراجعة، وإصدار واحد سيّئ = تطبيق مكسور بلا نشرة منّا.
//   2) التوفّر: انقطاع jsdelivr أو unpkg (وقد حدث) = تعطّل كامل، لأن الملفات
//      ليست أصولاً كمالية بل عميل Supabase والتقويم والأيقونات.
//   3) المتاجر: أبل تمنع تنزيل كود تنفيذي وقت التشغيل (قاعدة 2.5.2)، فالنسخة
//      الأصلية يجب أن تحمل كل جافاسكربتها داخلها — وبلا شبكة أيضاً.
//
// الملفات المنسوخة مولَّدة (في .gitignore) — تُبنى من الإصدارات المثبَّتة في
// package.json عند كل بناء، فلا يمكن أن تتباعد عن التبعيات.
//
// الاستخدام: node scripts/sync-vendor.mjs   (يُشغَّل تلقائياً في dev و build)

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_DIR = resolve(ROOT, 'assets/vendor');

// كل مدخل: من أين نأخذ الملف، وباسم ماذا يُخدَم، وأي حزمة تحدّد إصداره.
const ASSETS = [
  {
    pkg: 'lucide',
    from: 'node_modules/lucide/dist/umd/lucide.min.js',
    to: 'lucide.min.js',
    global: 'lucide'
  },
  {
    pkg: '@supabase/supabase-js',
    from: 'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
    to: 'supabase.js',
    global: 'supabase'
  },
  {
    pkg: 'fullcalendar',
    from: 'node_modules/fullcalendar/index.global.min.js',
    to: 'fullcalendar.global.min.js',
    global: 'FullCalendar'
  },
  {
    // ملف اللغة يعيش في @fullcalendar/core (تبعية داخلية لحزمة fullcalendar)
    pkg: '@fullcalendar/core',
    from: 'node_modules/@fullcalendar/core/locales/ar.global.min.js',
    to: 'fullcalendar-locale-ar.global.min.js',
    global: 'FullCalendar.globalLocales'
  },
  {
    pkg: 'jsqr',
    from: 'node_modules/jsqr/dist/jsQR.js',
    to: 'jsQR.js',
    global: 'jsQR'
  }
];

async function pkgVersion(pkg) {
  const raw = await readFile(resolve(ROOT, 'node_modules', pkg, 'package.json'), 'utf8');
  return JSON.parse(raw).version;
}

async function main() {
  await mkdir(VENDOR_DIR, { recursive: true });

  const versions = {};
  const missing = [];

  for (const asset of ASSETS) {
    const src = resolve(ROOT, asset.from);
    try {
      await copyFile(src, resolve(VENDOR_DIR, asset.to));
      versions[asset.to] = {
        package: asset.pkg,
        version: await pkgVersion(asset.pkg),
        global: asset.global
      };
    } catch (err) {
      if (err.code === 'ENOENT') {
        missing.push(`${asset.from}  (حزمة ${asset.pkg})`);
      } else {
        throw err;
      }
    }
  }

  // فشل صريح وصاخب: ترقية تبعية تنقل ملفاتها الداخلية يجب أن توقف البناء، لا أن
  // تنشر تطبيقاً بلا أيقونات أو بلا عميل قاعدة بيانات.
  if (missing.length) {
    console.error(
      '\n❌ [vendor] ملفات مصدر مفقودة — شغّل npm install، أو راجع مسارات الملفات\n' +
        '   بعد ترقية الحزمة (المسارات الداخلية تتغيّر بين الإصدارات):\n' +
        missing.map((m) => `   • ${m}`).join('\n') +
        '\n'
    );
    process.exit(1);
  }

  await writeFile(
    resolve(VENDOR_DIR, 'VERSIONS.json'),
    JSON.stringify(versions, null, 2) + '\n',
    'utf8'
  );

  const summary = Object.entries(versions)
    .map(([file, meta]) => `${meta.package}@${meta.version} → ${file}`)
    .join('\n   ');
  console.log(`[vendor] ${ASSETS.length} مكتبات جاهزة في assets/vendor/\n   ${summary}`);
}

main().catch((err) => {
  console.error('[vendor] فشل غير متوقّع:', err);
  process.exit(1);
});
