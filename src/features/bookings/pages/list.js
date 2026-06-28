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

  // حالة الحجز المقبولة (مؤكد/مكتمل) — هي وحدها التي يُتتبّع لها دفع
  function isAccepted(b) { return b.status === 'confirmed' || b.status === 'completed'; }

  // حالة الدفع — مستقلّة عن حالة الحجز. null = لا تتبّع (سعر «عند التواصل» أو مجاني)
  function paymentInfo(b) {
    if (b.total_price == null) return null;          // عند التواصل
    const total = Number(b.total_price);
    if (total <= 0) return null;                     // مجاني
    const paid = Number(b.paid_amount || 0);
    const owed = Math.round((total - paid) * 100) / 100;
    if (paid <= 0) return { key: 'unpaid',  label: 'غير مدفوع',   owed };
    if (owed > 0)  return { key: 'partial', label: 'مدفوع جزئياً', owed };
    return { key: 'paid', label: 'مدفوع', owed: 0 };
  }

  function paymentBadge(p) {
    return `<span class="chip-status chip-status--${p.key}">${p.label}</span>`;
  }

  // نافذة تسجيل دفعة — مسار سريع: «تحصيل كامل المبلغ» أو مبلغ جزئي
  function openPaymentDialog(booking, onSaved) {
    const total = Number(booking.total_price || 0);
    const paid  = Number(booking.paid_amount || 0);
    const owed  = Math.round((total - paid) * 100) / 100;

    const row = (label, value, strong) =>
      `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0">
         <span class="text-muted">${label}</span>
         <span class="tabular-nums" style="${strong ? 'font-weight:700' : ''}">${value}</span>
       </div>`;

    const body = document.createElement('div');
    body.innerHTML = `
      <div style="background:var(--surface-2);padding:var(--space-3);border-radius:var(--radius-md);margin-bottom:var(--space-4)">
        ${row('الإجمالي', fmtMoney(total))}
        ${row('المدفوع سابقاً', fmtMoney(paid))}
        <div style="border-top:1px solid var(--border-subtle);margin:4px 0"></div>
        ${row('المتبقّي', fmtMoney(owed), true)}
      </div>
      <button type="button" class="btn btn--primary btn--block" id="pay-full">
        <i data-lucide="check-check"></i> تحصيل كامل المبلغ (${fmtMoney(owed)})
      </button>
      <div class="text-muted text-sm" style="text-align:center;margin:var(--space-3) 0 var(--space-2)">أو سجّل مبلغاً جزئياً</div>
      <div class="form-group" style="margin:0">
        <label class="form-label">المبلغ المُحصّل الآن (ر.س)</label>
        <input type="number" class="form-control" id="pay-amount" min="0" max="${owed}" step="0.01" value="${owed}">
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:8px;width:100%';
    footer.innerHTML = `
      <div style="flex:1"></div>
      <button type="button" class="btn btn--ghost" data-action="close">إغلاق</button>
      <button type="button" class="btn btn--primary" id="pay-submit">تسجيل الدفعة</button>
    `;

    const ctrl = window.utils.openModal({ title: 'تسجيل دفعة', body, footer });

    async function submit(newPaidTotal) {
      const clamped = Math.min(total, Math.max(0, Math.round(newPaidTotal * 100) / 100));
      try {
        const saved = await window.api.updateBooking(booking.id, { paid_amount: clamped });
        window.utils.toast('تم تسجيل الدفعة', 'success');
        ctrl.close();
        if (typeof onSaved === 'function') onSaved(saved);
      } catch (err) {
        window.utils.toast(window.utils.formatError(err), 'error');
      }
    }

    ctrl.modal.querySelector('#pay-full').addEventListener('click', () => submit(total));
    ctrl.modal.querySelector('#pay-submit').addEventListener('click', () => {
      const amt = parseFloat(ctrl.modal.querySelector('#pay-amount').value);
      if (!(amt > 0)) { window.utils.toast('أدخل مبلغاً صحيحاً', 'error'); return; }
      if (amt > owed + 0.001) { window.utils.toast('المبلغ يتجاوز المتبقّي', 'error'); return; }
      submit(paid + amt);
    });
    ctrl.modal.querySelector('[data-action="close"]').addEventListener('click', ctrl.close);
  }

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

        const wantStatus = filterStatus.value;
        const filters = {};
        if (filterFrom.value) filters.from = filterFrom.value + 'T00:00:00';
        if (filterTo.value)   filters.to   = filterTo.value + 'T23:59:59';
        if (filterField.value) filters.fieldId = filterField.value;
        // مؤكد/مكتمل حالتان مشتقّتان تُحسبان في الواجهة — لا تُمرَّران لقاعدة البيانات
        if (wantStatus === 'pending' || wantStatus === 'cancelled') filters.status = wantStatus;

        const hasFilters = Object.keys(filters).length > 0 || !!wantStatus;
        buildChipRail({ from: filters.from, to: filters.to, fieldId: filters.fieldId, status: wantStatus });

        try {
          let bookings = await window.api.listBookings(filters);
          if (!alive) return;
          if (wantStatus === 'confirmed' || wantStatus === 'completed') {
            bookings = bookings.filter((b) => window.utils.effectiveBookingStatus(b) === wantStatus);
          }

          if (!bookings.length) {
            tableContainer.innerHTML = `
              <div class="card">
                <div class="empty-state">
                  <div class="empty-icon"><i data-lucide="clipboard-list"></i></div>
                  <h3>لا توجد حجوزات</h3>
                  <p>${hasFilters ? 'لا حجوزات تطابق الفلاتر — جرّب مسحها.' : 'لم يتم إنشاء أي حجز بعد.'}</p>
                  ${hasFilters ? '<button class="btn btn--secondary" id="empty-reset">مسح الفلاتر</button>' : ''}
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
              <table class="table table--cards">
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
                    const accepted = isAccepted(b);
                    const pay = accepted ? paymentInfo(b) : null;
                    const effStatus = window.utils.effectiveBookingStatus(b);
                    return `
                      <tr data-id="${b.id}" data-status="${window.utils.escapeHtml(effStatus)}">
                        <td data-label="التاريخ والوقت">${window.utils.formatDateTime(b.start_time)}</td>
                        <td data-label="الأرضية">${window.utils.escapeHtml(b.fields ? b.fields.name : '—')}</td>
                        <td data-label="العميل">
                          <div>${window.utils.escapeHtml(b.customers ? b.customers.full_name : '—')}</div>
                          ${b.customers && b.customers.phone ? `<div class="text-xs text-tertiary">${window.utils.escapeHtml(b.customers.phone)}</div>` : ''}
                        </td>
                        <td data-label="المدة" class="tabular-nums">${hours.toFixed(1)} س</td>
                        <td data-label="السعر" class="tabular-nums">${window.utils.formatPrice(b.total_price)}</td>
                        <td data-label="المدفوع" class="tabular-nums">
                          ${fmtMoney(b.paid_amount)}
                          ${pay ? `<div style="margin-top:4px">${paymentBadge(pay)}</div>` : ''}
                          ${pay && pay.owed > 0 ? `<div class="text-xs text-warning">يتبقّى ${fmtMoney(pay.owed)}</div>` : ''}
                        </td>
                        <td data-label="الحالة" class="card-tag">${statusChip(effStatus)}</td>
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
                            ${pay && pay.owed > 0 ? `
                              <button class="btn btn--xs btn--accent-quiet" data-action="pay" data-id="${b.id}" title="تسجيل دفعة">
                                <i data-lucide="banknote"></i><span class="btn-label">تحصيل</span>
                              </button>
                            ` : ''}
                            <button class="btn btn--xs btn--ghost" data-action="edit" data-id="${b.id}" title="تعديل">
                              <i data-lucide="pencil"></i><span class="btn-label">تعديل</span>
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

          // الفتح عبر زر التعديل الصريح فقط (لا نقر على الصف/الكرت)
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
              const ok = await window.utils.confirm({
                title: 'رفض الحجز',
                message: 'هل أنت متأكد من رفض هذا الحجز؟ سيتحرر الموعد للحجوزات الأخرى.',
                confirmText: 'تأكيد الرفض',
                danger: true
              });
              if (!ok) return;
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

          tableContainer.querySelectorAll('[data-action="pay"]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const booking = bookings.find((b) => b.id === btn.dataset.id);
              openPaymentDialog(booking, refresh);
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
