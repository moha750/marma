import { defineConfig } from 'vite';
import { resolve } from 'path';
import { cp, copyFile } from 'fs/promises';

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

// عند نشر المشروع على GitHub Pages تحت مستودع projectName:
// - الموقع يعيش على https://USERNAME.github.io/marma/
// - لذلك base = '/marma/'
// عند ربط دومين مخصّص (CNAME):
// - الموقع يعيش على https://your-domain.com/
// - بدّل السطر التالي إلى: const PROD_BASE = '/';
const PROD_BASE = '/marma/';

function spaFallbackMiddleware(req, _res, next) {
  // في dev: base = '/'، لذا نتحقق من أول segment بعد '/'
  // في preview: نفس الشيء (preview يستخدم base أيضاً)
  const pathname = (req.url || '/').split('?')[0];
  const segments = pathname.split('/').filter(Boolean);
  // إذا كان أول segment هو 'marma' (في preview)، تجاوزه
  const firstSegment = segments[0] === 'marma' ? segments[1] : segments[0];
  if (firstSegment && APP_ROUTES.includes(firstSegment)) {
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
          adminTenants: resolve(__dirname, 'admin/tenants.html'),
          adminSubscriptions: resolve(__dirname, 'admin/subscriptions.html')
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
            html = html.replace(
              /(<a\s[^>]*?)\shref=(["'])\/(?!\/)([^"']*)\2/gi,
              (match, prefix, quote, path) => {
                if (path === baseNoSlash.slice(1) || path.startsWith(baseNoSlash.slice(1) + '/')) return match;
                return `${prefix} href=${quote}${baseNoSlash}/${path}${quote}`;
              }
            );
            html = html.replace(
              /(<form\s[^>]*?)\saction=(["'])\/(?!\/)([^"']*)\2/gi,
              (match, prefix, quote, path) => {
                if (path === baseNoSlash.slice(1) || path.startsWith(baseNoSlash.slice(1) + '/')) return match;
                return `${prefix} action=${quote}${baseNoSlash}/${path}${quote}`;
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

          // 404.html = نفس app.html (يلتقط كل المسارات غير الموجودة على GitHub Pages)
          try {
            await copyFile(resolve(dist, 'app.html'), resolve(dist, '404.html'));
          } catch (err) {
            console.warn('فشل نسخ app.html إلى 404.html:', err.message);
          }
        }
      }
    ]
  };
});
