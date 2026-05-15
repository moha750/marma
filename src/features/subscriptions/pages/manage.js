// صفحة الاشتراك — Counter-based (يعتمد window.pricing)
(function () {
  const TEMPLATE = `
    <div class="page-header">
      <div>
        <h2>الاشتراك</h2>
        <div class="page-subtitle">إدارة اشتراك ملعبك في مَرمى</div>
      </div>
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

  function phaseChip(phase) {
    const cls = ({
      trial: 'info', active: 'success',
      grace_trial: 'warning', grace_active: 'warning',
      expired: 'danger'
    })[phase] || 'muted';
    return `<span class="chip-status chip-status--${cls}">${window.utils.escapeHtml(phaseLabel(phase))}</span>`;
  }

  function reqChip(s) {
    const map = { pending: 'بانتظار الموافقة', approved: 'تمت الموافقة', rejected: 'مرفوض' };
    const cls = ({ pending: 'pending', approved: 'approved', rejected: 'rejected' })[s] || 'muted';
    return `<span class="chip-status chip-status--${cls}">${map[s] || s}</span>`;
  }

  function fmtMoney(v) { return window.utils.formatCurrency(v || 0); }

  const page = {
    async mount(container, ctx) {
      container.innerHTML = TEMPLATE;
      window.utils.renderIcons(container);

      const isOwner = ctx.profile.role === 'owner';
      const subContainer = container.querySelector('#subscription-container');

      let alive = true;
      const cleanup = [];
      page._cleanup = cleanup;

      let basePlan = null;
      let lastStatus = null;

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
          lastStatus = status;
          basePlan = (plans && plans[0]) || null;
          subContainer.innerHTML = renderPage(status, history);
          window.utils.renderIcons(subContainer);
          wireEvents();
        } catch (err) {
          if (!alive) return;
          subContainer.innerHTML = `
            <div class="card"><div class="card-body">
              <div class="empty-state">
                <div class="empty-icon"><i data-lucide="triangle-alert"></i></div>
                <h3>تعذّر تحميل بيانات الاشتراك</h3>
                <p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p>
              </div>
            </div></div>
          `;
          window.utils.renderIcons(subContainer);
        }
      }

      function renderCallout(status, days) {
        if (!status || !status.is_active) {
          return `
            <div class="trial-banner trial-banner--grace" style="margin-bottom: var(--space-4); border-radius: var(--radius-md)">
              <span class="trial-banner-icon"><i data-lucide="triangle-alert"></i></span>
              <span>الخدمة مغلقة حالياً. اشترك لتفعيل حسابك مجدداً.</span>
            </div>`;
        }
        const phase = status.phase;
        if (phase === 'trial') {
          return `
            <div class="trial-banner trial-banner--trial" style="margin-bottom: var(--space-4); border-radius: var(--radius-md)">
              <span class="trial-banner-icon"><i data-lucide="info"></i></span>
              <span>تجربتك المجانية نشطة (أرضية واحدة، بدون موظفين). يمكنك ترقية باقتك في أي وقت.</span>
            </div>`;
        }
        if (phase && phase.startsWith('grace_')) {
          return `
            <div class="trial-banner trial-banner--grace" style="margin-bottom: var(--space-4); border-radius: var(--radius-md)">
              <span class="trial-banner-icon"><i data-lucide="triangle-alert"></i></span>
              <span>أنت في فترة السماح — يرجى تجديد الاشتراك خلال ${days} ${days === 1 ? 'يوم' : 'أيام'}.</span>
            </div>`;
        }
        return '';
      }

      function renderStatusCard(status) {
        const phase  = status ? status.phase : 'none';
        const days   = status ? Math.max(0, Number(status.days_remaining) || 0) : 0;
        const effEnd = status && status.effective_end ? window.utils.formatDateTime(status.effective_end) : '—';
        const allowedFields = status ? (status.allowed_fields || 1) : 1;
        const allowedStaff  = status ? (status.allowed_staff  || 0) : 0;
        const currentFields = status ? (status.current_fields || 0) : 0;
        const currentStaff  = status ? (status.current_staff  || 0) : 0;

        return `
          <div class="card mb-md">
            <div class="card-body" style="display:flex;gap:var(--space-4);align-items:center;flex-wrap:wrap">
              <div style="flex:1;min-width:200px">
                <div class="text-xs text-tertiary fw-medium mb-sm">الحالة الحالية</div>
                <div>${phaseChip(phase)}</div>
              </div>
              <div style="min-width:180px">
                <div class="text-xs text-tertiary fw-medium mb-sm">تاريخ الانتهاء</div>
                <div class="fw-semibold tabular-nums">${window.utils.escapeHtml(effEnd)}</div>
              </div>
              ${status && status.is_active ? `
                <div style="min-width:120px">
                  <div class="text-xs text-tertiary fw-medium mb-sm">المتبقي</div>
                  <div class="fw-bold tabular-nums" style="font-size:var(--text-lg)">${days} ${days === 1 ? 'يوم' : 'أيام'}</div>
                </div>
              ` : ''}
              <div style="min-width:140px">
                <div class="text-xs text-tertiary fw-medium mb-sm">الأرضيات</div>
                <div class="fw-semibold tabular-nums">${currentFields} / ${allowedFields}</div>
              </div>
              <div style="min-width:140px">
                <div class="text-xs text-tertiary fw-medium mb-sm">الموظفون</div>
                <div class="fw-semibold tabular-nums">${currentStaff} / ${allowedStaff}</div>
              </div>
            </div>
          </div>
        `;
      }

      function renderCounter(name, value, min, max, label, hint) {
        return `
          <div class="form-group">
            <label class="form-label">${window.utils.escapeHtml(label)}</label>
            <div class="unit-counter" data-counter="${name}">
              <button type="button" class="btn btn--secondary btn--sm" data-action="dec" aria-label="إنقاص">−</button>
              <input type="text" name="${name}" value="${value}" data-min="${min}" data-max="${max}" inputmode="numeric" pattern="[0-9]*" maxlength="2">
              <button type="button" class="btn btn--secondary btn--sm" data-action="inc" aria-label="زيادة">+</button>
            </div>
            ${hint ? `<span class="form-help">${window.utils.escapeHtml(hint)}</span>` : ''}
          </div>
        `;
      }

      function renderBreakdown(fields, staff) {
        const b = window.pricing.breakdown(fields, staff);
        return `
          <div class="invoice-lines">
            ${b.lines.map((l) => `
              <div class="invoice-line">
                <span>${window.utils.escapeHtml(l.label)}</span>
                <span class="tabular-nums">${fmtMoney(l.amount)}</span>
              </div>
            `).join('')}
            <div class="invoice-line invoice-line--total">
              <span>المجموع شهرياً</span>
              <span class="tabular-nums">${fmtMoney(b.total)}</span>
            </div>
          </div>
        `;
      }

      function renderConfigCard(status) {
        const allowedFields = status ? (status.allowed_fields || 1) : 1;
        const allowedStaff  = status ? (status.allowed_staff  || 0) : 0;
        const currentFields = status ? (status.current_fields || 0) : 0;
        const currentStaff  = status ? (status.current_staff  || 0) : 0;
        const hasPending    = !!(status && status.pending_request_id);
        // الحد الأدنى = ما هو نشط فعلياً (حتى لا يطلب أقل من احتياجه)
        const minFields = Math.max(1, currentFields, 1);
        const minStaff  = Math.max(1, currentStaff);
        // افتراضي مبدئي = الأعلى بين الحالي والمسموح
        const initFields = Math.max(minFields, allowedFields);
        const initStaff  = Math.max(minStaff,  allowedStaff, 1);

        return `
          <div class="card mb-md" id="config-card">
            <div class="card-header">
              <h3>اختر باقتك</h3>
              ${!isOwner ? '<span class="card-header-meta">للمالك فقط</span>' : (hasPending ? '<span class="card-header-meta">لديك طلب معلّق</span>' : '')}
            </div>
            <div class="card-body">
              <p class="text-muted text-sm mb-md">
                الباقة الأساسية ${fmtMoney(window.pricing.BASE_PRICE)} شهرياً تشمل أرضية واحدة وموظفاً واحداً.
                كل وحدة إضافية (أرضية أو موظف) بـ ${fmtMoney(window.pricing.UNIT_PRICE)}.
              </p>

              <div class="form-row cols-2">
                ${renderCounter('fields', initFields, minFields, 50, 'عدد الأرضيات', `الحد الأدنى ${minFields} (لديك ${currentFields} نشطة)`)}
                ${renderCounter('staff',  initStaff,  minStaff,  50, 'عدد الموظفين', `الحد الأدنى ${minStaff} (لديك ${currentStaff} حالياً)`)}
              </div>

              <div id="breakdown-slot">${renderBreakdown(initFields, initStaff)}</div>

              <div class="card-actions mt-md">
                <button type="button" class="btn btn--primary" id="open-request-btn" ${(!isOwner || hasPending) ? 'disabled' : ''}>
                  ${hasPending ? 'يوجد طلب معلّق' : 'تابع وأرسل الطلب'}
                </button>
              </div>
            </div>
          </div>
        `;
      }

      function renderHistoryCard(history) {
        return `
          <div class="card">
            <div class="card-header">
              <h3>سجل الطلبات</h3>
              <span class="card-header-meta">${history.length} طلب</span>
            </div>
            ${history.length === 0 ? `
              <div class="card-body">
                <div class="empty-state">
                  <div class="empty-icon"><i data-lucide="receipt"></i></div>
                  <p>لا توجد طلبات سابقة.</p>
                </div>
              </div>
            ` : `
              <div class="table-wrapper" style="box-shadow:none;border-radius:0">
                <table class="table tabular-nums">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>الباقة المطلوبة</th>
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
                        <td>
                          ${h.requested_fields ? `${h.requested_fields} أرضية` : '—'} +
                          ${h.requested_staff  ? `${h.requested_staff} موظف`  : '—'}
                        </td>
                        <td>${fmtMoney(h.amount)}</td>
                        <td class="text-muted">${window.utils.escapeHtml(h.payment_reference || '—')}</td>
                        <td>
                          ${reqChip(h.status)}
                          ${h.reject_reason ? `<div class="text-xs text-danger" style="margin-top:2px">${window.utils.escapeHtml(h.reject_reason)}</div>` : ''}
                        </td>
                        <td class="text-xs text-tertiary">
                          ${h.period_start ? `${window.utils.formatDate(h.period_start)} → ${window.utils.formatDate(h.period_end)}` : '—'}
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `}
          </div>
        `;
      }

      function renderPage(status, history) {
        const days = status ? Math.max(0, Number(status.days_remaining) || 0) : 0;
        return `
          ${renderCallout(status, days)}
          ${renderStatusCard(status)}
          ${renderConfigCard(status)}
          ${renderHistoryCard(history)}
        `;
      }

      function readCounters() {
        const fieldsEl = subContainer.querySelector('input[name="fields"]');
        const staffEl  = subContainer.querySelector('input[name="staff"]');
        return {
          fields: Math.max(parseInt(fieldsEl.dataset.min, 10) || 1, parseInt(fieldsEl.value, 10) || 1),
          staff:  Math.max(parseInt(staffEl.dataset.min,  10) || 1, parseInt(staffEl.value,  10) || 1)
        };
      }

      function updateBreakdown() {
        const { fields, staff } = readCounters();
        const slot = subContainer.querySelector('#breakdown-slot');
        if (slot) slot.innerHTML = renderBreakdown(fields, staff);
      }

      function clampCounter(input) {
        const min = parseInt(input.dataset.min, 10) || 1;
        const max = parseInt(input.dataset.max, 10) || 50;
        // قبول الأرقام العربية-الهندية إذا كتبها المستخدم
        const raw = String(input.value).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
        let v = parseInt(raw, 10);
        if (isNaN(v) || v < min) v = min;
        if (v > max) v = max;
        input.value = v;
      }

      function wireEvents() {
        subContainer.querySelectorAll('.unit-counter').forEach((c) => {
          const input = c.querySelector('input');
          c.querySelector('[data-action="dec"]').addEventListener('click', () => {
            input.value = (parseInt(input.value, 10) || 1) - 1;
            clampCounter(input);
            updateBreakdown();
          });
          c.querySelector('[data-action="inc"]').addEventListener('click', () => {
            input.value = (parseInt(input.value, 10) || 1) + 1;
            clampCounter(input);
            updateBreakdown();
          });
          input.addEventListener('input', () => {
            clampCounter(input);
            updateBreakdown();
          });
        });

        const openBtn = subContainer.querySelector('#open-request-btn');
        if (openBtn && !openBtn.disabled) {
          openBtn.addEventListener('click', () => openRequestModal());
        }
      }

      function openRequestModal() {
        if (!basePlan) {
          window.utils.toast('لا توجد باقة متاحة حالياً', 'error');
          return;
        }
        const { fields, staff } = readCounters();
        const total = window.pricing.calcPrice(fields, staff);
        const body = `
          <div class="card" style="background:var(--surface-2);box-shadow:none;border:1px solid var(--border-subtle);margin-bottom:var(--space-3)">
            <div class="card-body" style="padding:var(--space-3)">
              ${renderBreakdown(fields, staff)}
            </div>
          </div>
          <p class="text-muted text-sm">حوّل المبلغ <strong>${fmtMoney(total)}</strong> ثم أدخل رقم/مرجع التحويل أدناه. سيراجع المشرف طلبك خلال 24 ساعة.</p>
          <form id="req-form">
            <div class="form-group">
              <label class="form-label">رقم/مرجع التحويل <span class="required">*</span></label>
              <input type="text" class="form-control" name="payment_reference" required maxlength="120" placeholder="مثلاً: TRX-123456">
            </div>
            <div class="form-group">
              <label class="form-label">ملاحظة <span class="optional">اختياري</span></label>
              <textarea class="form-control" name="note" rows="2" maxlength="500"></textarea>
            </div>
          </form>
        `;
        const footer = `
          <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
          <button type="submit" class="btn btn--primary" form="req-form" id="req-submit">إرسال الطلب</button>
        `;
        const ctrl = window.utils.openModal({
          title: `طلب اشتراك: ${fields} أرضية + ${staff} موظف`,
          body, footer
        });

        ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
        ctrl.modal.querySelector('#req-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const submit = ctrl.modal.querySelector('#req-submit');
          submit.dataset.loading = 'true';
          submit.disabled = true;
          const fd = new FormData(e.target);
          try {
            await window.api.requestSubscription({
              plan_id: basePlan.id,
              fields, staff,
              payment_reference: (fd.get('payment_reference') || '').trim(),
              note: (fd.get('note') || '').trim() || null
            });
            window.utils.toast('تم إرسال طلب الاشتراك', 'success');
            ctrl.close();
            await refresh();
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
            submit.disabled = false;
            delete submit.dataset.loading;
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
