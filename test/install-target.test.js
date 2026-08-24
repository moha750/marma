// اختبار وجهة دعوة التثبيت — يعمل بـ node بلا تبعيات:  node test/install-target.test.js
//
// لماذا يستحق اختباراً: العيب الذي يحميه منه لا يظهر في التطوير ولا في المتصفّح —
// يظهر على جهاز عميل حقيقي ثبّت الـ PWA سابقاً، فيرى أيقونتين متطابقتين لـمَرمى.
// وقع فعلاً في اختبار الجهاز الحقيقي، ولا يكشفه أي بناء.
//
// والحالة الثانية أخطر: قلبُ PLAY_STORE_LIVE إلى true قبل النشر العلني يرسل
// كل مستخدم أندرويد إلى صفحة «لم يتم العثور على العنصر».
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createContext, runInContext } from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '..', 'src', 'core', 'pwa.js'), 'utf8');

const STORE = 'https://play.google.com/store/apps/details?id=help.marma.app';
const UA = {
  android: 'Mozilla/5.0 (Linux; Android 12; moto g22) Chrome/120 Mobile',
  desktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/120',
  iphone:  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17 Safari'
};

// window وهمي: pwa.js يسجّل SW ويستمع لأحداث، فنكتفي بأقلّ ما لا ينكسر دونه
function loadPwa(src, { ua, standalone = false, native = false } = {}) {
  const win = {
    matchMedia: () => ({ matches: standalone, addEventListener() {} }),
    navigator: {
      userAgent: ua, standalone: false, platform: 'x', maxTouchPoints: 0,
      serviceWorker: { addEventListener() {}, register: async () => ({}), controller: null }
    },
    document: { readyState: 'loading', addEventListener() {} },
    addEventListener() {}, dispatchEvent() {}, setTimeout() {},
    location: { href: '' }, CustomEvent: class {},
    __NATIVE__: native ? true : undefined
  };
  win.window = win;
  const ctx = createContext(win);
  ctx.navigator = win.navigator;
  ctx.document = win.document;
  ctx.console = console;
  runInContext(src, ctx);
  return win.pwa;
}

// نسخة بالمفتاح مقلوباً — لنختبر سلوك ما بعد النشر قبل أن ننشر
const LIVE = SRC.replace('const PLAY_STORE_LIVE = false;', 'const PLAY_STORE_LIVE = true;');

let failed = 0;
function eq(actual, expected, label) {
  if (actual === expected) { console.log(`✅ ${label}`); }
  else { failed++; console.error(`❌ ${label}: توقّع ${JSON.stringify(expected)} — النتيجة ${JSON.stringify(actual)}`); }
}

if (LIVE === SRC) {
  console.error('❌ لم يُعثر على PLAY_STORE_LIVE في pwa.js — تغيّر اسم المفتاح؟');
  process.exit(1);
}

// ── ما دام التطبيق على الاختبار المغلق: لا متجر لأحد ──
eq(loadPwa(SRC, { ua: UA.android }).storeUrl(), '', 'اختبار مغلق · أندرويد → لا متجر (تثبيت PWA كما هو)');

// ── بعد النشر العلني: أندرويد وحده يذهب للمتجر ──
eq(loadPwa(LIVE, { ua: UA.android }).storeUrl(), STORE, 'منشور · أندرويد ويب → متجر Play');
eq(loadPwa(LIVE, { ua: UA.android, standalone: true }).storeUrl(), '', 'منشور · PWA مثبَّتة → لا دعوة');
eq(loadPwa(LIVE, { ua: UA.android, native: true }).storeUrl(), '', 'منشور · داخل الحزمة الأصلية → لا دعوة');
eq(loadPwa(LIVE, { ua: UA.desktop }).storeUrl(), '', 'منشور · سطح المكتب → تثبيت PWA كما هو');
eq(loadPwa(LIVE, { ua: UA.iphone }).storeUrl(), '', 'منشور · آيفون → تعليمات iOS اليدوية');

// ── كشف المنصّة ──
eq(loadPwa(SRC, { ua: UA.android }).isAndroid(), true,  'isAndroid: أندرويد');
eq(loadPwa(SRC, { ua: UA.iphone  }).isAndroid(), false, 'isAndroid: آيفون ليس أندرويد');

if (failed) { console.error(`\n${failed} اختبار فشل ❌`); process.exit(1); }
console.log('\nكل اختبارات وجهة التثبيت نجحت ✅');
