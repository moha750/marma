// لوحة المشرف العام — الإيرادات + سجلّ الاشتراكات الكامل (قراءة وتحليل).
// الإجراءات (موافقة/رفض) تبقى في صفحة «طلبات الاشتراك».
(function () {
  const fmtMoney = (v) => window.utils.formatCurrency(Number(v) || 0);
  const fmtDateTime = (v) => v ? window.utils.formatDateTime(v) : '—';
  const fmtDate = (v) => v ? window.utils.formatDate(v) : '—';

  const STATUS = {
    approved: { label: 'معتمد', cls: 'active' },
    pending:  { label: 'معلّق', cls: 'trial' },
    rejected: { label: 'مرفوض', cls: 'expired' }
  };

  function statCard(icon, label, value, sub, variant) {
    const v = variant ? ` stat-card--${variant}` : '';
    const chip = variant ? `stat-icon-chip stat-icon-chip--${variant}` : 'stat-icon-chip';
    return `
      <div class="stat-card${v}">
        <div class="stat-card-head">
          <span class="${chip}"><i data-lucide="${icon}"></i></span>
          <span class="stat-label">${label}</span>
        </div>
        <div class="stat-value tabular-nums">${value}</div>
        ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
      </div>`;
  }

  // رسم أعمدة بسيط للاتجاه الشهري (بلا اعتماد على مكتبة)
  function chart(monthly) {
    if (!monthly || !monthly.length) return '';
    const max = Math.max(1, ...monthly.map((m) => Number(m.revenue) || 0));
    return `
      <div class="card" style="margin-bottom:var(--space-4)">
        <div class="card-body">
          <div class="text-sm text-secondary" style="margin-bottom:var(--space-3)">الإيراد آخر 6 أشهر</div>
          <div style="display:flex;align-items:flex-end;gap:var(--space-3);height:150px">
            ${monthly.map((m) => {
              const r = Number(m.revenue) || 0;
              const h = Math.round((r / max) * 100);
              return `
                <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;justify-content:flex-end">
                  <div class="tabular-nums" style="font-size:var(--text-2xs);color:var(--text-tertiary);white-space:nowrap">${r ? r.toLocaleString('en-US') : ''}</div>
                  <div title="${fmtMoney(r)}" style="width:100%;max-width:46px;height:${h}%;min-height:${r ? 4 : 0}px;background:var(--accent-500);border-radius:var(--radius-sm) var(--radius-sm) 0 0"></div>
                  <div style="font-size:var(--text-2xs);color:var(--text-secondary);white-space:nowrap">${window.utils.escapeHtml(m.label)}</div>
                </div>`;
            }).join('')}
          </div>
        </div>
      </div>`;
  }

  function rowsHtml(subs) {
    if (!subs.length) {
      return `<div class="card"><div class="empty-state"><div class="empty-icon"><i data-lucide="receipt"></i></div><h3>لا اشتراكات</h3><p>لا سجلّات بهذه الحالة.</p></div></div>`;
    }
    return `
      <div class="table-wrapper">
        <table class="table table--cards">
          <thead>
            <tr><th>التاريخ</th><th>الملعب</th><th>الحالة</th><th>الباقة</th><th>المبلغ</th><th>الفترة</th><th class="text-end"></th></tr>
          </thead>
          <tbody>
            ${subs.map((s) => {
              const st = STATUS[s.status] || { label: s.status, cls: 'trial' };
              return `
                <tr>
                  <td data-label="التاريخ">${fmtDateTime(s.created_at)}</td>
                  <td data-label="الملعب" class="fw-semibold">${window.utils.escapeHtml(s.tenant_name)}</td>
                  <td data-label="الحالة" class="card-tag"><span class="status-badge status-badge--${st.cls}">${st.label}</span></td>
                  <td data-label="الباقة" class="tabular-nums">${s.requested_fields || '—'} أرضية + ${s.requested_staff || '—'} موظف</td>
                  <td data-label="المبلغ">${s.amount != null ? fmtMoney(s.amount) : '—'}</td>
                  <td data-label="الفترة">${s.period_start ? `${fmtDate(s.period_start)} ← ${fmtDate(s.period_end)}` : (s.reject_reason ? window.utils.escapeHtml(s.reject_reason) : '—')}</td>
                  <td data-label="" class="actions-cell text-end">
                    <div class="actions-inline">
                      <a class="btn btn--secondary btn--sm" href="${window.utils.path('/admin/tenants/' + s.tenant_id)}">
                        <i data-lucide="eye"></i> التفاصيل
                      </a>
                    </div>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  const FILTERS = [
    { key: '',         label: 'الكل' },
    { key: 'approved', label: 'معتمد' },
    { key: 'pending',  label: 'معلّق' },
    { key: 'rejected', label: 'مرفوض' }
  ];

  const page = {
    async mount(container) {
      let alive = true;
      page._cleanup = [() => { alive = false; }];
      container.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';

      let allSubs = [];
      let filter = '';

      function renderTable() {
        const host = container.querySelector('#rev-table');
        if (!host) return;
        const subs = filter ? allSubs.filter((s) => s.status === filter) : allSubs;
        host.innerHTML = rowsHtml(subs);
        window.utils.renderIcons(host);
      }

      try {
        const [stats, subs] = await Promise.all([
          window.api.adminRevenueStats(),
          window.api.adminListSubscriptions()
        ]);
        if (!alive) return;
        allSubs = subs;

        container.innerHTML = `
          <div class="page-header">
            <div>
              <h2>الإيرادات</h2>
              <div class="page-subtitle">الدخل من الاشتراكات المعتمدة وسجلّها الكامل</div>
            </div>
          </div>
          <div class="stats-grid">
            ${statCard('wallet', 'إجمالي الإيراد', fmtMoney(stats.total_revenue), `${stats.approved_count} اشتراك معتمد`)}
            ${statCard('calendar-clock', 'إيراد هذا الشهر', fmtMoney(stats.this_month), 'اشتراكات اعتُمدت هذا الشهر', stats.this_month > 0 ? 'success' : '')}
            ${statCard('badge-check', 'الاشتراكات المعتمدة', stats.approved_count, 'عدد المدفوعات المؤكّدة')}
            ${statCard('trending-up', 'متوسط القيمة', fmtMoney(stats.avg_amount), 'لكل اشتراك معتمد')}
          </div>
          ${chart(stats.monthly)}
          <div class="cal-views" id="rev-filters" style="margin-bottom:var(--space-3)">
            ${FILTERS.map((f, i) => `<button type="button" class="cal-view${i === 0 ? ' is-active' : ''}" data-filter="${f.key}">${f.label}</button>`).join('')}
          </div>
          <div id="rev-table"></div>
        `;
        window.utils.renderIcons(container);
        renderTable();

        container.querySelector('#rev-filters').addEventListener('click', (e) => {
          const btn = e.target.closest('[data-filter]');
          if (!btn) return;
          filter = btn.dataset.filter;
          container.querySelectorAll('#rev-filters .cal-view').forEach((b) => b.classList.toggle('is-active', b === btn));
          renderTable();
        });
      } catch (err) {
        if (!alive) return;
        container.innerHTML = `<div class="page-header"><div><h2>الإيرادات</h2></div></div><div class="card"><div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert"></i></div><h3>تعذّر تحميل البيانات</h3><p>${window.utils.escapeHtml(window.utils.formatError(err))}</p></div></div>`;
        window.utils.renderIcons(container);
      }
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages['admin-revenue'] = page;
})();
