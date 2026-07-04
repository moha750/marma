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

  function phaseLabel(phase, extended) {
    if (phase === 'trial') return extended ? 'تجربة ممدّدة' : 'تجربة مجانية';
    return ({
      active: 'اشتراك نشط',
      grace_active: 'انتهى الاشتراك (فترة سماح)',
      expired: 'منتهي',
      suspended: 'موقوف من الإدارة',
      lifetime: 'وصول دائم',
      none: 'غير معرّف'
    })[phase] || phase;
  }

  // حالة الاشتراك: نص عادي (بلا بادج) في كل الحالات — يطابق بقية قيم بطاقة الحالة
  function phaseChip(phase, extended) {
    return `<span class="fw-semibold">${window.utils.escapeHtml(phaseLabel(phase, extended))}</span>`;
  }

  function reqChip(s) {
    const map = { pending: 'بانتظار الموافقة', approved: 'تمت الموافقة', rejected: 'مرفوض' };
    const cls = ({ pending: 'pending', approved: 'approved', rejected: 'rejected' })[s] || 'muted';
    return `<span class="chip-status chip-status--${cls}">${map[s] || s}</span>`;
  }

  function fmtMoney(v) { return window.utils.formatCurrency(v || 0); }

  // صيغة الأيام بالعربية الصحيحة: 1 يوم واحد · 2 يومان · 3–10 أيام · 11+ يومًا
  function daysLabel(n) {
    n = Math.max(0, Number(n) || 0);
    if (n === 1) return 'يوم واحد';
    if (n === 2) return 'يومان';
    if (n >= 3 && n <= 10) return n + ' أيام';
    return n + ' يومًا';
  }

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

      // بانر دائم لحالة الاشتراك — يعرض المتبقّي دائماً، ولونه يتغيّر باقتراب الانتهاء.
      function renderCallout(status) {
        const banner = (cls, icon, text) => `
            <div class="trial-banner trial-banner--${cls}" style="margin-bottom: var(--space-4); border-radius: var(--radius-md)">
              <span class="trial-banner-icon"><i data-lucide="${icon}"></i></span>
              <span>${text}</span>
            </div>`;

        if (status && status.phase === 'lifetime') {
          return banner('lifetime', 'gem', 'حسابك يتمتّع بوصول دائم — كل المميزات مفتوحة بلا حدود.');
        }
        if (!status || !status.is_active) {
          return banner('danger', 'triangle-alert', 'انتهى اشتراكك والخدمة مغلقة حالياً. اشترك لإعادة تفعيل حسابك.');
        }

        const phase = status.phase;
        // فترة السماح: العدّ حتى القفل الكامل (days_remaining)
        if (phase && phase.startsWith('grace_')) {
          const lock = daysLabel(Math.max(0, Number(status.days_remaining) || 0));
          return banner('grace', 'triangle-alert', `أنت في فترة السماح — يرجى تجديد الاشتراك خلال ${lock}.`);
        }

        // نشِط/تجربة: المتبقّي حتى نهاية الاشتراك (days_until_expiry)، واللون حسب القرب
        const toExpiry = Math.max(0, Number(status.days_until_expiry) || 0);
        const left = daysLabel(toExpiry);
        const tone = toExpiry <= 3 ? 'danger' : (toExpiry <= 7 ? 'grace' : 'ok');
        const icon = tone === 'danger' ? 'triangle-alert' : (tone === 'grace' ? 'hourglass' : 'calendar-check');

        if (phase === 'trial') {
          const lead = status.trial_extended ? 'تجربتك الممدّدة نشطة' : 'تجربتك المجانية نشطة';
          return banner(tone, icon, `${lead} — متبقٍ ${left} (أرضية واحدة، بدون موظفين).`);
        }
        return banner(tone, icon, tone === 'ok'
          ? `اشتراكك نشط — متبقٍ ${left}.`
          : `يقترب انتهاء اشتراكك — متبقٍ ${left}. جدّد قبل الانقطاع.`);
      }

      function renderStatusCard(status) {
        const phase  = status ? status.phase : 'none';
        const lifetime = phase === 'lifetime';
        const effEnd = lifetime ? 'دائم' : (status && status.effective_end ? window.utils.formatDateTime(status.effective_end) : '—');
        const allowedFields = lifetime ? '∞' : (status ? (status.allowed_fields || 1) : 1);
        const allowedStaff  = lifetime ? '∞' : (status ? (status.allowed_staff  || 0) : 0);
        const currentFields = status ? (status.current_fields || 0) : 0;
        const currentStaff  = status ? (status.current_staff  || 0) : 0;

        return `
          <div class="card mb-md sub-status-card">
            <div class="card-body sub-status-metrics">
              <div>
                <div class="text-xs text-tertiary fw-medium mb-sm">الحالة الحالية</div>
                <div>${phaseChip(phase, status && status.trial_extended)}</div>
              </div>
              <div>
                <div class="text-xs text-tertiary fw-medium mb-sm">تاريخ الانتهاء</div>
                <div class="fw-semibold tabular-nums">${window.utils.escapeHtml(effEnd)}</div>
              </div>
              <div>
                <div class="text-xs text-tertiary fw-medium mb-sm">الأرضيات</div>
                <div class="fw-semibold tabular-nums">${currentFields} / ${allowedFields}</div>
              </div>
              <div>
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
            ${hint ? `<span class="form-help" style="text-align:center">${window.utils.escapeHtml(hint)}</span>` : ''}
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
        const phase         = status ? status.phase : 'none';
        // ضمن دورة مدفوعة نشطة (phase='active'): الحدّ الأدنى = المسموح — لا خفض لما دُفع له.
        // بعد انتهاء الدورة (سماح/منتهٍ/تجربة): الحدّ = الاستخدام الفعلي — يمكن التجديد بأقلّ.
        const periodActive = phase === 'active';
        const minFields = periodActive ? Math.max(1, allowedFields, currentFields) : Math.max(1, currentFields);
        const minStaff  = periodActive ? Math.max(1, allowedStaff,  currentStaff)  : Math.max(1, currentStaff);
        // افتراضي مبدئي = الأعلى بين الحدّ الأدنى والمسموح
        const initFields = Math.max(minFields, allowedFields);
        const initStaff  = Math.max(minStaff,  allowedStaff, 1);
        const hintFields = periodActive ? `المسموح لك ${allowedFields} · تستخدم ${currentFields}` : `الحدّ الأدنى ${minFields} بحسب استخدامك الحالي`;
        const hintStaff  = periodActive ? `المسموح لك ${allowedStaff} · تستخدم ${currentStaff}`  : `الحدّ الأدنى ${minStaff} بحسب استخدامك الحالي`;

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
                ${renderCounter('fields', initFields, minFields, 50, 'عدد الأرضيات', hintFields)}
                ${renderCounter('staff',  initStaff,  minStaff,  50, 'عدد الموظفين', hintStaff)}
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
                <table class="table table--cards tabular-nums">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>الباقة المطلوبة</th>
                      <th>المبلغ</th>
                      <th>الإيصال</th>
                      <th>الحالة</th>
                      <th>التفاصيل</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${history.map((h) => `
                      <tr>
                        <td data-label="التاريخ">${window.utils.formatDateTime(h.created_at)}</td>
                        <td data-label="الباقة المطلوبة">
                          ${h.requested_fields ? `${h.requested_fields} أرضية` : '—'} +
                          ${h.requested_staff  ? `${h.requested_staff} موظف`  : '—'}
                        </td>
                        <td data-label="المبلغ">${fmtMoney(h.amount)}<div class="text-2xs text-tertiary">${h.kind === 'upgrade' ? 'ترقية' : 'تجديد'}</div></td>
                        <td data-label="الإيصال">${h.receipt_path
                          ? `<button type="button" class="btn btn--ghost btn--sm" data-receipt="${window.utils.escapeHtml(h.receipt_path)}"><i data-lucide="file-text"></i> عرض</button>`
                          : (h.payment_reference ? `<span class="text-muted">${window.utils.escapeHtml(h.payment_reference)}</span>` : '<span class="text-muted">—</span>')}</td>
                        <td data-label="الحالة" class="card-tag">${reqChip(h.status)}</td>
                        <td data-label="التفاصيل" class="text-xs text-tertiary">
                          ${h.period_start
                            ? `${window.utils.formatDate(h.period_start)} → ${window.utils.formatDate(h.period_end)}`
                            : (h.reject_reason ? `<span class="text-danger">${window.utils.escapeHtml(h.reject_reason)}</span>` : '—')}
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
        // الوصول الدائم لا يحتاج باقة/تجديد — نخفي بطاقة الطلب
        const lifetime = status && status.phase === 'lifetime';
        return `
          ${renderCallout(status)}
          ${renderStatusCard(status)}
          ${lifetime ? '' : renderConfigCard(status)}
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

        // عرض إيصال طلب سابق في نافذة منبثقة (المالك يرى إيصاله فقط)
        subContainer.querySelectorAll('[data-receipt]').forEach((btn) => {
          btn.addEventListener('click', () => window.receiptViewer.open(btn.getAttribute('data-receipt')));
        });
      }

      function openRequestModal() {
        if (!basePlan) {
          window.utils.toast('لا توجد باقة متاحة حالياً', 'error');
          return;
        }
        const { fields, staff } = readCounters();
        const st = lastStatus || {};
        const allowedFields = Number(st.allowed_fields) || 1;
        const allowedStaff  = Number(st.allowed_staff)  || 0;
        const daysLeft      = Math.max(0, Number(st.days_until_expiry) || 0);
        const addedFields   = Math.max(0, fields - allowedFields);
        const addedStaff    = Math.max(0, staff  - allowedStaff);
        // الترقية الفورية متاحة فقط لاشتراك مدفوع نشط تُضاف إليه وحدات
        const canUpgrade = !!st.is_active && st.phase === 'active' && (addedFields + addedStaff) > 0;

        const fullB = window.pricing.breakdown(fields, staff);
        const upB   = window.pricing.upgradeBreakdown(addedFields, addedStaff, daysLeft);
        const amountOf = (k) => (k === 'upgrade' ? upB.total : fullB.total);
        const invoiceHtml = (k) => {
          const b = k === 'upgrade' ? upB : fullB;
          const hint = k === 'upgrade'
            ? `تُضاف الوحدات فورًا، وتاريخ التجديد يبقى كما هو (متبقٍ ${daysLabel(daysLeft)}).`
            : `شهر كامل بالوحدات المختارة، يُمدّد التجديد ${window.pricing.DURATION_DAYS} يومًا.`;
          return `
            <div class="card" style="background:var(--surface-2);box-shadow:none;border:1px solid var(--border-subtle);margin-bottom:var(--space-2)">
              <div class="card-body" style="padding:var(--space-3)">
                <div class="invoice-lines">
                  ${b.lines.map((l) => `<div class="invoice-line"><span>${window.utils.escapeHtml(l.label)}</span><span class="tabular-nums">${fmtMoney(l.amount)}</span></div>`).join('')}
                  <div class="invoice-line invoice-line--total"><span>الإجمالي</span><span class="tabular-nums">${fmtMoney(b.total)}</span></div>
                </div>
              </div>
            </div>
            <p class="text-muted text-xs" style="margin-bottom:var(--space-3)">${hint}</p>`;
        };
        let selectedKind = canUpgrade ? 'upgrade' : 'renew';
        const segHtml = canUpgrade ? `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);margin-bottom:var(--space-3)">
            <button type="button" class="btn btn--primary seg-btn" data-kind="upgrade">ترقية فورية · ${fmtMoney(upB.total)}</button>
            <button type="button" class="btn btn--secondary seg-btn" data-kind="renew">تجديد شهر · ${fmtMoney(fullB.total)}</button>
          </div>` : '';
        const body = `
          ${segHtml}
          <div id="req-invoice">${invoiceHtml(selectedKind)}</div>
          <p class="text-muted text-sm">حوّل <strong id="req-amount">${fmtMoney(amountOf(selectedKind))}</strong> إلى الحساب أدناه، ثم أرفق إيصال التحويل. سيراجع المشرف طلبك خلال 24 ساعة.</p>
          <div class="card" style="background:var(--surface-1);box-shadow:none;border:1px solid var(--border-subtle);margin-bottom:var(--space-3)">
            <div class="card-body" style="padding:var(--space-3)">
              <div class="text-xs text-tertiary" style="margin-bottom:2px">بيانات التحويل</div>
              <div class="fw-semibold">البنك العربي</div>
              <div style="display:flex;align-items:center;gap:var(--space-2);margin-top:var(--space-1);flex-wrap:wrap">
                <code id="iban-value" style="direction:ltr;font-size:var(--text-sm);letter-spacing:.02em">SA7730100974016871643647</code>
                <button type="button" class="btn btn--ghost btn--sm" id="copy-iban"><i data-lucide="copy"></i> نسخ</button>
              </div>
            </div>
          </div>
          <form id="req-form">
            <div class="form-group">
              <label class="form-label">إيصال التحويل <span class="required">*</span></label>
              <label class="file-drop" id="receipt-drop">
                <span class="file-drop__icon"><i data-lucide="upload-cloud"></i></span>
                <span class="file-drop__text">
                  <span class="file-drop__title" data-default="اضغط لإرفاق الإيصال">اضغط لإرفاق الإيصال</span>
                  <span class="file-drop__hint">صورة (JPG/PNG/WebP) أو PDF — حتى 5 ميجابايت</span>
                </span>
                <input type="file" name="receipt" accept="image/jpeg,image/png,image/webp,application/pdf" hidden>
              </label>
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
        window.utils.renderIcons(ctrl.modal);

        ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);

        // مُبدِّل النوع (ترقية/تجديد) — يحدّث الفاتورة والمبلغ والنوع المُرسَل
        const setKind = (k) => {
          selectedKind = k;
          ctrl.modal.querySelectorAll('.seg-btn').forEach((b) => {
            const on = b.getAttribute('data-kind') === k;
            b.className = 'btn seg-btn ' + (on ? 'btn--primary' : 'btn--secondary');
          });
          ctrl.modal.querySelector('#req-invoice').innerHTML = invoiceHtml(k);
          ctrl.modal.querySelector('#req-amount').textContent = fmtMoney(amountOf(k));
        };
        ctrl.modal.querySelectorAll('.seg-btn').forEach((b) => {
          b.addEventListener('click', () => setKind(b.getAttribute('data-kind')));
        });

        const copyBtn = ctrl.modal.querySelector('#copy-iban');
        if (copyBtn) {
          copyBtn.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText('SA7730100974016871643647');
              window.utils.toast('تم نسخ الآيبان', 'success');
            } catch (_) {
              window.utils.toast('تعذّر النسخ — انسخه يدويًّا', 'error');
            }
          });
        }

        // منطقة الرفع: أظهر اسم الملف المختار وبدّل الحالة
        const dropEl    = ctrl.modal.querySelector('#receipt-drop');
        const dropInput = dropEl && dropEl.querySelector('input[type="file"]');
        const dropTitle = dropEl && dropEl.querySelector('.file-drop__title');
        if (dropInput) {
          dropInput.addEventListener('change', () => {
            const f = dropInput.files && dropInput.files[0];
            if (f) {
              dropTitle.textContent = f.name;
              dropEl.classList.add('has-file');
            } else {
              dropTitle.textContent = dropTitle.dataset.default;
              dropEl.classList.remove('has-file');
            }
          });
        }

        ctrl.modal.querySelector('#req-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const submit = ctrl.modal.querySelector('#req-submit');
          const fd = new FormData(e.target);
          const file = fd.get('receipt');
          if (!file || !file.size) {
            window.utils.toast('يرجى إرفاق إيصال التحويل', 'error');
            return;
          }
          submit.dataset.loading = 'true';
          submit.disabled = true;
          try {
            const receipt_path = await window.api.uploadReceipt(file);
            await window.api.requestSubscription({
              plan_id: basePlan.id,
              fields, staff,
              receipt_path,
              note: (fd.get('note') || '').trim() || null,
              kind: selectedKind
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
      // تحديث لحظي: موافقة/رفض الأدمن أو تغيّر حالة المنشأة يظهر فورًا
      if (window.realtime) {
        const debounced = window.utils.debounce(refresh, 400);
        cleanup.push(window.realtime.on('subscriptions:change', debounced));
        cleanup.push(window.realtime.on('tenants:change', debounced));
      }
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
