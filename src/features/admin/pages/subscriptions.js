// لوحة المشرف العام — طلبات الاشتراك المعلّقة (نمط SPA: mount/unmount)
(function () {
  function render(pending) {
    if (!pending.length) {
      return `<div class="card"><div class="empty-state"><div class="empty-icon"><i data-lucide="check-circle-2"></i></div><h3>لا توجد طلبات معلقة</h3><p>كل الطلبات تمت مراجعتها.</p></div></div>`;
    }
    return `
      <div class="table-wrapper">
        <table class="table table--cards">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الملعب</th>
                  <th>الباقة المطلوبة</th>
                  <th>المبلغ</th>
                  <th>المرجع</th>
                  <th>ملاحظة</th>
                  <th class="text-end">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                ${pending.map((s) => `
                  <tr>
                    <td data-label="التاريخ">${window.utils.formatDateTime(s.created_at)}</td>
                    <td data-label="الملعب" class="fw-semibold">${window.utils.escapeHtml(s.tenant_name)}</td>
                    <td data-label="الباقة المطلوبة" class="tabular-nums">
                      ${s.requested_fields || '—'} أرضية + ${s.requested_staff || '—'} موظف
                      <div class="text-xs text-tertiary">${window.utils.escapeHtml(s.plan_name)}</div>
                    </td>
                    <td data-label="المبلغ">${window.utils.formatCurrency(s.amount)}</td>
                    <td data-label="المرجع"><code>${window.utils.escapeHtml(s.payment_reference)}</code></td>
                    <td data-label="ملاحظة">${s.note ? window.utils.escapeHtml(s.note) : '—'}</td>
                    <td data-label="إجراءات" class="actions-cell text-end">
                      <button class="btn btn--primary btn--sm" data-action="approve" data-id="${s.id}" data-tenant="${window.utils.escapeHtml(s.tenant_name)}">موافقة</button>
                      <button class="btn btn--danger btn--sm" data-action="reject" data-id="${s.id}" data-tenant="${window.utils.escapeHtml(s.tenant_name)}">رفض</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
        </table>
      </div>
    `;
  }

  const page = {
    async mount(container) {
      container.innerHTML = `
        <div class="page-header">
          <div>
            <h2>طلبات الاشتراك</h2>
            <div class="page-subtitle">راجع الطلبات المعلّقة ووافق أو ارفض</div>
          </div>
        </div>
        <div id="admin-subs-body"></div>
      `;
      window.utils.renderIcons(container);

      const body = container.querySelector('#admin-subs-body');
      let alive = true;
      page._cleanup = [() => { alive = false; }];

      function openRejectModal(id, tenantName) {
        const ctrl = window.utils.openModal({
          title: 'رفض الطلب',
          body: `
            <p>الملعب: <strong>${window.utils.escapeHtml(tenantName)}</strong></p>
            <form id="rej-form">
              <div class="form-group">
                <label class="form-label">سبب الرفض <span class="required">*</span></label>
                <textarea class="form-control" name="reason" rows="3" required maxlength="500" placeholder="مثلاً: لم نتمكن من تأكيد الدفع..."></textarea>
              </div>
            </form>
          `,
          footer: `
            <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
            <button type="submit" class="btn btn--danger" form="rej-form" id="rej-submit">تأكيد الرفض</button>
          `
        });
        ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
        ctrl.modal.querySelector('#rej-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const submit = ctrl.modal.querySelector('#rej-submit');
          submit.disabled = true;
          submit.textContent = 'جارٍ الرفض...';
          const fd = new FormData(e.target);
          try {
            await window.api.rejectSubscription(id, (fd.get('reason') || '').trim());
            window.utils.toast('تم رفض الطلب', 'success');
            ctrl.close();
            refresh();
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
            submit.disabled = false;
            submit.textContent = 'تأكيد الرفض';
          }
        });
      }

      function wire() {
        body.querySelectorAll('[data-action="approve"]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const ok = await window.utils.confirm({
              title: 'تأكيد الموافقة',
              message: `هل أنت متأكد من الموافقة على اشتراك "${btn.dataset.tenant}"؟ سيتم تفعيل الاشتراك فوراً.`,
              confirmText: 'موافقة'
            });
            if (!ok) return;
            try {
              await window.api.approveSubscription(btn.dataset.id);
              window.utils.toast('تمت الموافقة وتفعيل الاشتراك', 'success');
              refresh();
            } catch (err) {
              window.utils.toast(window.utils.formatError(err), 'error');
            }
          });
        });
        body.querySelectorAll('[data-action="reject"]').forEach((btn) => {
          btn.addEventListener('click', () => openRejectModal(btn.dataset.id, btn.dataset.tenant));
        });
      }

      async function refresh() {
        if (!alive) return;
        body.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
        try {
          const pending = await window.api.adminListPendingSubscriptions();
          if (!alive) return;
          body.innerHTML = render(pending);
          window.utils.renderIcons(body);
          wire();
        } catch (err) {
          if (!alive) return;
          body.innerHTML = `<div class="card"><div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert"></i></div><h3>تعذّر تحميل البيانات</h3><p>${window.utils.escapeHtml(window.utils.formatError(err))}</p></div></div>`;
          window.utils.renderIcons(body);
        }
      }
      page._refresh = refresh;

      refresh();
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
      page._refresh = null;
    }
  };

  window.pages = window.pages || {};
  window.pages['admin-subscriptions'] = page;
})();
