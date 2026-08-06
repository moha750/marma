// يبني حزمة الويب الخاصة بالتطبيق الأصلي ثم يزامنها مع مشروعي iOS و Android.
//
// لماذا سكربت Node وليس سطرًا في package.json؟ لأن `MARMA_TARGET=native vite build`
// لا يعمل على Windows PowerShell، وهذا المشروع يُطوَّر على أكثر من نظام. Node
// يضبط المتغيّر بنفسه فيعمل السطر ذاته في كل مكان — بلا تبعية cross-env.
//
// الاستخدام:
//   node scripts/build-native.mjs            # يبني ويزامن المنصّتين
//   node scripts/build-native.mjs ios        # يزامن iOS فقط
//   node scripts/build-native.mjs android
//   node scripts/build-native.mjs --no-sync  # يبني dist-native فقط

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const node = process.execPath;

function run(cmd, args, extraEnv) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv }
  });
  if (res.error) {
    console.error(`\n❌ فشل تشغيل ${cmd}: ${res.error.message}`);
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error(`\n❌ ${cmd} ${args.join(' ')} انتهى بالرمز ${res.status}`);
    process.exit(res.status ?? 1);
  }
}

const arg = process.argv[2];
const platforms = arg === 'ios' || arg === 'android' ? [arg] : ['ios', 'android'];
const skipSync = arg === '--no-sync';

// 1) مكتبات الطرف الثالث من node_modules (لا CDN داخل حزمة التطبيق أبداً)
run(node, ['scripts/sync-vendor.mjs']);

// 2) config.js من متغيّرات البيئة
run(node, ['scripts/generate-config.js']);

// 3) حزمة الويب بهدف native → dist-native/
run(npx, ['vite', 'build', '--mode', 'production'], { MARMA_TARGET: 'native' });

if (skipSync) {
  console.log('\n✓ dist-native جاهزة (تُرك التزامن بطلبك)');
  process.exit(0);
}

// 4) نسخ الحزمة إلى المشروعين الأصليين وتحديث الملحقات
for (const platform of platforms) {
  if (!existsSync(resolve(ROOT, platform))) {
    console.warn(`\n⚠️  منصّة ${platform} غير مضافة — تجاوزناها (npx cap add ${platform})`);
    continue;
  }
  run(npx, ['cap', 'sync', platform]);
}

console.log('\n✓ التطبيق الأصلي محدَّث. للتشغيل: npm run ios  أو  npm run android');
