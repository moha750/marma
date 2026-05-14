// صفحة الاشتراك - module pattern (SPA + legacy)
// ملاحظة: هذه الصفحة قد تُفتح حتى لو الاشتراك منتهٍ (skipActiveCheck=true في legacy)
(function () {
  const TEMPLATE = `
    <div class="page-header">
      <h2>الاشتراك</h2>
    </div>
    <div id="subscription-container">
      <div class="loader-center"><div class="loader loader--lg"></div></div>
    </div>
  `;

  function phaseLabel(phase) {
    return ({
      trial: 'تجربة مجانية',
      active: 'اشتراك نشط',
      grace_trial: 'انتهت التجربة (فترة سماح)',
      grace_active: 'انتهى الاشتراك (فترة سماح)',
      expired: 'منتهي',
      none: 'غير معرّف'
    })[phase] || phase;
  }

  function phaseBadge(phase) {
    const cls = ({
      trial: 'trial',
      active: 'active',
      grace_trial: 'grace',
      grace_active: 'grace',
      expired: 'expired'
    })[phase] || 'trial';
    return `<span class="status-badge status-badge--${cls}">${window.utils.escapeHtml(phaseLabel(phase))}</span>`;
  }

  function statusBadge(s) {
    const map = { pending: 'بانتظار الموافقة', approved: 'تمت الموافقة', rejected: 'مرفوض' };
    return `<span class="status-badge status-badge--${s}">${map[s] || s}</span>`;
  }

  const page = {
    async mount(container, ctx) {
      container.innerHTML = TEMPLATE;
      const isOwner = ctx.profile.role === 'owner';
      const subContainer = container.querySelector('#subscription-container');

      let alive = true;
      const cleanup = [];
      page._cleanup = cleanup;

      async function refresh() {
        if (!alive) return;
        subContainer.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
        try {
          const [status, plans, history] = await Promise.all([
            window.auth.loadSubscriptionStatus({ force: true }),
            window.api.listPlans(),
            window.api.listMySubscriptions()
          ]);
          if (!alive) return;
          subContainer.innerHTML = renderPage(status, plans, history, isOwner);
          window.utils.renderIcons(subContainer);
          wireEvents(plans);
        } catch (err) {
          if (!alive) return;
          subContainer.innerHTML = `<div class="card"><div class="empty-state"><div class="icon"><i data-lucide="triangle-alert"></i></div><h3>تعذّر تحميل بيانات الاشتراك</h3><p>${window.utils.escapeHtml(window.utils.formatError(err))}</p></div></div>`;
          window.utils.renderIcons(subContainer);
        }
      }

      function renderPage(status, plans, history, isOwner) {
        const phase = status ? status.phase : 'none';
        const days = status ? Math.max(0, Number(status.days_remaining) || 0) : 0;
        const effEnd = status && status.effective_end ? window.utils.formatDateTime(status.effective_end) : '—';
        const hasPending = status && status.pending_request_id;

        const callout = !status || !status.is_active
          ? `<div class="trial-banner trial-banner--grace" style="margin-bottom:16px"><span class="trial-banner-icon"><i data-lucide="triangle-alert"></i></span><span>الخدمة مغلقة حالياً. اشترك لتفعيل حسابك مجدداً.</span></div>`
          : (phase === 'trial'
              ? `<div class="trial-banner trial-banner--trial" style="margin-bottom:16px"><span class="trial-banner-icon"><i data-lucide="info"></i></span><span>تجربتك المجانية نشطة - يمكنك الاشتراك في أي وقت لتجنب الانقطاع.</span></div>`
              : (phase.startsWith('grace_')
                  ? `<div class="trial-banner trial-banner--grace" style="margin-bottom:16px"><span class="trial-banner-icon"><i data-lucide="triangle-alert"></i></span><span>أنت في فترة السماح - يرجى تجديد الاشتراك خلال ${days} ${days===1?'يوم':'أيام'}.</span></div>`
                  : ''));

        return `
          ${callout}

          <div class="subscription-status-card">
            <h2>الحالة الحالية ${phaseBadge(phase)}</h2>
            <div class="meta">
              <div>تاريخ الانتهاء الفعلي: <strong>${window.utils.escapeHtml(effEnd)}</strong></div>
              ${status && status.is_active
                ? `<div>متبقي حتى الإغلاق الكامل: <strong>${days} ${days===1?'يوم':'أيام'}</strong></div>`
                : '<div>الحساب مغلق - يرجى الاشتراك للمتابعة.</div>'}
              ${hasPending ? '<div style="margin-top:8px"><span class="status-badge status-badge--pending">يوجد طلب اشتراك بانتظار موافقة المشرف</span></div>' : ''}
            </div>
          </div>

          <div class="card">
            <div class="card-header"><h3>الخطط المتاحة</h3></div>
            <div class="card-body">
              ${plans.length === 0 ? '<p class="text-muted">لا توجد خطط متاحة حالياً.</p>' : ''}
              <div class="plans-grid">
                ${plans.map((p) => `
                  <div class="plan-card">
                    <div style="font-weight:700">${window.utils.escapeHtml(p.name)}</div>
                    <div class="price">${window.utils.formatCurrency(p.price)}</div>
                    <div class="text-muted" style="font-size:0.85rem">لمدة ${p.duration_days} يوم</div>
                    ${isOwner ? `
                      <button class="btn btn--primary btn--block mt-md" data-action="request" data-plan-id="${p.id}" ${hasPending ? 'disabled' : ''}>
                        ${hasPending ? 'يوجد طلب معلق' : 'اطلب هذه الخطة'}
                      </button>
                    ` : ''}
                  </div>
                `).join('')}
              </div>
              ${!isOwner ? '<p class="text-muted mt-md" style="font-size:0.9rem">طلب الاشتراك متاح لمالك الملعب فقط.</p>' : ''}
            </div>
          </div>

          <div class="card mt-md">
            <div class="card-header"><h3>سجل الطلبات</h3></div>
            <div class="card-body">
              ${history.length === 0 ? '<p class="text-muted">لا توجد طلبات سابقة.</p>' : `
                <div class="table-wrapper">
                  <table class="table">
                    <thead>
                      <tr>
                        <th>التاريخ</th>
                        <th>الخطة</th>
                        <th>المبلغ</th>
                        <th>المرجع</th>
                        <th>الحالة</th>
                        <th>الفترة</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${history.map((h) => `
                        <tr>
                          <td>${window.utils.formatDateTime(h.created_at)}</td>
                          <td>${window.utils.escapeHtml(h.plan_name)}</td>
                          <td>${window.utils.formatCurrency(h.amount)}</td>
                          <td>${window.utils.escapeHtml(h.payment_reference || '')}</td>
                          <td>${statusBadge(h.status)}${h.reject_reason ? `<div class="text-muted" style="font-size:0.8rem">${window.utils.escapeHtml(h.reject_reason)}</div>` : ''}</td>
                          <td>${h.period_start ? `${window.utils.formatDate(h.period_start)} → ${window.utils.formatDate(h.period_end)}` : '—'}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              `}
            </div>
          </div>
        `;
      }

      function wireEvents(plans) {
        subContainer.querySelectorAll('[data-action="request"]').forEach((btn) => {
          btn.addEventListener('click', () => {
            if (btn.disabled) return;
            const plan = plans.find((p) => p.id === btn.dataset.planId);
            if (plan) openRequestModal(plan);
          });
        });
      }

      function openRequestModal(plan) {
        const ctrl = window.utils.openModal({
          title: `طلب اشتراك: ${plan.name}`,
          body: `
            <p>سعر الخطة: <strong>${window.utils.formatCurrency(plan.price)}</strong> لمدة ${plan.duration_days} يوم.</p>
            <p class="text-muted" style="font-size:0.9rem">قم بتحويل المبلغ ثم أدخل رقم/مرجع التحويل أدناه. سيراجع المشرف الطلب وسيُفعّل الاشتراك عند التأكد من الدفع.</p>
            <form id="req-form">
              <div class="form-group">
                <label class="form-label">رقم/مرجع التحويل <span class="required">*</span></label>
                <input type="text" class="form-control" name="payment_reference" required maxlength="120">
              </div>
              <div class="form-group">
                <label class="form-label">ملاحظة (اختياري)</label>
                <textarea class="form-control" name="note" rows="2" maxlength="500"></textarea>
              </div>
            </form>
          `,
          footer: `
            <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
            <button type="submit" class="btn btn--primary" form="req-form" id="req-submit">إرسال الطلب</button>
          `
        });

        ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
        ctrl.modal.querySelector('#req-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const submit = ctrl.modal.querySelector('#req-submit');
          submit.disabled = true;
          submit.textContent = 'جارٍ الإرسال...';
          const fd = new FormData(e.target);
          try {
            await window.api.requestSubscription({
              plan_id: plan.id,
              payment_reference: (fd.get('payment_reference') || '').trim(),
              note: (fd.get('note') || '').trim() || null
            });
            window.utils.toast('تم إرسال طلب الاشتراك بنجاح', 'success');
            ctrl.close();
            await refresh();
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
            submit.disabled = false;
            submit.textContent = 'إرسال الطلب';
          }
        });
      }

      cleanup.push(() => { alive = false; });

      await refresh();
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages.subscription = page;
})();
