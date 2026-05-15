// Shell خاص بصفحات لوحة المشرف العام (admin/*)
// لا يحتاج tenant، يستخدم requireSuperAdmin
window.adminLayout = (function () {
  const TABS = [
    { key: 'subscriptions', label: 'طلبات الاشتراك', href: '/admin/subscriptions' },
    { key: 'tenants', label: 'الملاعب', href: '/admin/tenants' }
  ];

  async function renderShell({ activeTab, pageTitle } = {}) {
    const ctx = await window.auth.requireSuperAdmin();

    document.body.classList.add('app-body');
    const root = document.getElementById('app-root') || document.body;
    const existing = document.getElementById('page-content');
    const existingHtml = existing ? existing.innerHTML : '';
    const existingTitle = pageTitle || document.title.replace(' - مَرمى', '');

    root.innerHTML = `
      <div class="admin-shell">
        <header class="admin-header">
          <div class="brand"><i data-lucide="shield"></i> لوحة المشرف العام</div>
          <nav class="admin-tabs">
            ${TABS.map((t) => `
              <a href="${window.utils.path(t.href)}" class="${t.key === activeTab ? 'active' : ''}">${t.label}</a>
            `).join('')}
          </nav>
          <div style="margin-inline-start:auto;display:flex;gap:8px">
            <button class="btn btn--ghost btn--sm" id="admin-signout">تسجيل الخروج</button>
          </div>
        </header>
        <div class="admin-content">
          <div class="page-header"><h2>${window.utils.escapeHtml(existingTitle)}</h2></div>
          <main id="page-content">${existingHtml}</main>
        </div>
      </div>
    `;

    document.getElementById('admin-signout').addEventListener('click', () => {
      window.auth.signOut('/auth/login');
    });

    window.utils.renderIcons(root);
    return ctx;
  }

  return { renderShell };
})();
