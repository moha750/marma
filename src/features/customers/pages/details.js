// صفحة تفاصيل العميل - module pattern (SPA + legacy)
// في SPA: المعرّف من route params (#/customer-details/:id)
// في legacy: من ?id= في الـ query string
(function () {
  function renderStatusBadge(status) {
    if (status === 'pending') return '<span class="badge badge--warning">بانتظار الموافقة</span>';
    if (status === 'confirmed') return '<span class="badge badge--success">مؤكد</span>';
    if (status === 'completed') return '<span class="badge badge--info">مكتمل</span>';
    if (status === 'cancelled') return '<span class="badge badge--danger">ملغي</span>';
    return `<span class="badge badge--muted">${window.utils.escapeHtml(status)}</span>`;
  }

  const customersHref = () => '/customers';

  const page = {
    async mount(container, ctx) {
      const id = (ctx && ctx.params && ctx.params[0]) || window.utils.getQueryParam('id');

      if (!id) {
        container.innerHTML = `
          <div class="card">
            <div class="empty-state">
              <h3>عميل غير محدد</h3>
              <p><a href="${customersHref()}">العودة لقائمة العملاء</a></p>
            </div>
          </div>
        `;
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

          const totalSpent = bookings
            .filter((b) => b.status !== 'cancelled')
            .reduce((sum, b) => sum + Number(b.total_price || 0), 0);
          const totalPaid = bookings
            .filter((b) => b.status !== 'cancelled')
            .reduce((sum, b) => sum + Number(b.paid_amount || 0), 0);

          container.innerHTML = `
            <div class="page-header">
              <div>
                <a href="${customersHref()}" class="text-muted" style="font-size:0.9rem">← العودة للعملاء</a>
                <h2 style="margin-top:8px">${window.utils.escapeHtml(customer.full_name)}</h2>
              </div>
              <div class="actions">
                <button class="btn btn--secondary" id="edit-customer-btn">تعديل البيانات</button>
              </div>
            </div>

            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-label">رقم الجوال</div>
                <div class="stat-value" style="font-size:1.3rem">${window.utils.escapeHtml(customer.phone)}</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">إجمالي الحجوزات</div>
                <div class="stat-value">${bookings.filter((b) => b.status !== 'cancelled').length}</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">إجمالي المدفوع</div>
                <div class="stat-value">${window.utils.formatCurrency(totalPaid)}</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">المتبقي</div>
                <div class="stat-value">${window.utils.formatCurrency(totalSpent - totalPaid)}</div>
              </div>
            </div>

            ${customer.notes ? `<div class="card mb-md"><div class="card-body"><strong>ملاحظات:</strong> ${window.utils.escapeHtml(customer.notes)}</div></div>` : ''}

            <div class="card">
              <div class="card-header">سجل الحجوزات</div>
              ${bookings.length === 0
                ? '<div class="empty-state"><p>لا توجد حجوزات لهذا العميل بعد</p></div>'
                : `
                <div class="table-wrapper">
                  <table class="table">
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
                        return `
                          <tr>
                            <td>${window.utils.formatDateTime(b.start_time)}</td>
                            <td>${window.utils.escapeHtml(b.fields ? b.fields.name : '—')}</td>
                            <td>${hours.toFixed(1)} ساعة</td>
                            <td>${window.utils.formatCurrency(b.total_price)}</td>
                            <td>${window.utils.formatCurrency(b.paid_amount)}</td>
                            <td>${renderStatusBadge(b.status)}</td>
                          </tr>
                        `;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
              `}
            </div>
          `;

          const editBtn = container.querySelector('#edit-customer-btn');
          editBtn.addEventListener('click', () => openEditModal(customer));
        } catch (err) {
          if (!alive) return;
          container.innerHTML = `<div class="card"><div class="empty-state"><p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p></div></div>`;
        }
      }

      function openEditModal(customer) {
        const formHtml = `
          <form id="customer-form" autocomplete="off">
            <div class="form-group">
              <label class="form-label">الاسم الكامل <span class="required">*</span></label>
              <input type="text" class="form-control" name="full_name" required value="${window.utils.escapeHtml(customer.full_name)}">
            </div>
            <div class="form-group">
              <label class="form-label">رقم الجوال <span class="required">*</span></label>
              <input type="tel" class="form-control" name="phone" required value="${window.utils.escapeHtml(customer.phone)}">
            </div>
            <div class="form-group">
              <label class="form-label">ملاحظات</label>
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
              phone: fd.get('phone').trim(),
              notes: fd.get('notes').trim() || null
            });
            window.utils.toast('تم تحديث العميل', 'success');
            if (window.store) window.store.invalidate('customers:all');
            ctrl.close();
            render();
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
          }
        });
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
