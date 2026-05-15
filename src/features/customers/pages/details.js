// تفاصيل العميل — رأس + بطاقات KPI + ودجت أعمار المدفوعات + سجل الحجوزات
(function () {
  function statusChip(status) {
    if (status === 'pending')   return '<span class="chip-status chip-status--pending">معلّق</span>';
    if (status === 'confirmed') return '<span class="chip-status chip-status--confirmed">مؤكد</span>';
    if (status === 'completed') return '<span class="chip-status chip-status--completed">مكتمل</span>';
    if (status === 'cancelled') return '<span class="chip-status chip-status--cancelled">ملغي</span>';
    return `<span class="chip-status chip-status--muted">${window.utils.escapeHtml(status)}</span>`;
  }

  function fmtMoney(v) { return window.utils.formatCurrency(v || 0); }

  function daysSince(date) {
    return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
  }

  // حساب أعمار المدفوعات — مبالغ غير مدفوعة موزّعة على فئات عمرية
  function computeAging(bookings) {
    const buckets = { '0-30': 0, '31-60': 0, '61+': 0 };
    bookings.forEach((b) => {
      if (b.status === 'cancelled') return;
      const owed = Number(b.total_price || 0) - Number(b.paid_amount || 0);
      if (owed <= 0) return;
      const age = daysSince(b.start_time);
      if (age <= 30) buckets['0-30'] += owed;
      else if (age <= 60) buckets['31-60'] += owed;
      else buckets['61+'] += owed;
    });
    return buckets;
  }

  function renderAgingWidget(aging) {
    const total = aging['0-30'] + aging['31-60'] + aging['61+'];
    if (total === 0) {
      return `
        <div class="card mb-md">
          <div class="card-body" style="display:flex;align-items:center;gap:var(--space-3)">
            <span class="stat-icon-chip stat-icon-chip--accent"><i data-lucide="check-circle-2"></i></span>
            <div>
              <div class="fw-semibold">لا توجد متأخرات</div>
              <div class="text-muted text-xs">جميع الحجوزات مدفوعة بالكامل</div>
            </div>
          </div>
        </div>
      `;
    }
    const pct = (v) => total ? (v / total) * 100 : 0;
    return `
      <div class="card mb-md">
        <div class="card-header">
          <div>
            <h3>أعمار المدفوعات</h3>
            <div class="text-muted text-xs">المبالغ غير المدفوعة حسب عمر الحجز</div>
          </div>
          <div class="text-end">
            <div class="text-xs text-tertiary">إجمالي المتأخر</div>
            <div class="fw-bold text-danger tabular-nums" style="font-size:var(--text-lg)">${fmtMoney(total)}</div>
          </div>
        </div>
        <div class="card-body">
          <div class="aging-bar">
            ${aging['0-30'] > 0 ? `<div class="aging-seg aging-seg--fresh" style="flex:${pct(aging['0-30'])}">
              <span>0-30 يوم</span>
              <strong>${fmtMoney(aging['0-30'])}</strong>
            </div>` : ''}
            ${aging['31-60'] > 0 ? `<div class="aging-seg aging-seg--warn" style="flex:${pct(aging['31-60'])}">
              <span>31-60 يوم</span>
              <strong>${fmtMoney(aging['31-60'])}</strong>
            </div>` : ''}
            ${aging['61+'] > 0 ? `<div class="aging-seg aging-seg--danger" style="flex:${pct(aging['61+'])}">
              <span>+60 يوم</span>
              <strong>${fmtMoney(aging['61+'])}</strong>
            </div>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  function openEditModal(customer, onSaved) {
    const formHtml = `
      <form id="customer-form" autocomplete="off">
        <div class="form-group">
          <label class="form-label">الاسم الكامل <span class="required">*</span></label>
          <input type="text" class="form-control" name="full_name" required value="${window.utils.escapeHtml(customer.full_name)}">
        </div>
        <div class="form-group">
          <label class="form-label">رقم الجوال <span class="required">*</span></label>
          <input type="tel" class="form-control" name="phone" required value="${window.utils.escapeHtml(customer.phone || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">ملاحظات <span class="optional">اختياري</span></label>
          <textarea class="form-control" name="notes" rows="3">${window.utils.escapeHtml(customer.notes || '')}</textarea>
        </div>
      </form>
    `;
    const footer = `
      <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
      <button type="submit" class="btn btn--primary" form="customer-form">حفظ</button>
    `;
    const ctrl = window.utils.openModal({ title: 'تعديل العميل', body: formHtml, footer });
    ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
    ctrl.modal.querySelector('#customer-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await window.api.updateCustomer(customer.id, {
          full_name: fd.get('full_name').trim(),
          phone:     fd.get('phone').trim(),
          notes:     fd.get('notes').trim() || null
        });
        window.utils.toast('تم تحديث العميل', 'success');
        if (window.store) window.store.invalidate('customers:all');
        ctrl.close();
        if (onSaved) onSaved();
      } catch (err) {
        window.utils.toast(window.utils.formatError(err), 'error');
      }
    });
  }

  const page = {
    async mount(container, ctx) {
      const id = (ctx && ctx.params && ctx.params[0]) || window.utils.getQueryParam('id');

      if (!id) {
        container.innerHTML = `
          <div class="card">
            <div class="empty-state">
              <div class="empty-icon"><i data-lucide="user-x"></i></div>
              <h3>عميل غير محدد</h3>
              <p><a href="${window.utils.path('/customers')}">العودة لقائمة العملاء</a></p>
            </div>
          </div>
        `;
        window.utils.renderIcons(container);
        return;
      }

      let alive = true;
      const cleanup = [];
      page._cleanup = cleanup;

      async function render() {
        if (!alive) return;
        container.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
        try {
          const [customer, bookings] = await Promise.all([
            window.api.getCustomer(id),
            window.api.getCustomerBookings(id)
          ]);
          if (!alive) return;

          // breadcrumb للصفحات العميقة
          if (window.layout && window.layout.setBreadcrumbs) {
            window.layout.setBreadcrumbs([
              { label: 'العملاء', path: '/customers' },
              { label: customer.full_name }
            ]);
          }

          const active = bookings.filter((b) => b.status !== 'cancelled');
          const totalSpent = active.reduce((sum, b) => sum + Number(b.total_price || 0), 0);
          const totalPaid  = active.reduce((sum, b) => sum + Number(b.paid_amount || 0), 0);
          const balance    = totalSpent - totalPaid;

          const aging = computeAging(bookings);

          container.innerHTML = `
            <div class="page-header">
              <div>
                <h2 style="display:flex;align-items:center;gap:var(--space-3)">
                  <span class="user-avatar" style="width:36px;height:36px;font-size:var(--text-md);background:var(--accent-500);color:var(--text-on-accent);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:var(--weight-semibold)">${window.utils.escapeHtml((customer.full_name || '?').charAt(0))}</span>
                  ${window.utils.escapeHtml(customer.full_name)}
                </h2>
                <div class="page-subtitle">
                  <i data-lucide="phone" style="width:14px;height:14px"></i>
                  ${window.utils.escapeHtml(customer.phone || '—')}
                </div>
              </div>
              <div class="actions">
                <button class="btn btn--secondary" id="edit-customer-btn">
                  <i data-lucide="pencil"></i> تعديل البيانات
                </button>
                <button class="btn btn--primary" id="new-booking-btn">
                  <i data-lucide="plus"></i> حجز جديد
                </button>
              </div>
            </div>

            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-card-head">
                  <span class="stat-icon-chip"><i data-lucide="calendar-check"></i></span>
                  <span class="stat-label">إجمالي الحجوزات</span>
                </div>
                <div class="stat-value">${active.length}</div>
                <div class="stat-sub">من أصل ${bookings.length} حجزاً مسجّلاً</div>
              </div>
              <div class="stat-card">
                <div class="stat-card-head">
                  <span class="stat-icon-chip stat-icon-chip--accent"><i data-lucide="banknote"></i></span>
                  <span class="stat-label">إجمالي الفواتير</span>
                </div>
                <div class="stat-value">${fmtMoney(totalSpent)}</div>
              </div>
              <div class="stat-card">
                <div class="stat-card-head">
                  <span class="stat-icon-chip stat-icon-chip--accent"><i data-lucide="circle-check"></i></span>
                  <span class="stat-label">المدفوع</span>
                </div>
                <div class="stat-value text-success">${fmtMoney(totalPaid)}</div>
              </div>
              <div class="stat-card${balance > 0 ? ' stat-card--warning' : ''}">
                <div class="stat-card-head">
                  <span class="stat-icon-chip ${balance > 0 ? 'stat-icon-chip--warning' : ''}"><i data-lucide="receipt"></i></span>
                  <span class="stat-label">المتبقي</span>
                </div>
                <div class="stat-value ${balance > 0 ? 'text-warning' : ''}">${fmtMoney(balance)}</div>
              </div>
            </div>

            ${renderAgingWidget(aging)}

            ${customer.notes ? `
              <div class="card mb-md">
                <div class="card-body" style="display:flex;gap:var(--space-3);align-items:flex-start">
                  <span class="stat-icon-chip stat-icon-chip--info"><i data-lucide="sticky-note"></i></span>
                  <div>
                    <div class="text-xs text-tertiary fw-medium mb-sm">ملاحظات</div>
                    <div>${window.utils.escapeHtml(customer.notes)}</div>
                  </div>
                </div>
              </div>
            ` : ''}

            <div class="card">
              <div class="card-header">
                <h3>سجل الحجوزات</h3>
                <span class="card-header-meta">${bookings.length} حجز</span>
              </div>
              ${bookings.length === 0 ? `
                <div class="empty-state">
                  <div class="empty-icon"><i data-lucide="calendar-x"></i></div>
                  <h3>لا توجد حجوزات</h3>
                  <p>لم يقم هذا العميل بأي حجز بعد.</p>
                </div>
              ` : `
                <div class="table-wrapper" style="box-shadow:none;border-radius:0">
                  <table class="table table--sticky-first">
                    <thead>
                      <tr>
                        <th>التاريخ والوقت</th>
                        <th>الأرضية</th>
                        <th>المدة</th>
                        <th>السعر</th>
                        <th>المدفوع</th>
                        <th>الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${bookings.map((b) => {
                        const hours = window.utils.hoursBetween(b.start_time, b.end_time);
                        const owed  = Number(b.total_price || 0) - Number(b.paid_amount || 0);
                        return `
                          <tr data-status="${window.utils.escapeHtml(b.status)}" data-id="${b.id}" class="is-clickable">
                            <td>${window.utils.formatDateTime(b.start_time)}</td>
                            <td>${window.utils.escapeHtml(b.fields ? b.fields.name : '—')}</td>
                            <td class="tabular-nums">${hours.toFixed(1)} س</td>
                            <td class="tabular-nums">${fmtMoney(b.total_price)}</td>
                            <td class="tabular-nums">
                              ${fmtMoney(b.paid_amount)}
                              ${owed > 0 && b.status !== 'cancelled' ? `<div class="text-xs text-warning">يتبقّى ${fmtMoney(owed)}</div>` : ''}
                            </td>
                            <td>${statusChip(b.status)}</td>
                          </tr>
                        `;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
              `}
            </div>
          `;

          // ربط الأفعال
          container.querySelector('#edit-customer-btn').addEventListener('click', () => openEditModal(customer, render));

          const newBtn = container.querySelector('#new-booking-btn');
          if (newBtn) {
            newBtn.addEventListener('click', () => {
              window.bookingModal.open({
                prefillCustomer: customer,
                onSaved: render
              });
            });
          }

          container.querySelectorAll('tr[data-id]').forEach((tr) => {
            tr.addEventListener('click', () => {
              const booking = bookings.find((b) => b.id === tr.dataset.id);
              if (booking) window.bookingModal.open({ booking, onSaved: render });
            });
          });

          window.utils.renderIcons(container);
        } catch (err) {
          if (!alive) return;
          container.innerHTML = `
            <div class="card">
              <div class="empty-state">
                <div class="empty-icon"><i data-lucide="triangle-alert"></i></div>
                <p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p>
                <a href="${window.utils.path('/customers')}" class="btn btn--secondary">العودة للقائمة</a>
              </div>
            </div>
          `;
          window.utils.renderIcons(container);
        }
      }

      cleanup.push(() => { alive = false; });

      if (window.realtime) {
        const debouncedRender = window.utils.debounce(render, 400);
        cleanup.push(window.realtime.on('bookings:change', debouncedRender));
        cleanup.push(window.realtime.on('customers:change', debouncedRender));
      }

      render();
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages['customer-details'] = page;
})();
