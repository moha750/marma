import { defineConfig } from 'vite';
import { resolve } from 'path';
import { cp, copyFile, readFile, writeFile, rm } from 'fs/promises';
import { readdirSync, readFileSync } from 'fs';
import { createHash } from 'crypto';

// بصمة محتوى لكل ملف في assets/vendor — تُلحَق كـ ?v= على وسوم <script>.
// مكتبات الطرف الثالث تحمل أسماء ثابتة (lucide.min.js) فلا تحصل على hash من
// Vite؛ وبصمة المحتوى تعطينا أفضل ما في العالمين: الرابط يتغيّر فقط عند ترقية
// المكتبة فعلاً (فلا تنزيل ١ م.ب مع كل نشرة)، ويتغيّر فوراً عند الترقية (فلا
// نسخة قديمة عالقة في كاش سنة كامل).
function vendorFingerprints(root) {
  const dir = resolve(root, 'assets/vendor');
  const map = {};
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.js')) continue;
      map[name] = createHash('sha256').update(readFileSync(resolve(dir, name))).digest('hex').slice(0, 8);
    }
  } catch (_) { /* لا مجلد vendor بعد — البناء يشغّل sync-vendor قبله */ }
  return map;
}

// المسارات التي يخدمها الـ SPA shell (app.html) — تُعاد كتابتها في dev و production.
const APP_ROUTES = [
  'dashboard',
  'calendar',
  'bookings',
  'customers',
  'fields',
  'schedule',
  'offers',
  'loyalty',
  'leads',
  'reports',
  'visits',
  'staff',
  'subscription',
  'account',
  'payments',
  'settings'
];

// النطاق المخصّص https://marma.help → base = '/'
// (سابقاً كان '/marma/' للنشر على github.io/marma قبل ربط النطاق)
const PROD_BASE = '/';

function spaFallbackMiddleware(req, _res, next) {
  // في dev: base = '/'، لذا نتحقق من أول segment بعد '/'
  // في preview: نفس الشيء (preview يستخدم base أيضاً)
  const pathname = (req.url || '/').split('?')[0];
  const segments = pathname.split('/').filter(Boolean);
  // إذا كان أول segment هو 'marma' (في preview)، تجاوزه
  const firstSegment = segments[0] === 'marma' ? segments[1] : segments[0];
  if (firstSegment === 'admin') {
    // SPA المشرف العام: /admin/* → admin.html
    req.url = '/admin.html';
  } else if (firstSegment && APP_ROUTES.includes(firstSegment)) {
    req.url = '/app.html';
  }
  next();
}

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';

  // ─── هدف البناء: web (الافتراضي) أو native (حزمة تطبيق أبل/قوقل) ───
  //
  // النسخة الأصلية ليست الموقع نفسه في قوقعة. ثلاثة فروق جوهرية:
  //
  //  1) نقطة الدخول: app.html تُخرَج باسم index.html، لأن Capacitor يفتح
  //     index.html دائماً. تُولَّد من app.html نفسه لا من نسخة يدوية، فلا يمكن
  //     أن تتباعد النسختان عند إضافة سكربت جديد.
  //
  //  2) ما يُستبعَد: صفحة التسويق (وفيها الأسعار — ومنع أبل صريح في 3.1.1)،
  //     ولوحة المشرف العام، وصفحتا الحجز والبطاقة العامّتان (للعملاء على الويب).
  //     كل ملف زائد في الحزمة سطحُ مراجعةٍ إضافي بلا مقابل.
  //
  //  3) المسارات: Capacitor يخدم index.html لأي مسار بلا امتداد (تحقّقنا من
  //     CapacitorRouter.route في iOS و WebViewLocalServer في أندرويد). هذا يجعل
  //     مسارات الراوتر (/dashboard) تعمل تلقائياً، لكنه يكسر روابط المستندات
  //     الحقيقية (/auth/login → قوقعة التطبيق بدل صفحة الدخول). فنعيد كتابتها
  //     إلى .html هنا وقت البناء، ونكمل الجانب البرمجي في src/core/native.js.
  const isNative = process.env.MARMA_TARGET === 'native';
  const base = isProd && !isNative ? PROD_BASE : '/';
  // BASE_NO_SLASH للاستخدام في window.__BASE__ — بدون trailing slash
  // مثال: '/marma' في prod، '' في dev
  const baseNoSlash = base.replace(/\/$/, '');

  // بصمة البناء: تُحقن في CACHE_VERSION للـ service worker، وكـ ?v= على روابط
  // ملفات /src/*.js و/config.js (أسماؤها ثابتة فلا تحمل hash من Vite).
  // المصدر: Cloudflare Pages env، أو GH Actions، أو timestamp محلي.
  const buildHash =
    (process.env.CF_PAGES_COMMIT_SHA && process.env.CF_PAGES_COMMIT_SHA.slice(0, 8)) ||
    (process.env.GITHUB_SHA && process.env.GITHUB_SHA.slice(0, 8)) ||
    Date.now().toString(36);

  const VENDOR_FP = vendorFingerprints(__dirname);

  return {
    appType: 'mpa',
    base,
    server: {
      port: 5174,
      strictPort: true,
      open: '/'
    },
    build: {
      outDir: isNative ? 'dist-native' : 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: isNative
          ? {
              // app.html يُعاد تسميته index.html في closeBundle أدناه
              app: resolve(__dirname, 'app.html'),
              // لوحة المشرف العام: مالك المنصّة يدير ملاعبه من جوّاله كذلك.
              // لا تعرض آيبان ولا زرّ شراء (تراجع إيصالات الآخرين فقط)، فقاعدة
              // أبل 3.1.1 لا تنطبق عليها، وهي خلف حساب لا يبلغه المراجع.
              admin: resolve(__dirname, 'admin.html'),
              login: resolve(__dirname, 'auth/login.html'),
              signup: resolve(__dirname, 'auth/signup.html'),
              forgot: resolve(__dirname, 'auth/forgot.html'),
              reset: resolve(__dirname, 'auth/reset.html'),
              // الصفحتان النظاميتان داخل الحزمة أيضاً: أبل تطلب وصولاً إليهما من
              // داخل التطبيق، وحملهما محلياً يعني ظهورهما بلا شبكة كذلك
              privacy: resolve(__dirname, 'legal/privacy.html'),
              terms: resolve(__dirname, 'legal/terms.html')
            }
          : {
              landing: resolve(__dirname, 'index.html'),
              login: resolve(__dirname, 'auth/login.html'),
              signup: resolve(__dirname, 'auth/signup.html'),
              forgot: resolve(__dirname, 'auth/forgot.html'),
              reset: resolve(__dirname, 'auth/reset.html'),
              book: resolve(__dirname, 'book.html'),
              card: resolve(__dirname, 'card.html'),
              app: resolve(__dirname, 'app.html'),
              admin: resolve(__dirname, 'admin.html'),
              privacy: resolve(__dirname, 'legal/privacy.html'),
              terms: resolve(__dirname, 'legal/terms.html')
            }
      }
    },
    plugins: [
      {
        name: 'marma-spa-fallback',
        configureServer(server) {
          server.middlewares.use(spaFallbackMiddleware);
        },
        configurePreviewServer(server) {
          server.middlewares.use(spaFallbackMiddleware);
        }
      },
      {
        // يحقن window.__BASE__ في <head> ويعيد كتابة <a href="/X"> و <form action="/X">
        // ليشمل base path في production.
        // post: يعمل بعد ما يعالج Vite <script src> و <link href> (لتفادي كسر CSS bundling).
        name: 'marma-inject-base',
        transformIndexHtml: {
          order: 'post',
          handler(html) {
            // احقن window.__BASE__ قبل أي script آخر
            html = html.replace(
              /<head>/i,
              `<head>\n  <script>window.__BASE__=${JSON.stringify(baseNoSlash)};</script>`
            );

            if (isNative) {
              // علامة البيئة الأصلية — تُقرأ قبل أي كود آخر، فيتصرّف الكود
              // المشترك بحسبها (لا service worker، لا واجهة دفع، ماسح أصلي…).
              html = html.replace(
                /<head>/i,
                '<head>\n  <script>window.__NATIVE__=true;</script>'
              );

              // روابط المستندات النظيفة → ملفات .html صريحة.
              // Capacitor يخدم index.html لأي مسار بلا امتداد، فـ href="/auth/login"
              // كان سيفتح قوقعة التطبيق بدل صفحة الدخول.
              html = html.replace(
                /(<a\s+(?:[^>]*?\s)?href=")(\/auth\/[a-z-]+)(")/gi,
                (_m, prefix, path, suffix) => `${prefix}${path}.html${suffix}`
              );

              // service worker لا مكان له داخل قوقعة Capacitor: الأصول تُخدَم من
              // حزمة التطبيق (capacitor://) لا من الشبكة، فطبقة كاش ثانية تعني
              // كوداً قديماً عالقاً بعد تحديث من المتجر — وهي أعصى ما يُشخَّص.
              html = html.replace(
                /\s*<!--[^>]*PWA[^>]*-->\s*<script src="[^"]*\/core\/pwa\.js[^"]*"><\/script>/i,
                ''
              );
              html = html.replace(
                /\s*<script src="[^"]*\/core\/pwa\.js[^"]*"><\/script>/i,
                ''
              );

              // manifest الويب لا معنى له في تطبيق مثبَّت من المتجر
              html = html.replace(/\s*<link rel="manifest"[^>]*>/i, '');
            }

            // ?v=<buildHash> على السكربتات غير المُهَشَّمة (/src/**.js و/config.js).
            // بدونها يبقى الرابط ثابتاً بين النشرات، فيخدم المتصفّح نسخته المخزّنة
            // ويظهر كود قديم إلى أن يعمل المستخدم hard reload — وHTML نفسه طازج
            // دائماً (max-age=0) فالرابط الجديد يصل فوراً بعد كل نشر.
            if (isProd) {
              html = html.replace(
                /(<script\b[^>]*\bsrc=")([^"]*(?:src\/[^"]+\.js|config\.js))(")/gi,
                (match, prefix, url, suffix) =>
                  /^https?:/i.test(url) || url.includes('?')
                    ? match
                    : `${prefix}${url}?v=${buildHash}${suffix}`
              );

              // مكتبات vendor: بصمة محتوى بدل بصمة البناء (انظر vendorFingerprints)
              html = html.replace(
                /(<script\b[^>]*\bsrc=")([^"]*assets\/vendor\/([^"?/]+\.js))(")/gi,
                (match, prefix, url, file, suffix) => {
                  const fp = VENDOR_FP[file];
                  return !fp || url.includes('?') ? match : `${prefix}${url}?v=${fp}${suffix}`;
                }
              );
            }

            // في dev/custom-domain (baseNoSlash فارغ) لا نعيد كتابة شيء
            if (!baseNoSlash) return html;

            // أعد كتابة <a ... href="/X"> و <form ... action="/X"> فقط (وليس <link> أو <script>)
            // Vite يتولّى script src و link href تلقائياً عند ضبط base
            // ملاحظة: النمط `(?:[^>]*?\s)?` اختياري ليتعامل مع
            // `<a href="...">` (بدون attributes أخرى) و `<a class="x" href="...">` معاً.
            html = html.replace(
              /(<a\s+(?:[^>]*?\s)?)href=(["'])\/(?!\/)([^"']*)\2/gi,
              (match, prefix, quote, path) => {
                if (path === baseNoSlash.slice(1) || path.startsWith(baseNoSlash.slice(1) + '/')) return match;
                return `${prefix}href=${quote}${baseNoSlash}/${path}${quote}`;
              }
            );
            html = html.replace(
              /(<form\s+(?:[^>]*?\s)?)action=(["'])\/(?!\/)([^"']*)\2/gi,
              (match, prefix, quote, path) => {
                if (path === baseNoSlash.slice(1) || path.startsWith(baseNoSlash.slice(1) + '/')) return match;
                return `${prefix}action=${quote}${baseNoSlash}/${path}${quote}`;
              }
            );

            return html;
          }
        }
      },
      {
        // ملفات JS مكتوبة كـ window globals (ليست ES modules)، فننسخها كما هي.
        // كما ننسخ app.html إلى 404.html (حيلة GitHub Pages SPA fallback).
        name: 'marma-copy-legacy-assets',
        apply: 'build',
        async closeBundle() {
          const root = __dirname;
          const dist = resolve(root, isNative ? 'dist-native' : 'dist');
          const copyIfExists = async (rel) => {
            try {
              await cp(resolve(root, rel), resolve(dist, rel), { recursive: true });
            } catch (err) {
              if (err.code !== 'ENOENT') throw err;
            }
          };
          await copyIfExists('src');
          await copyIfExists('config.js');
          await copyIfExists('assets');

          if (isNative) {
            // Capacitor يفتح index.html دائماً — وقوقعة التطبيق هي app.html.
            await copyFile(resolve(dist, 'app.html'), resolve(dist, 'index.html'));
            await rm(resolve(dist, 'app.html'), { force: true });
            // لا حاجة لصفحة التسويق ولا لوحة المشرف ولا الصفحات العامّة داخل الحزمة
            console.log('[marma] حزمة native: index.html = قوقعة التطبيق');
            return;
          }

          await copyIfExists('CNAME');
          // PWA: manifest + service worker يجب أن يصلا dist/ بأسمائهما الأصلية
          await copyIfExists('manifest.webmanifest');
          await copyIfExists('service-worker.js');
          // Cloudflare Pages: ملف الـ headers للتحكم في الكاش
          await copyIfExists('_headers');
          // Cloudflare Pages: توجيه /admin/* إلى admin.html (SPA المشرف)
          await copyIfExists('_redirects');

          // 404.html = نفس app.html (يلتقط كل المسارات غير الموجودة على GitHub Pages)
          try {
            await copyFile(resolve(dist, 'app.html'), resolve(dist, '404.html'));
          } catch (err) {
            console.warn('فشل نسخ app.html إلى 404.html:', err.message);
          }

          // ─── حقن CACHE_VERSION الديناميكي في service-worker.js ───
          // كل deploy → CACHE_VERSION فريد → SW جديد → الكاش القديم يُحذف تلقائياً.
          // نفس buildHash المستخدم في ?v= أعلاه، فالإصداران متطابقان.
          try {
            const swPath = resolve(dist, 'service-worker.js');
            const sw = await readFile(swPath, 'utf8');
            const updated = sw.replace(
              /const CACHE_VERSION = '[^']*';/,
              `const CACHE_VERSION = 'marma-${buildHash}';`
            );
            if (updated !== sw) {
              await writeFile(swPath, updated, 'utf8');
              console.log(`[marma] CACHE_VERSION = marma-${buildHash}`);
            } else {
              console.warn('[marma] لم يُعثر على نمط CACHE_VERSION في service-worker.js');
            }
          } catch (err) {
            if (err.code !== 'ENOENT') {
              console.warn('[marma] فشل حقن CACHE_VERSION:', err.message);
            }
          }
        }
      }
    ]
  };
});
