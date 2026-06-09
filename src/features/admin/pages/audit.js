// لوحة المشرف العام — سجلّ النشاط (كل الإجراءات الإدارية عبر كل الملاعب).
(function () {
  const ACTION_FILTERS = [
    { key: '',                   label: 'الكل' },
    { key: 'grant_subscription', label: 'منح اشتراك' },
    { key: 'end_subscription',   label: 'إنهاء اشتراك' },
    { key: 'extend_trial',       label: 'تمديد تجربة' },
    { key: 'end_trial',          label: 'إنهاء تجربة' },
    { key: 'set_limits',         label: 'تعديل الحدود' },
    { key: 'suspend',            label: 'تعطيل' },
    { key: 'activate',           label: 'تفعيل' }
  ];

  const page = {
    async mount(container) {
      let alive = true;
      page._cleanup = [() => { alive = false; }];

      container.innerHTML = `
        <div class="page-header">
          <div>
            <h2>سجلّ النشاط</h2>
            <div class="page-subtitle">كل الإجراءات الإدارية عبر كل الملاعب</div>
          </div>
        </div>
        <div class="subbar-c">
          <div class="cal-subbar" style="margin-bottom:var(--space-3)">
            <input type="search" class="form-control" id="aud-search" placeholder="ابحث باسم الملعب أو المشرف..." style="max-width:280px">
            <div class="cal-views" id="aud-filters">
              ${ACTION_FILTERS.map((f, i) => `<button type="button" class="cal-view${i === 0 ? ' is-active' : ''}" data-f="${f.key}">${f.label}</button>`).join('')}
            </div>
          </div>
        </div>
        <div id="aud-body"></div>
      `;
      window.utils.renderIcons(container);

      const body = container.querySelector('#aud-body');
      const searchEl = container.querySelector('#aud-search');
      const filtersEl = container.querySelector('#aud-filters');
      let all = [], q = '', flt = '';

      function apply() {
        const qq = q.trim().toLowerCase();
        const list = all.filter((a) => {
          if (flt && a.action !== flt) return false;
          if (qq && !(`${a.tenant_name || ''} ${a.actor || ''}`.toLowerCase().includes(qq))) return false;
          return true;
        });
        body.innerHTML = list.length
          ? window.adminAudit.render(list, { showTenant: true })
          : `<div class="card"><div class="empty-state"><div class="empty-icon"><i data-lucide="search-x"></i></div><h3>لا نتائج مطابقة</h3></div></div>`;
        window.utils.renderIcons(body);
      }

      body.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
      try {
        all = await window.api.adminListAuditLog();
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
        body.innerHTML = `<div class="card"><div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert"></i></div><h3>تعذّر تحميل السجلّ</h3><p>${window.utils.escapeHtml(window.utils.formatError(err))}</p></div></div>`;
        window.utils.renderIcons(body);
      }
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages['admin-audit'] = page;
})();
