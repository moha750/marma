// صفحة الحجوزات - module pattern (SPA + legacy)
(function () {
  const TEMPLATE = `
    <div class="page-header">
      <h2>الحجوزات</h2>
      <div class="actions">
        <button class="btn btn--primary" id="add-booking-btn">+ حجز جديد</button>
      </div>
    </div>

    <div class="filters-bar">
      <div class="form-group">
        <label class="form-label">من تاريخ</label>
        <input type="date" id="filter-from" class="form-control">
      </div>
      <div class="form-group">
        <label class="form-label">إلى تاريخ</label>
        <input type="date" id="filter-to" class="form-control">
      </div>
      <div class="form-group">
        <label class="form-label">الأرضية</label>
        <select id="filter-field" class="form-control">
          <option value="">كل الأرضيات</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">الحالة</label>
        <select id="filter-status" class="form-control">
          <option value="">كل الحالات</option>
          <option value="pending">بانتظار الموافقة</option>
          <option value="confirmed">مؤكد</option>
          <option value="completed">مكتمل</option>
          <option value="cancelled">ملغي</option>
        </select>
      </div>
      <button class="btn btn--secondary" id="reset-filters-btn">إعادة تعيين</button>
    </div>

    <div id="bookings-container">
      <div class="loader-center"><div class="loader loader--lg"></div></div>
    </div>
  `;

  function renderStatusBadge(status) {
    if (status === 'pending') return '<span class="badge badge--warning">بانتظار الموافقة</span>';
    if (status === 'confirmed') return '<span class="badge badge--success">مؤكد</span>';
    if (status === 'completed') return '<span class="badge badge--info">مكتمل</span>';
    if (status === 'cancelled') return '<span class="badge badge--danger">ملغي</span>';
    return `<span class="badge badge--muted">${window.utils.escapeHtml(status)}</span>`;
  }

  const page = {
    async mount(container, ctx) {
      container.innerHTML = TEMPLATE;

      const tableContainer = container.querySelector('#bookings-container');
      const addBtn = container.querySelector('#add-booking-btn');
      const filterFrom = container.querySelector('#filter-from');
      const filterTo = container.querySelector('#filter-to');
      const filterField = container.querySelector('#filter-field');
      const filterStatus = container.querySelector('#filter-status');
      const resetBtn = container.querySelector('#reset-filters-btn');

      let alive = true;
      const cleanup = [];
      page._cleanup = cleanup;

      try {
        const fields = window.store
          ? await window.store.get('fields:all')
          : await window.api.listFields(true);
        if (!alive) return;
        fields.forEach((f) => {
          const opt = document.createElement('option');
          opt.value = f.id;
          opt.textContent = f.name;
          filterField.appendChild(opt);
        });
      } catch (err) {
        console.error(err);
      }

      async function refresh() {
        if (!alive) return;
        tableContainer.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
        const filters = {};
        if (filterFrom.value) filters.from = filterFrom.value + 'T00:00:00';
        if (filterTo.value) filters.to = filterTo.value + 'T23:59:59';
        if (filterField.value) filters.fieldId = filterField.value;
        if (filterStatus.value) filters.status = filterStatus.value;

        try {
          const bookings = await window.api.listBookings(filters);
          if (!alive) return;

          if (!bookings.length) {
            tableContainer.innerHTML = `
              <div class="card">
                <div class="empty-state">
                  <div class="icon"><i data-lucide="clipboard-list"></i></div>
                  <h3>لا توجد حجوزات</h3>
                  <p>جرّب تعديل الفلاتر أو إنشاء حجز جديد</p>
                </div>
              </div>
            `;
            window.utils.renderIcons(tableContainer);
            return;
          }

          const totals = bookings.reduce(
            (acc, b) => {
              if (b.status !== 'cancelled') {
                acc.revenue += Number(b.total_price || 0);
                acc.paid += Number(b.paid_amount || 0);
              }
              return acc;
            },
            { revenue: 0, paid: 0 }
          );

          tableContainer.innerHTML = `
            <div class="stats-grid mb-md">
              <div class="stat-card">
                <div class="stat-label">عدد الحجوزات</div>
                <div class="stat-value">${bookings.filter((b) => b.status !== 'cancelled').length}</div>
                <div class="stat-sub">${bookings.length} إجمالاً (شامل الملغية)</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">إجمالي الإيرادات</div>
                <div class="stat-value">${window.utils.formatCurrency(totals.revenue)}</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">المدفوع</div>
                <div class="stat-value">${window.utils.formatCurrency(totals.paid)}</div>
                <div class="stat-sub">المتبقي: ${window.utils.formatCurrency(totals.revenue - totals.paid)}</div>
              </div>
            </div>

            <div class="table-wrapper">
              <table class="table">
                <thead>
                  <tr>
                    <th>التاريخ والوقت</th>
                    <th>الأرضية</th>
                    <th>العميل</th>
                    <th>المدة</th>
                    <th>السعر</th>
                    <th>المدفوع</th>
                    <th>الحالة</th>
                    <th class="text-end">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  ${bookings.map((b) => {
                    const hours = window.utils.hoursBetween(b.start_time, b.end_time);
                    return `
                      <tr>
                        <td>${window.utils.formatDateTime(b.start_time)}</td>
                        <td>${window.utils.escapeHtml(b.fields ? b.fields.name : '—')}</td>
                        <td>
                          ${window.utils.escapeHtml(b.customers ? b.customers.full_name : '—')}
                          <div class="text-muted" style="font-size:0.85rem">${window.utils.escapeHtml(b.customers ? b.customers.phone : '')}</div>
                        </td>
                        <td>${hours.toFixed(1)} ساعة</td>
                        <td>${window.utils.formatCurrency(b.total_price)}</td>
                        <td>${window.utils.formatCurrency(b.paid_amount)}</td>
                        <td>${renderStatusBadge(b.status)}</td>
                        <td class="text-end">
                          <button class="btn btn--ghost btn--sm" data-action="edit" data-id="${b.id}">تعديل</button>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `;

          tableContainer.querySelectorAll('[data-action="edit"]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const booking = bookings.find((b) => b.id === btn.dataset.id);
              window.bookingModal.open({ booking, onSaved: refresh });
            });
          });
        } catch (err) {
          if (!alive) return;
          tableContainer.innerHTML = `<div class="card"><div class="empty-state"><p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p></div></div>`;
        }
      }

      const filterEls = [filterFrom, filterTo, filterField, filterStatus];
      filterEls.forEach((el) => el.addEventListener('change', refresh));

      const onReset = () => {
        filterFrom.value = '';
        filterTo.value = '';
        filterField.value = '';
        filterStatus.value = '';
        refresh();
      };
      resetBtn.addEventListener('click', onReset);

      const onAdd = () => window.bookingModal.open({ onSaved: refresh });
      addBtn.addEventListener('click', onAdd);

      cleanup.push(() => {
        alive = false;
        filterEls.forEach((el) => el.removeEventListener('change', refresh));
        resetBtn.removeEventListener('click', onReset);
        addBtn.removeEventListener('click', onAdd);
      });

      // realtime: انعش الجدول عند تغيير الحجوزات
      if (window.realtime) {
        const debouncedRefresh = window.utils.debounce(refresh, 400);
        cleanup.push(window.realtime.on('bookings:change', debouncedRefresh));
      }

      refresh();
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages.bookings = page;
})();
