// لوحة المشرف العام — تحليلات نموّ المنصّة (نموّ الملاعب، الحجوزات، التحويل).
(function () {
  function statCard(icon, label, value, sub) {
    return `
      <div class="stat-card">
        <div class="stat-card-head">
          <span class="stat-icon-chip"><i data-lucide="${icon}"></i></span>
          <span class="stat-label">${label}</span>
        </div>
        <div class="stat-value tabular-nums">${value}</div>
        ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
      </div>`;
  }

  // رسم أعمدة بسيط (بلا مكتبة)
  function barChart(title, series) {
    if (!series || !series.length) return '';
    const max = Math.max(1, ...series.map((m) => Number(m.count) || 0));
    return `
      <div class="card" style="margin-bottom:var(--space-4)">
        <div class="card-body">
          <div class="text-sm text-secondary" style="margin-bottom:var(--space-3)">${title}</div>
          <div style="display:flex;align-items:flex-end;gap:var(--space-3);height:150px">
            ${series.map((m) => {
              const n = Number(m.count) || 0;
              const h = Math.round((n / max) * 100);
              return `
                <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end">
                  <div class="tabular-nums" style="font-size:var(--text-2xs);color:var(--text-tertiary)">${n || ''}</div>
                  <div style="width:100%;max-width:46px;height:${h}%;min-height:${n ? 4 : 0}px;background:var(--accent-500);border-radius:var(--radius-sm) var(--radius-sm) 0 0"></div>
                  <div style="font-size:var(--text-2xs);color:var(--text-secondary);white-space:nowrap">${window.utils.escapeHtml(m.label)}</div>
                </div>`;
            }).join('')}
          </div>
        </div>
      </div>`;
  }

  function render(d) {
    const t = d.totals || {};
    return `
      <div class="page-header">
        <div>
          <h2>نموّ المنصّة</h2>
          <div class="page-subtitle">اتجاهات التسجيل والحجوزات وتحويل التجارب</div>
        </div>
      </div>
      <div class="stats-grid">
        ${statCard('percent', 'معدّل التحويل', `${d.conversion_rate}%`, `${d.paying} من ${t.tenants} ملعب اشترك`)}
        ${statCard('badge-check', 'ملاعب نشطة', d.active, `من ${t.tenants} إجمالي`)}
        ${statCard('clipboard-list', 'إجمالي الحجوزات', (t.bookings ?? 0).toLocaleString('en-US'), 'عبر كل الملاعب')}
        ${statCard('users', 'إجمالي العملاء', (t.customers ?? 0).toLocaleString('en-US'), 'عملاء مسجّلون')}
      </div>
      ${barChart('ملاعب جديدة شهريًا (آخر 6 أشهر)', d.tenants_monthly)}
      ${barChart('الحجوزات شهريًا (آخر 6 أشهر)', d.bookings_monthly)}
    `;
  }

  const page = {
    async mount(container) {
      let alive = true;
      page._cleanup = [() => { alive = false; }];
      container.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
      try {
        const d = await window.api.adminGrowthStats();
        if (!alive) return;
        container.innerHTML = render(d);
        window.utils.renderIcons(container);
      } catch (err) {
        if (!alive) return;
        container.innerHTML = `<div class="page-header"><div><h2>نموّ المنصّة</h2></div></div><div class="card"><div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert"></i></div><h3>تعذّر تحميل البيانات</h3><p>${window.utils.escapeHtml(window.utils.formatError(err))}</p></div></div>`;
        window.utils.renderIcons(container);
      }
    },
    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages['admin-analytics'] = page;
})();
