// صفحة التقارير - module pattern (SPA + legacy)
(function () {
  const TEMPLATE = `
    <div class="page-header">
      <h2>التقارير</h2>
      <div class="actions">
        <button class="btn btn--secondary" id="export-btn">نسخ كـ CSV</button>
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
      <div class="flex-row" style="gap:8px">
        <button class="btn btn--ghost btn--sm" data-quick="today">اليوم</button>
        <button class="btn btn--ghost btn--sm" data-quick="week">هذا الأسبوع</button>
        <button class="btn btn--ghost btn--sm" data-quick="month">هذا الشهر</button>
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

  const page = {
    async mount(container, ctx) {
      container.innerHTML = TEMPLATE;

      const fromInput = container.querySelector('#from-date');
      const toInput = container.querySelector('#to-date');
      const reportContainer = container.querySelector('#report-container');
      const exportBtn = container.querySelector('#export-btn');
      const quickBtns = container.querySelectorAll('[data-quick]');

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
          to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        }
        fromInput.value = toISODate(from);
        toInput.value = toISODate(to);
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
          reportContainer.innerHTML = `<div class="card"><div class="empty-state"><p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p></div></div>`;
        }
      }

      function renderReport(rows) {
        if (!rows.length) {
          reportContainer.innerHTML = `
            <div class="card">
              <div class="empty-state">
                <div class="icon"><i data-lucide="bar-chart-3"></i></div>
                <h3>لا توجد بيانات</h3>
                <p>لا توجد حجوزات في هذا النطاق الزمني</p>
              </div>
            </div>
          `;
          window.utils.renderIcons(reportContainer);
          return;
        }

        const totals = rows.reduce(
          (acc, r) => {
            acc.bookings += Number(r.bookings_count || 0);
            acc.revenue += Number(r.total_revenue || 0);
            acc.paid += Number(r.total_paid || 0);
            acc.remaining += Number(r.total_remaining || 0);
            return acc;
          },
          { bookings: 0, revenue: 0, paid: 0, remaining: 0 }
        );

        reportContainer.innerHTML = `
          <div class="stats-grid mb-lg">
            <div class="stat-card">
              <div class="stat-label">إجمالي الحجوزات</div>
              <div class="stat-value">${totals.bookings}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">إجمالي الإيرادات</div>
              <div class="stat-value">${window.utils.formatCurrency(totals.revenue)}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">المدفوع</div>
              <div class="stat-value">${window.utils.formatCurrency(totals.paid)}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">المتبقي</div>
              <div class="stat-value">${window.utils.formatCurrency(totals.remaining)}</div>
            </div>
          </div>

          <div class="table-wrapper">
            <table class="table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>عدد الحجوزات</th>
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
                    <td>${window.utils.formatCurrency(r.total_revenue)}</td>
                    <td>${window.utils.formatCurrency(r.total_paid)}</td>
                    <td>${window.utils.formatCurrency(r.total_remaining)}</td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot>
                <tr>
                  <td>الإجمالي</td>
                  <td>${totals.bookings}</td>
                  <td>${window.utils.formatCurrency(totals.revenue)}</td>
                  <td>${window.utils.formatCurrency(totals.paid)}</td>
                  <td>${window.utils.formatCurrency(totals.remaining)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        `;
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
        // BOM لدعم العربية في Excel
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const link = document.createElement('a');
        const fileName = `تقرير-${fromInput.value}-إلى-${toInput.value}.csv`;
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        window.utils.toast('تم تصدير التقرير', 'success');
      }

      fromInput.addEventListener('change', refresh);
      toInput.addEventListener('change', refresh);
      quickBtns.forEach((btn) => {
        btn.addEventListener('click', () => setRange(btn.dataset.quick));
      });
      exportBtn.addEventListener('click', exportCsv);

      cleanup.push(() => {
        alive = false;
        fromInput.removeEventListener('change', refresh);
        toInput.removeEventListener('change', refresh);
        exportBtn.removeEventListener('click', exportCsv);
      });

      if (window.realtime) {
        const debouncedRefresh = window.utils.debounce(refresh, 400);
        cleanup.push(window.realtime.on('bookings:change', debouncedRefresh));
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
