// مفتاح تبديل الوضع (فاتح / داكن / نظام).
// التخزين: localStorage.marma:theme (light | dark | system).
// يُطبَّق على <html data-theme>. سكربت FOUC-prevention يُهيّء القيمة عند تحميل الصفحة.
//
// API:
//   window.themeToggle.get()          → 'light' | 'dark' | 'system'
//   window.themeToggle.set('dark')    → يطبّق + يحفظ
//   window.themeToggle.cycle()        → light → dark → system → light
//   window.themeToggle.render(host)   → يحقن الزر في حاوية ويربط أحداثه

window.themeToggle = (function () {
  const STORAGE_KEY = 'marma:theme';
  const VALUES = ['light', 'dark', 'system'];

  function get() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return VALUES.includes(v) ? v : 'system';
    } catch (_) {
      return 'system';
    }
  }

  function resolve(theme) {
    if (theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return theme;
  }

  function apply(theme) {
    const resolved = resolve(theme);
    document.documentElement.setAttribute('data-theme', resolved);
  }

  function set(theme) {
    if (!VALUES.includes(theme)) theme = 'system';
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (_) {}
    apply(theme);
    updateButtons(theme);
    notifyListeners(theme);
  }

  function cycle() {
    const current = get();
    const next = VALUES[(VALUES.indexOf(current) + 1) % VALUES.length];
    set(next);
  }

  const listeners = new Set();
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function notifyListeners(theme) {
    listeners.forEach((fn) => { try { fn(theme); } catch (_) {} });
  }

  // إذا كان الوضع 'system'، استجب لتغيّر تفضيل النظام
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (get() === 'system') apply('system'); };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else mq.addListener(handler);
  } catch (_) {}

  function iconFor(theme) {
    if (theme === 'dark')   return 'moon';
    if (theme === 'light')  return 'sun';
    return 'monitor';   // system
  }

  function labelFor(theme) {
    if (theme === 'dark')   return 'الوضع الداكن';
    if (theme === 'light')  return 'الوضع الفاتح';
    return 'حسب النظام';
  }

  const buttons = new Set();

  function updateButtons(theme) {
    buttons.forEach((btn) => {
      const icon = iconFor(theme);
      btn.setAttribute('title', labelFor(theme));
      btn.setAttribute('aria-label', labelFor(theme));
      btn.dataset.theme = theme;
      btn.innerHTML = `<i data-lucide="${icon}"></i>`;
      if (window.utils && window.utils.renderIcons) window.utils.renderIcons(btn);
    });
  }

  // يحقن زراً في الحاوية المعطاة، يربط النقر بـ cycle()
  function render(host) {
    if (!host) return null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'header-icon-btn theme-toggle';
    btn.addEventListener('click', cycle);
    buttons.add(btn);
    host.appendChild(btn);
    updateButtons(get());
    return btn;
  }

  return { get, set, cycle, render, onChange };
})();
