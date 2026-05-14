// راوتر معتمد على History API للتطبيق الأحادي الصفحة (SPA)
// كل صفحة تُسجَّل نفسها كـ module بشكل: { mount(container, ctx), unmount() }
// يُستدعى router.start() مرة واحدة بعد تركيب الـ shell.

window.router = (function () {
  const routes = {};                 // name -> { path, title, ownerOnly, module, activeNav }
  let currentInstance = null;
  let currentName = null;
  let started = false;

  function register(name, def) {
    routes[name] = Object.assign({ module: name, title: '', ownerOnly: false }, def);
  }

  function getRoutes() { return routes; }

  // يحاول مطابقة pathname مع كل المسارات المسجلة
  // pattern مثل "/customers/:id" يطابق "/customers/abc" مع params = ['abc']
  function matchRoute(pathname) {
    const segments = pathname.split('/').filter(Boolean);
    for (const name of Object.keys(routes)) {
      const route = routes[name];
      if (!route.path) continue;
      const patternSegs = route.path.split('/').filter(Boolean);
      if (patternSegs.length !== segments.length) continue;
      const params = [];
      let match = true;
      for (let i = 0; i < patternSegs.length; i++) {
        if (patternSegs[i].startsWith(':')) {
          params.push(decodeURIComponent(segments[i]));
        } else if (patternSegs[i] !== segments[i]) {
          match = false;
          break;
        }
      }
      if (match) return { name, params };
    }
    return null;
  }

  function parseLocation() {
    const matched = matchRoute(location.pathname);
    return {
      name: matched ? matched.name : '',
      params: matched ? matched.params : [],
      query: new URLSearchParams(location.search || '')
    };
  }

  function buildPath(name, params) {
    const route = routes[name];
    if (!route || !route.path) return '/' + name;
    let i = 0;
    return route.path.replace(/:[^/]+/g, () => encodeURIComponent(params && params[i++] || ''));
  }

  function navigate(name, params) {
    const target = buildPath(name, params);
    if (location.pathname === target) {
      go();
    } else {
      history.pushState(null, '', target);
      go();
    }
  }

  async function go() {
    if (!started) return;
    const { name, params, query } = parseLocation();
    const ctx = window.app && window.app.ctx;
    if (!ctx) return;

    const targetName = name && routes[name] ? name : 'dashboard';
    const route = routes[targetName];
    if (!route) {
      renderNotFound();
      return;
    }

    // حماية الصفحات الخاصة بالمالك فقط
    if (route.ownerOnly && ctx.profile.role !== 'owner') {
      navigate('dashboard');
      return;
    }

    const container = document.getElementById('page-content');
    if (!container) return;

    // فك الصفحة السابقة
    if (currentInstance && typeof currentInstance.unmount === 'function') {
      try { currentInstance.unmount(); } catch (e) { console.warn('unmount error:', e); }
    }
    currentInstance = null;

    const pageModule = window.pages && window.pages[route.module];
    if (!pageModule) {
      renderNotFound();
      return;
    }

    container.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';

    if (window.layout && window.layout.setActive) {
      // activeNav يسمح للراوت بأن يحدد عنصراً مختلفاً في الـ sidebar
      // (مثلاً customer-details يبرز customers)
      window.layout.setActive(route.activeNav || targetName, route.title);
    }

    try {
      const pageCtx = Object.assign({}, ctx, { params, query, route: targetName });
      await pageModule.mount(container, pageCtx);
      currentInstance = pageModule;
      currentName = targetName;
      window.utils && window.utils.renderIcons(container);
    } catch (err) {
      console.error('فشل تحميل الصفحة', targetName, err);
      const msg = window.utils ? window.utils.formatError(err) : (err && err.message) || 'خطأ';
      container.innerHTML = `<div class="card"><div class="empty-state"><p class="text-danger">${msg}</p></div></div>`;
    }
  }

  function renderNotFound() {
    const container = document.getElementById('page-content');
    if (!container) return;
    container.innerHTML = `
      <div class="card">
        <div class="empty-state">
          <p>الصفحة غير موجودة</p>
          <a href="/dashboard" class="btn btn--primary mt-md">العودة للوحة التحكم</a>
        </div>
      </div>
    `;
  }

  // التقاط النقرات على الروابط الداخلية لتجنب reload كامل
  // الروابط التي تتطابق مع SPA route تُدار عبر pushState؛ غيرها (مثل /auth/login) يتركها المتصفح
  function interceptLinkClicks(e) {
    if (e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const anchor = e.target.closest && e.target.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href) return;
    if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;
    if (anchor.getAttribute('rel') === 'external') return;
    // فقط المسارات النسبية للجذر (ولا تبدأ بـ //)
    if (!href.startsWith('/') || href.startsWith('//')) return;

    const [pathOnly, queryOnly] = href.split('?');
    const matched = matchRoute(pathOnly);
    if (!matched) return; // اترك المتصفح يتعامل (مثل /auth/login، /admin/tenants)

    e.preventDefault();
    const target = queryOnly ? pathOnly + '?' + queryOnly : pathOnly;
    if (location.pathname + location.search === target) {
      go();
    } else {
      history.pushState(null, '', target);
      go();
    }
  }

  function start() {
    if (started) return;
    started = true;
    window.addEventListener('popstate', go);
    document.addEventListener('click', interceptLinkClicks);
    // إذا الـ pathname لا يطابق أي مسار SPA (مثل دخل المستخدم على /app.html مباشرة) → /dashboard
    if (!matchRoute(location.pathname)) {
      history.replaceState(null, '', '/dashboard');
    }
    go();
  }

  function currentRouteName() { return currentName; }

  return { register, getRoutes, navigate, start, parseLocation, currentRouteName, buildPath, matchRoute };
})();
