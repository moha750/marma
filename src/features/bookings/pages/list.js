// قائمة الحجوزات — KPI + filters bar + chip rail للفلاتر النشطة + جدول مع status بحدود + hover actions
(function () {
  const TEMPLATE = `
    <div class="page-header">
      <div>
        <h2>الحجوزات</h2>
        <div class="page-subtitle">جميع الحجوزات مع فلاتر متقدّمة</div>
      </div>
      <div class="actions">
        <a href="${window.utils.path('/calendar')}" class="btn btn--secondary">
          <i data-lucide="calendar"></i> عرض التقويم
        </a>
        <button class="btn btn--primary" id="add-booking-btn">
          <i data-lucide="plus"></i> حجز جديد
        </button>
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
          <option value="pending">معلّق</option>
          <option value="confirmed">مؤكد</option>
          <option value="completed">مكتمل</option>
          <option value="cancelled">ملغي</option>
        </select>
      </div>
      <button class="btn btn--ghost" id="reset-filters-btn" title="إعادة تعيين">
        <i data-lucide="x"></i>
      </button>
    </div>

    <div id="chip-rail" class="chip-rail" style="margin-bottom: var(--space-3); display: none"></div>

    <div id="bookings-container">
      <div class="loader-center"><div class="loader loader--lg"></div></div>
    </div>
  `;

  function statusChip(status) {
    if (status === 'pending')   return '<span class="chip-status chip-status--pending">معلّق</span>';
    if (status === 'confirmed') return '<span class="chip-status chip-status--confirmed">مؤكد</span>';
    if (status === 'completed') return '<span class="chip-status chip-status--completed">مكتمل</span>';
    if (status === 'cancelled') return '<span class="chip-status chip-status--cancelled">ملغي</span>';
    return `<span class="chip-status chip-status--muted">${window.utils.escapeHtml(status)}</span>`;
  }

  function statusLabel(s) {
    return { pending:'معلّق', confirmed:'مؤكد', completed:'مكتمل', cancelled:'ملغي' }[s] || s;
  }

  function fmtMoney(v) { return window.utils.formatCurrency(v || 0); }

  const page = {
    async mount(container, ctx) {
      container.innerHTML = TEMPLATE;
      window.utils.renderIcons(container);

      const tableContainer = container.querySelector('#bookings-container');
      const addBtn         = container.querySelector('#add-booking-btn');
      const filterFrom     = container.querySelector('#filter-from');
      const filterTo       = container.querySelector('#filter-to');
      const filterField    = container.querySelector('#filter-field');
      const filterStatus   = container.querySelector('#filter-status');
      const resetBtn       = container.querySelector('#reset-filters-btn');
      const chipRail       = container.querySelector('#chip-rail');

      let alive = true;
      const cleanup = [];
      page._cleanup = cleanup;

      // اقرأ ?status=pending من URL إن وُجد (من dashboard "X طلب آخر")
      const urlStatus = window.utils.getQueryParam('status');
      if (urlStatus) filterStatus.value = urlStatus;

      // املأ قائمة الأرضيات
      let fieldsMap = {};
      try {
        const fields = window.store ? await window.store.get('fields:all') : await window.api.listFields(true);
        if (!alive) return;
        fields.forEach((f) => {
          fieldsMap[f.id] = f.name;
          const opt = document.createElement('option');
          opt.value = f.id;
          opt.textContent = f.name;
          filterField.appendChild(opt);
        });
      } catch (err) { console.error(err); }

      function buildChipRail(filters) {
        const chips = [];
        if (filters.from) chips.push({ key: 'from', label: `من ${filters.from.slice(0,10)}` });
        if (filters.to)   chips.push({ key: 'to',   label: `إلى ${filters.to.slice(0,10)}` });
        if (filters.fieldId) chips.push({ key: 'fieldId', label: fieldsMap[filters.fieldId] || 'أرضية' });
        if (filters.status)  chips.push({ key: 'status',  label: statusLabel(filters.status) });

        if (chips.length === 0) {
          chipRail.style.display = 'none';
          return;
        }
        chipRail.style.display = '';
        chipRail.innerHTML = chips.map((c) => `
          <span class="chip is-active">
            ${window.utils.escapeHtml(c.label)}
            <button class="chip-close" data-clear="${c.key}" aria-label="إزالة">×</button>
          </span>
        `).join('') + `<button class="chip" id="clear-all-chips">مسح الكل</button>`;

        chipRail.querySelectorAll('[data-clear]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const k = btn.dataset.clear;
            if (k === 'from')    filterFrom.value = '';
            if (k === 'to')      filterTo.value = '';
            if (k === 'fieldId') filterField.value = '';
            if (k === 'status')  filterStatus.value = '';
            refresh();
          });
        });
        chipRail.querySelector('#clear-all-chips').addEventListener('click', resetFilters);
      }

      async function refresh() {
        if (!alive) return;
        tableContainer.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';

        const filters = {};
        if (filterFrom.value) filters.from = filterFrom.value + 'T00:00:00';
        if (filterTo.value)   filters.to   = filterTo.value + 'T23:59:59';
        if (filterField.value)  filters.fieldId = filterField.value;
        if (filterStatus.value) filters.status  = filterStatus.value;

        buildChipRail(filters);

        try {
          const bookings = await window.api.listBookings(filters);
          if (!alive) return;

          if (!bookings.length) {
            tableContainer.innerHTML = `
              <div class="card">
                <div class="empty-state">
                  <div class="empty-icon"><i data-lucide="clipboard-list"></i></div>
                  <h3>لا توجد حجوزات</h3>
                  <p>${Object.keys(filters).length ? 'لا حجوزات تطابق الفلاتر — جرّب مسحها.' : 'لم يتم إنشاء أي حجز بعد.'}</p>
                  ${Object.keys(filters).length ? '<button class="btn btn--secondary" id="empty-reset">مسح الفلاتر</button>' : ''}
                </div>
              </div>
            `;
            window.utils.renderIcons(tableContainer);
            const er = tableContainer.querySelector('#empty-reset');
            if (er) er.addEventListener('click', resetFilters);
            return;
          }

          const active = bookings.filter((b) => b.status !== 'cancelled');
          const totals = active.reduce((acc, b) => {
            acc.revenue += Number(b.total_price || 0);
            acc.paid    += Number(b.paid_amount || 0);
            return acc;
          }, { revenue: 0, paid: 0 });

          tableContainer.innerHTML = `
            <div class="stats-grid mb-md">
              <div class="stat-card">
                <div class="stat-card-head">
                  <span class="stat-icon-chip"><i data-lucide="clipboard-list"></i></span>
                  <span class="stat-label">عدد الحجوزات</span>
                </div>
                <div class="stat-value">${active.length}</div>
                <div class="stat-sub">${bookings.length} إجمالاً (شامل الملغية)</div>
              </div>
              <div class="stat-card">
                <div class="stat-card-head">
                  <span class="stat-icon-chip stat-icon-chip--accent"><i data-lucide="banknote"></i></span>
                  <span class="stat-label">إجمالي الإيرادات</span>
                </div>
                <div class="stat-value">${fmtMoney(totals.revenue)}</div>
              </div>
              <div class="stat-card">
                <div class="stat-card-head">
                  <span class="stat-icon-chip stat-icon-chip--accent"><i data-lucide="circle-check"></i></span>
                  <span class="stat-label">المدفوع</span>
                </div>
                <div class="stat-value text-success">${fmtMoney(totals.paid)}</div>
                <div class="stat-sub">المتبقي ${fmtMoney(totals.revenue - totals.paid)}</div>
              </div>
            </div>

            <div class="table-wrapper">
              <table class="table table--sticky-first">
                <thead>
                  <tr>
                    <th>التاريخ والوقت</th>
                    <th>الأرضية</th>
                    <th>العميل</th>
                    <th>المدة</th>
                    <th>السعر</th>
                    <th>المدفوع</th>
                    <th>الحالة</th>
                    <th class="actions-cell"></th>
                  </tr>
                </thead>
                <tbody>
                  ${bookings.map((b) => {
                    const hours = window.utils.hoursBetween(b.start_time, b.end_time);
                    const owed  = Number(b.total_price || 0) - Number(b.paid_amount || 0);
                    return `
                      <tr class="is-clickable" data-id="${b.id}" data-status="${window.utils.escapeHtml(b.status)}">
                        <td>${window.utils.formatDateTime(b.start_time)}</td>
                        <td>${window.utils.escapeHtml(b.fields ? b.fields.name : '—')}</td>
                        <td>
                          <div>${window.utils.escapeHtml(b.customers ? b.customers.full_name : '—')}</div>
                          ${b.customers && b.customers.phone ? `<div class="text-xs text-tertiary">${window.utils.escapeHtml(b.customers.phone)}</div>` : ''}
                        </td>
                        <td class="tabular-nums">${hours.toFixed(1)} س</td>
                        <td class="tabular-nums">${fmtMoney(b.total_price)}</td>
                        <td class="tabular-nums">
                          ${fmtMoney(b.paid_amount)}
                          ${owed > 0 && b.status !== 'cancelled' ? `<div class="text-xs text-warning">يتبقّى ${fmtMoney(owed)}</div>` : ''}
                        </td>
                        <td>${statusChip(b.status)}</td>
                        <td class="actions-cell">
                          <div class="actions-inline">
                            ${b.status === 'pending' ? `
                              <button class="btn btn--xs btn--accent-quiet" data-action="approve" data-id="${b.id}" title="موافقة">
                                <i data-lucide="check"></i>
                              </button>
                              <button class="btn btn--xs btn--danger-quiet" data-action="reject" data-id="${b.id}" title="رفض">
                                <i data-lucide="x"></i>
                              </button>
                            ` : ''}
                            <button class="btn btn--xs btn--ghost" data-action="edit" data-id="${b.id}" title="تعديل">
                              <i data-lucide="pencil"></i>
                            </button>
                          </div>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `;

          // أحداث الصف — نقرة على أي مكان عدا الأزرار تفتح الـ modal
          tableContainer.querySelectorAll('tr[data-id]').forEach((tr) => {
            tr.addEventListener('click', (e) => {
              if (e.target.closest('[data-action]')) return;
              const booking = bookings.find((b) => b.id === tr.dataset.id);
              window.bookingModal.open({ booking, onSaved: refresh });
            });
          });

          tableContainer.querySelectorAll('[data-action="approve"]').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
              e.stopPropagation();
              btn.disabled = true;
              try {
                await window.api.approveBooking(btn.dataset.id);
                window.utils.toast('تم تأكيد الحجز', 'success');
                refresh();
              } catch (err) {
                btn.disabled = false;
                window.utils.toast(window.utils.formatError(err), 'error');
              }
            });
          });

          tableContainer.querySelectorAll('[data-action="reject"]').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
              e.stopPropagation();
              if (!confirm('تأكيد رفض الحجز؟')) return;
              btn.disabled = true;
              try {
                await window.api.rejectBooking(btn.dataset.id);
                window.utils.toast('تم رفض الحجز', 'success');
                refresh();
              } catch (err) {
                btn.disabled = false;
                window.utils.toast(window.utils.formatError(err), 'error');
              }
            });
          });

          tableContainer.querySelectorAll('[data-action="edit"]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const booking = bookings.find((b) => b.id === btn.dataset.id);
              window.bookingModal.open({ booking, onSaved: refresh });
            });
          });

          window.utils.renderIcons(container);
        } catch (err) {
          if (!alive) return;
          tableContainer.innerHTML = `
            <div class="card">
              <div class="empty-state">
                <div class="empty-icon"><i data-lucide="triangle-alert"></i></div>
                <p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p>
              </div>
            </div>
          `;
          window.utils.renderIcons(container);
        }
      }

      function resetFilters() {
        filterFrom.value = '';
        filterTo.value = '';
        filterField.value = '';
        filterStatus.value = '';
        refresh();
      }

      const filterEls = [filterFrom, filterTo, filterField, filterStatus];
      filterEls.forEach((el) => el.addEventListener('change', refresh));
      resetBtn.addEventListener('click', resetFilters);
      addBtn.addEventListener('click', () => window.bookingModal.open({ onSaved: refresh }));

      cleanup.push(() => {
        alive = false;
        filterEls.forEach((el) => el.removeEventListener('change', refresh));
      });

      if (window.realtime) {
        const debounced = window.utils.debounce(refresh, 400);
        cleanup.push(window.realtime.on('bookings:change', debounced));
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
