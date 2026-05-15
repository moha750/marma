// التقارير اليومية — KPI strip + رسم أعمدة للإيرادات + جدول تفصيلي + CSV export
(function () {
  const TEMPLATE = `
    <div class="page-header">
      <div>
        <h2>التقارير</h2>
        <div class="page-subtitle">تقرير الإيرادات والحجوزات حسب الفترة</div>
      </div>
      <div class="actions">
        <button class="btn btn--secondary" id="export-btn">
          <i data-lucide="download"></i> تصدير CSV
        </button>
      </div>
    </div>

    <div class="filters-bar">
      <div class="form-group">
        <label class="form-label">من تاريخ</label>
        <input type="date" id="from-date" class="form-control">
      </div>
      <div class="form-group">
        <label class="form-label">إلى تاريخ</label>
        <input type="date" id="to-date" class="form-control">
      </div>
      <div class="chip-rail" style="align-self:end">
        <button class="chip" data-quick="today">اليوم</button>
        <button class="chip" data-quick="week">هذا الأسبوع</button>
        <button class="chip is-active" data-quick="month">هذا الشهر</button>
      </div>
    </div>

    <div id="report-container">
      <div class="loader-center"><div class="loader loader--lg"></div></div>
    </div>
  `;

  function toISODate(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function fmtMoney(v) { return window.utils.formatCurrency(v || 0); }

  function dayLabel(iso) {
    const d = new Date(iso);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  }

  const page = {
    async mount(container, ctx) {
      container.innerHTML = TEMPLATE;
      window.utils.renderIcons(container);

      const fromInput = container.querySelector('#from-date');
      const toInput   = container.querySelector('#to-date');
      const reportContainer = container.querySelector('#report-container');
      const exportBtn = container.querySelector('#export-btn');
      const quickChips = container.querySelectorAll('[data-quick]');

      let currentData = [];
      let alive = true;
      const cleanup = [];
      page._cleanup = cleanup;

      function setRange(quick) {
        const now = new Date();
        let from, to;
        if (quick === 'today') {
          from = to = now;
        } else if (quick === 'week') {
          const day = now.getDay();
          from = new Date(now);
          from.setDate(now.getDate() - day);
          to = new Date(from);
          to.setDate(from.getDate() + 6);
        } else {
          from = new Date(now.getFullYear(), now.getMonth(), 1);
          to   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        }
        fromInput.value = toISODate(from);
        toInput.value   = toISODate(to);

        quickChips.forEach((c) => c.classList.toggle('is-active', c.dataset.quick === quick));

        refresh();
      }

      async function refresh() {
        if (!alive) return;
        if (!fromInput.value || !toInput.value) return;
        if (fromInput.value > toInput.value) {
          window.utils.toast('تاريخ البداية يجب أن يكون قبل تاريخ النهاية', 'error');
          return;
        }
        reportContainer.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
        try {
          const rows = await window.api.getDailyReport(fromInput.value, toInput.value);
          if (!alive) return;
          currentData = rows;
          renderReport(rows);
        } catch (err) {
          if (!alive) return;
          reportContainer.innerHTML = `
            <div class="card">
              <div class="empty-state">
                <div class="empty-icon"><i data-lucide="triangle-alert"></i></div>
                <p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p>
              </div>
            </div>
          `;
          window.utils.renderIcons(reportContainer);
        }
      }

      function renderReport(rows) {
        if (!rows.length) {
          reportContainer.innerHTML = `
            <div class="card">
              <div class="empty-state">
                <div class="empty-icon"><i data-lucide="bar-chart-3"></i></div>
                <h3>لا توجد بيانات</h3>
                <p>لا توجد حجوزات في هذا النطاق الزمني.</p>
              </div>
            </div>
          `;
          window.utils.renderIcons(reportContainer);
          return;
        }

        const totals = rows.reduce((acc, r) => {
          acc.bookings  += Number(r.bookings_count   || 0);
          acc.revenue   += Number(r.total_revenue    || 0);
          acc.paid      += Number(r.total_paid       || 0);
          acc.remaining += Number(r.total_remaining  || 0);
          return acc;
        }, { bookings: 0, revenue: 0, paid: 0, remaining: 0 });

        const avgDaily = totals.revenue / Math.max(rows.length, 1);

        reportContainer.innerHTML = `
          <div class="stats-grid mb-md">
            <div class="stat-card">
              <div class="stat-card-head">
                <span class="stat-icon-chip"><i data-lucide="clipboard-list"></i></span>
                <span class="stat-label">إجمالي الحجوزات</span>
              </div>
              <div class="stat-value">${totals.bookings}</div>
              <div class="stat-sub">${rows.length} يوم في النطاق</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-head">
                <span class="stat-icon-chip stat-icon-chip--accent"><i data-lucide="banknote"></i></span>
                <span class="stat-label">إجمالي الإيرادات</span>
              </div>
              <div class="stat-value">${fmtMoney(totals.revenue)}</div>
              <div class="stat-sub">متوسط ${fmtMoney(avgDaily)} يومياً</div>
            </div>
            <div class="stat-card">
              <div class="stat-card-head">
                <span class="stat-icon-chip stat-icon-chip--accent"><i data-lucide="circle-check"></i></span>
                <span class="stat-label">المدفوع</span>
              </div>
              <div class="stat-value text-success">${fmtMoney(totals.paid)}</div>
            </div>
            <div class="stat-card${totals.remaining > 0 ? ' stat-card--warning' : ''}">
              <div class="stat-card-head">
                <span class="stat-icon-chip ${totals.remaining > 0 ? 'stat-icon-chip--warning' : ''}"><i data-lucide="receipt"></i></span>
                <span class="stat-label">المتبقي</span>
              </div>
              <div class="stat-value ${totals.remaining > 0 ? 'text-warning' : ''}">${fmtMoney(totals.remaining)}</div>
            </div>
          </div>

          <div class="card mb-md">
            <div class="card-header">
              <h3>الإيرادات اليومية</h3>
              <span class="card-header-meta">${rows.length} يوم</span>
            </div>
            <div class="card-body">
              <div id="revenue-bar-chart" style="min-height: 220px"></div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <h3>التفاصيل اليومية</h3>
            </div>
            <div class="table-wrapper" style="box-shadow:none;border-radius:0">
              <table class="table tabular-nums">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>الحجوزات</th>
                    <th>الإيرادات</th>
                    <th>المدفوع</th>
                    <th>المتبقي</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows.map((r) => `
                    <tr>
                      <td>${window.utils.formatDate(r.day)}</td>
                      <td>${r.bookings_count}</td>
                      <td>${fmtMoney(r.total_revenue)}</td>
                      <td class="text-success">${fmtMoney(r.total_paid)}</td>
                      <td class="${Number(r.total_remaining) > 0 ? 'text-warning' : 'text-tertiary'}">${fmtMoney(r.total_remaining)}</td>
                    </tr>
                  `).join('')}
                </tbody>
                <tfoot>
                  <tr>
                    <td><strong>الإجمالي</strong></td>
                    <td><strong>${totals.bookings}</strong></td>
                    <td><strong>${fmtMoney(totals.revenue)}</strong></td>
                    <td><strong class="text-success">${fmtMoney(totals.paid)}</strong></td>
                    <td><strong>${fmtMoney(totals.remaining)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        `;

        // ارسم الرسم البياني
        const chartEl = reportContainer.querySelector('#revenue-bar-chart');
        if (chartEl && window.charts && window.charts.bar) {
          window.charts.bar({
            container: chartEl,
            data: rows.map((r) => ({
              label: dayLabel(r.day),
              value: Number(r.total_revenue) || 0
            })),
            height: 220
          });
        }

        window.utils.renderIcons(reportContainer);
      }

      function exportCsv() {
        if (!currentData.length) {
          window.utils.toast('لا توجد بيانات للتصدير', 'warning');
          return;
        }
        const rows = [
          ['التاريخ', 'عدد الحجوزات', 'الإيرادات', 'المدفوع', 'المتبقي'],
          ...currentData.map((r) => [
            r.day,
            r.bookings_count,
            Number(r.total_revenue).toFixed(2),
            Number(r.total_paid).toFixed(2),
            Number(r.total_remaining).toFixed(2)
          ])
        ];
        const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `تقرير-${fromInput.value}-إلى-${toInput.value}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        window.utils.toast('تم تصدير التقرير', 'success');
      }

      fromInput.addEventListener('change', () => {
        quickChips.forEach((c) => c.classList.remove('is-active'));
        refresh();
      });
      toInput.addEventListener('change', () => {
        quickChips.forEach((c) => c.classList.remove('is-active'));
        refresh();
      });
      quickChips.forEach((c) => {
        c.addEventListener('click', () => setRange(c.dataset.quick));
      });
      exportBtn.addEventListener('click', exportCsv);

      cleanup.push(() => {
        alive = false;
      });

      if (window.realtime) {
        const debounced = window.utils.debounce(refresh, 400);
        cleanup.push(window.realtime.on('bookings:change', debounced));
      }

      // افتراضي: الشهر الحالي
      setRange('month');
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages.reports = page;
})();
