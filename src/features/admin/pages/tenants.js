// لوحة المشرف العام — قائمة الملاعب وحالاتها (نمط SPA: mount/unmount)
(function () {
  function statusInfo(t) {
    if (!t.is_active) return { cls: 'expired', label: 'مغلق' };
    if (t.subscription_ends_at && new Date(t.subscription_ends_at) < new Date()) return { cls: 'grace', label: 'سماح (انتهى الاشتراك)' };
    if (t.trial_ends_at && new Date(t.trial_ends_at) < new Date() && !t.subscription_ends_at) return { cls: 'grace', label: 'سماح (انتهت التجربة)' };
    if (t.subscription_status === 'active') return { cls: 'active', label: 'مشترك' };
    return { cls: 'trial', label: 'تجربة' };
  }

  function render(tenants) {
    if (!tenants.length) {
      return `<div class="card"><div class="empty-state"><div class="empty-icon"><i data-lucide="inbox"></i></div><h3>لا توجد ملاعب</h3></div></div>`;
    }
    return `
      <div class="table-wrapper">
        <table class="table table--cards">
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>المدن</th>
                  <th>الحالة</th>
                  <th>نهاية التجربة</th>
                  <th>نهاية الاشتراك</th>
                  <th>تاريخ الإنشاء</th>
                  <th>آخر اشتراك مُعتمد</th>
                </tr>
              </thead>
              <tbody>
                ${tenants.map((t) => {
                  const s = statusInfo(t);
                  return `
                    <tr>
                      <td data-label="الاسم" class="fw-semibold"><a href="${window.utils.path('/admin/tenants/' + t.id)}">${window.utils.escapeHtml(t.name)}</a></td>
                      <td data-label="المدن">${window.utils.escapeHtml(t.cities || '—')}</td>
                      <td data-label="الحالة" class="card-tag"><span class="status-badge status-badge--${s.cls}">${s.label}</span></td>
                      <td data-label="نهاية التجربة">${t.trial_ends_at ? window.utils.formatDateTime(t.trial_ends_at) : '—'}</td>
                      <td data-label="نهاية الاشتراك">${t.subscription_ends_at ? window.utils.formatDateTime(t.subscription_ends_at) : '—'}</td>
                      <td data-label="تاريخ الإنشاء">${window.utils.formatDate(t.created_at)}</td>
                      <td data-label="آخر اشتراك مُعتمد">${t.last_subscription_at ? window.utils.formatDate(t.last_subscription_at) : '—'}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
        </table>
      </div>
    `;
  }

  const page = {
    async mount(container) {
      container.innerHTML = `
        <div class="page-header">
          <div>
            <h2>الملاعب</h2>
            <div class="page-subtitle">كل الملاعب المسجّلة وحالات اشتراكها</div>
          </div>
        </div>
        <div id="admin-tenants-body"></div>
      `;
      window.utils.renderIcons(container);

      const body = container.querySelector('#admin-tenants-body');
      let alive = true;
      page._cleanup = [() => { alive = false; }];

      body.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
      try {
        const tenants = await window.api.adminListTenants();
        if (!alive) return;
        body.innerHTML = render(tenants);
        window.utils.renderIcons(body);
      } catch (err) {
        if (!alive) return;
        body.innerHTML = `<div class="card"><div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert"></i></div><h3>تعذّر تحميل البيانات</h3><p>${window.utils.escapeHtml(window.utils.formatError(err))}</p></div></div>`;
        window.utils.renderIcons(body);
      }
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages['admin-tenants'] = page;
})();
