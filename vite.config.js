import { defineConfig } from 'vite';
import { resolve } from 'path';
import { cp, copyFile, readFile, writeFile } from 'fs/promises';

// المسارات التي يخدمها الـ SPA shell (app.html) — تُعاد كتابتها في dev و production.
const APP_ROUTES = [
  'dashboard',
  'calendar',
  'bookings',
  'customers',
  'fields',
  'schedule',
  'reports',
  'staff',
  'subscription',
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
  const base = isProd ? PROD_BASE : '/';
  // BASE_NO_SLASH للاستخدام في window.__BASE__ — بدون trailing slash
  // مثال: '/marma' في prod، '' في dev
  const baseNoSlash = base.replace(/\/$/, '');

  return {
    appType: 'mpa',
    base,
    server: {
      port: 5173,
      open: '/'
    },
    build: {
      rollupOptions: {
        input: {
          landing: resolve(__dirname, 'index.html'),
          login: resolve(__dirname, 'auth/login.html'),
          signup: resolve(__dirname, 'auth/signup.html'),
          book: resolve(__dirname, 'book.html'),
          app: resolve(__dirname, 'app.html'),
          admin: resolve(__dirname, 'admin.html')
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
          const dist = resolve(root, 'dist');
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
          // كل deploy → CACHE_VERSION فريد → SW جديد → الكاش القديم يُحذف تلقائياً
          // المصدر: Cloudflare Pages env (CF_PAGES_COMMIT_SHA) أو GH Actions أو timestamp محلي.
          const buildHash =
            (process.env.CF_PAGES_COMMIT_SHA && process.env.CF_PAGES_COMMIT_SHA.slice(0, 8)) ||
            (process.env.GITHUB_SHA && process.env.GITHUB_SHA.slice(0, 8)) ||
            Date.now().toString(36);

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
