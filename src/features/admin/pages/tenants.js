// لوحة المشرف العام — قائمة الملاعب وحالاتها (نمط SPA: mount/unmount)
(function () {
  function statusInfo(t) {
    if (!t.is_active) return { cls: 'expired', label: 'مغلق' };
    if (t.subscription_ends_at && new Date(t.subscription_ends_at) < new Date()) return { cls: 'grace', label: 'سماح (انتهى الاشتراك)' };
    if (t.trial_ends_at && new Date(t.trial_ends_at) < new Date() && !t.subscription_ends_at) return { cls: 'grace', label: 'سماح (انتهت التجربة)' };
    if (t.subscription_status === 'active') return { cls: 'active', label: 'مشترك' };
    return { cls: 'trial', label: 'تجربة' };
  }

  const FILTERS = [
    { key: '',        label: 'الكل' },
    { key: 'active',  label: 'مشترك' },
    { key: 'trial',   label: 'تجربة' },
    { key: 'grace',   label: 'سماح' },
    { key: 'expired', label: 'منتهٍ' }
  ];

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
                  <th>تاريخ الإنشاء</th>
                  <th>نهاية التجربة</th>
                  <th>آخر اشتراك مُعتمد</th>
                  <th>نهاية الاشتراك</th>
                  <th class="text-end"></th>
                </tr>
              </thead>
              <tbody>
                ${tenants.map((t) => {
                  const s = statusInfo(t);
                  return `
                    <tr>
                      <td data-label="الاسم" class="fw-semibold">${window.utils.escapeHtml(t.name)}</td>
                      <td data-label="المدن">${window.utils.escapeHtml(t.cities || '—')}</td>
                      <td data-label="الحالة" class="card-tag"><span class="status-badge status-badge--${s.cls}">${s.label}</span></td>
                      <td data-label="تاريخ الإنشاء">${window.utils.formatDate(t.created_at)}</td>
                      <td data-label="نهاية التجربة">${t.trial_ends_at ? window.utils.formatDateTime(t.trial_ends_at) : '—'}</td>
                      <td data-label="آخر اشتراك مُعتمد">${t.last_subscription_at ? window.utils.formatDate(t.last_subscription_at) : '—'}</td>
                      <td data-label="نهاية الاشتراك">${t.subscription_ends_at ? window.utils.formatDateTime(t.subscription_ends_at) : '—'}</td>
                      <td data-label="" class="actions-cell text-end">
                        <div class="actions-inline">
                          <a class="btn btn--secondary btn--sm" href="${window.utils.path('/admin/tenants/' + t.id)}">
                            <i data-lucide="eye"></i> التفاصيل
                          </a>
                        </div>
                      </td>
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
        <div class="subbar-c">
          <div class="cal-subbar" style="margin-bottom:var(--space-3)">
            <input type="search" class="form-control" id="ten-search" placeholder="ابحث باسم الملعب أو المدينة..." style="max-width:280px">
            <div class="cal-views" id="ten-filters">
              ${FILTERS.map((f, i) => `<button type="button" class="cal-view${i === 0 ? ' is-active' : ''}" data-f="${f.key}">${f.label}</button>`).join('')}
            </div>
          </div>
        </div>
        <div id="admin-tenants-body"></div>
      `;
      window.utils.renderIcons(container);

      const body = container.querySelector('#admin-tenants-body');
      const searchEl = container.querySelector('#ten-search');
      const filtersEl = container.querySelector('#ten-filters');
      let alive = true, all = [], q = '', flt = '';
      page._cleanup = [() => { alive = false; }];

      function apply() {
        const qq = q.trim().toLowerCase();
        const list = all.filter((t) => {
          if (flt && statusInfo(t).cls !== flt) return false;
          if (qq && !(`${t.name} ${t.cities || ''}`.toLowerCase().includes(qq))) return false;
          return true;
        });
        body.innerHTML = list.length ? render(list)
          : `<div class="card"><div class="empty-state"><div class="empty-icon"><i data-lucide="search-x"></i></div><h3>لا نتائج مطابقة</h3></div></div>`;
        window.utils.renderIcons(body);
      }

      body.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
      try {
        all = await window.api.adminListTenants();
        if (!alive) return;
        apply();
        searchEl.addEventListener('input', () => { q = searchEl.value; apply(); });
        filtersEl.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-f]');
          if (!btn) return;
          flt = btn.dataset.f;
          filtersEl.querySelectorAll('.cal-view').forEach((b) => b.classList.toggle('is-active', b === btn));
          apply();
        });
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
