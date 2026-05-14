import { defineConfig } from 'vite';
import { resolve } from 'path';
import { cp } from 'fs/promises';

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
  'subscription'
];

function spaFallbackMiddleware(req, _res, next) {
  const pathname = (req.url || '/').split('?')[0];
  const firstSegment = pathname.split('/').filter(Boolean)[0];
  if (firstSegment && APP_ROUTES.includes(firstSegment)) {
    req.url = '/app.html';
  }
  next();
}

export default defineConfig({
  appType: 'mpa',
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
      // ملفات الـ JS مكتوبة كـ window globals (ليست ES modules)، لذا Vite لا يحزمها.
      // ننسخها كما هي إلى dist/ بعد البناء حتى تتوفّر للروابط في HTML.
      // عند الانتقال لـ ES modules لاحقاً، يمكن حذف هذا الـ plugin.
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
      }
    }
  ]
});
