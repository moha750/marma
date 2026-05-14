// لوحة المشرف العام - طلبات الاشتراك المعلقة
(async function () {
  await window.adminLayout.renderShell({
    activeTab: 'subscriptions',
    pageTitle: 'طلبات الاشتراك'
  });

  const container = document.getElementById('admin-subs-container');

  async function refresh() {
    container.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
    try {
      const pending = await window.api.adminListPendingSubscriptions();
      container.innerHTML = render(pending);
      window.utils.renderIcons(container);
      wire(pending);
    } catch (err) {
      container.innerHTML = `<div class="card"><div class="empty-state"><div class="icon"><i data-lucide="triangle-alert"></i></div><h3>تعذّر تحميل البيانات</h3><p>${window.utils.escapeHtml(window.utils.formatError(err))}</p></div></div>`;
      window.utils.renderIcons(container);
    }
  }

  function render(pending) {
    if (!pending.length) {
      return `<div class="card"><div class="empty-state"><div class="icon"><i data-lucide="check-circle-2"></i></div><h3>لا توجد طلبات معلقة</h3><p>كل الطلبات تمت مراجعتها.</p></div></div>`;
    }
    return `
      <div class="card">
        <div class="card-body">
          <div class="table-wrapper">
            <table class="table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>الملعب</th>
                  <th>الخطة</th>
                  <th>المبلغ</th>
                  <th>المرجع</th>
                  <th>ملاحظة</th>
                  <th class="text-end">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                ${pending.map((s) => `
                  <tr>
                    <td>${window.utils.formatDateTime(s.created_at)}</td>
                    <td><strong>${window.utils.escapeHtml(s.tenant_name)}</strong></td>
                    <td>${window.utils.escapeHtml(s.plan_name)}</td>
                    <td>${window.utils.formatCurrency(s.amount)}</td>
                    <td><code>${window.utils.escapeHtml(s.payment_reference)}</code></td>
                    <td>${s.note ? window.utils.escapeHtml(s.note) : '—'}</td>
                    <td class="text-end">
                      <button class="btn btn--primary btn--sm" data-action="approve" data-id="${s.id}" data-tenant="${window.utils.escapeHtml(s.tenant_name)}">موافقة</button>
                      <button class="btn btn--danger btn--sm" data-action="reject" data-id="${s.id}" data-tenant="${window.utils.escapeHtml(s.tenant_name)}">رفض</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  function wire() {
    container.querySelectorAll('[data-action="approve"]').forEach((btn) => {
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
          await refresh();
        } catch (err) {
          window.utils.toast(window.utils.formatError(err), 'error');
        }
      });
    });

    container.querySelectorAll('[data-action="reject"]').forEach((btn) => {
      btn.addEventListener('click', () => openRejectModal(btn.dataset.id, btn.dataset.tenant));
    });
  }

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
        await refresh();
      } catch (err) {
        window.utils.toast(window.utils.formatError(err), 'error');
        submit.disabled = false;
        submit.textContent = 'تأكيد الرفض';
      }
    });
  }

  await refresh();
})();
