// لوحة المشرف العام — تفاصيل الملعب + إجراءات إدارية (تفعيل/تعطيل، تمديد تجربة،
// منح اشتراك، تعديل الحدود). كل الإجراءات محميّة بـ is_super_admin في الـ RPC.
(function () {
  const fmtDateTime = (v) => v ? window.utils.formatDateTime(v) : '—';
  const fmtDate = (v) => v ? window.utils.formatDate(v) : '—';

  function statusInfo(t, isActive) {
    if (t.suspended) return { cls: 'expired', label: 'موقوف' };
    if (t.lifetime) return { cls: 'lifetime', label: 'وصول دائم' };
    if (!isActive) return { cls: 'expired', label: 'منتهٍ' };
    if (t.subscription_status === 'active') return { cls: 'active', label: 'مشترك' };
    return { cls: 'trial', label: 'تجربة' };
  }

  function statCard(icon, label, value, sub) {
    return `
      <div class="stat-card">
        <div class="stat-card-head">
          <span class="stat-icon-chip"><i data-lucide="${icon}"></i></span>
          <span class="stat-label">${label}</span>
        </div>
        <div class="stat-value tabular-nums">${value}</div>
        ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
      </div>`;
  }

  function subStatusLabel(s) {
    return ({ approved: 'معتمد', pending: 'معلّق', rejected: 'مرفوض' })[s] || s;
  }
  function subStatusCls(s) {
    return ({ approved: 'active', pending: 'trial', rejected: 'expired' })[s] || 'trial';
  }

  function renderSubs(subs) {
    if (!subs.length) {
      return `<div class="card"><div class="empty-state"><div class="empty-icon"><i data-lucide="receipt"></i></div><h3>لا اشتراكات</h3><p>لم يُسجّل هذا الملعب أي طلب اشتراك.</p></div></div>`;
    }
    return `
      <div class="table-wrapper">
        <table class="table table--cards">
          <thead>
            <tr><th>التاريخ</th><th>الحالة</th><th>الباقة</th><th>المبلغ</th><th>الإيصال</th><th>الفترة</th></tr>
          </thead>
          <tbody>
            ${subs.map((s) => `
              <tr>
                <td data-label="التاريخ">${fmtDateTime(s.created_at)}</td>
                <td data-label="الحالة" class="card-tag"><span class="status-badge status-badge--${subStatusCls(s.status)}">${subStatusLabel(s.status)}</span></td>
                <td data-label="الباقة" class="tabular-nums">${s.requested_fields || '—'} أرضية + ${s.requested_staff || '—'} موظف</td>
                <td data-label="المبلغ">${s.amount != null ? window.utils.formatCurrency(s.amount) : '—'}<div class="text-xs text-tertiary">${s.kind === 'upgrade' ? 'ترقية فورية' : 'تجديد شهر'}</div></td>
                <td data-label="الإيصال">${s.receipt_path
                  ? `<button type="button" class="btn btn--ghost btn--sm" data-receipt="${window.utils.escapeHtml(s.receipt_path)}"><i data-lucide="file-text"></i> عرض</button>`
                  : (s.payment_reference ? `<code>${window.utils.escapeHtml(s.payment_reference)}</code>` : '—')}</td>
                <td data-label="الفترة">${s.period_start ? `${fmtDate(s.period_start)} ← ${fmtDate(s.period_end)}` : (s.reject_reason ? window.utils.escapeHtml(s.reject_reason) : '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // ── قسم «الدخول نيابةً» ───────────────────────────────────────────────
  // الحالة الحيّة وحدها هي ما يقرّر ما يُعرض. وترتيب الفروع هنا هو ترتيب
  // الأولوية عند المشرف: جلستي المفتوحة أوّلاً، ثم دعوةٌ تنتظرني، ثم طلبٌ
  // معلّق، ثم جلسة زميل — وأخيراً لا شيء، وهي الحال الغالبة.
  function supportState(sessions) {
    const live = (sessions || []).find((s) => s.is_live);
    if (!live) {
      return {
        line: 'لا جلسة مفتوحة. الطلب يستأذن المالك أوّلاً؛ والدخول المباشر يفتح فوراً بلا إذنه ويُسجَّل باسمك.',
        actions: [
          { act: 'sup-request', label: 'اطلب الدخول نيابةً', cls: 'btn--primary' },
          { act: 'sup-direct', label: 'دخول مباشر', cls: 'btn--ghost' }
        ]
      };
    }
    if (live.status === 'active' && live.is_mine) {
      return {
        line: `جلستك مفتوحة${live.origin === 'direct' ? ' · دخول مباشر لا يراه المالك — أنهِها بنفسك' : ''} — تنتهي ${fmtDateTime(live.expires_at)}`,
        cls: 'danger',
        actions: [
          { act: 'sup-open', label: 'افتح حساب الملعب', cls: 'btn--primary', id: live.id },
          { act: 'sup-end', label: 'أنهِ الجلسة', cls: 'btn--ghost', id: live.id }
        ]
      };
    }
    if (live.status === 'active') {
      return {
        line: `جلسة مفتوحة باسم ${live.actor || 'مشرف آخر'} — تنتهي ${fmtDateTime(live.expires_at)}`,
        cls: 'danger',
        actions: []
      };
    }
    if (live.status === 'invited') {
      return {
        line: `الملعب طلب المساعدة${live.reason ? ' — ' + window.utils.escapeHtml(live.reason) : ''}. الدعوة إذنٌ قائم: لا موافقة ثانية بعدها.`,
        cls: 'warn',
        actions: [{ act: 'sup-claim', label: 'ادخل الآن', cls: 'btn--primary', id: live.id }]
      };
    }
    // pending
    return {
      line: live.is_mine
        ? 'طلبك بانتظار موافقة المالك — وصله إشعارٌ على جوّاله.'
        : `طلب ${live.actor || 'مشرف آخر'} بانتظار موافقة المالك.`,
      cls: 'warn',
      actions: live.is_mine
        ? [{ act: 'sup-end', label: 'ألغِ الطلب', cls: 'btn--ghost', id: live.id }]
        : []
    };
  }

  function renderSupport(sessions) {
    const st = supportState(sessions);
    const past = (sessions || []).filter((s) => !s.is_live).slice(0, 3);
    return `
      <div class="card" style="margin-bottom:var(--space-4)">
        <div class="card-body">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);flex-wrap:wrap">
            <div class="text-sm">
              <div class="fw-semibold" style="display:flex;align-items:center;gap:6px">
                <i data-lucide="user-cog" style="width:16px;height:16px"></i> الدخول نيابةً
              </div>
              <div class="text-xs ${st.cls === 'danger' ? 'text-danger' : 'text-secondary'}" style="margin-block-start:2px">${st.line}</div>
            </div>
            <div class="actions">
              ${st.actions.map((a) => `<button class="btn ${a.cls} btn--sm" data-act="${a.act}"${a.id ? ` data-session="${a.id}"` : ''}>${a.label}</button>`).join('')}
            </div>
          </div>
          ${past.length ? `
            <div class="text-xs text-tertiary" style="margin-block-start:var(--space-3);display:flex;flex-direction:column;gap:2px">
              ${past.map((s) => `<div>${fmtDateTime(s.requested_at)} · ${window.utils.escapeHtml(s.actor || 'دعم')} · ${
                ({ ended: 'انتهت', denied: 'رفضها المالك', expired: 'سقطت بالوقت' })[s.status] || s.status
              }</div>`).join('')}
            </div>` : ''}
        </div>
      </div>`;
  }

  function render(d) {
    const t = d.tenant;
    const s = statusInfo(t, d.is_active);
    const o = d.owner || {};
    const c = d.counts || {};
    const endDate = t.subscription_ends_at || t.trial_ends_at;
    const endLabel = t.lifetime ? 'الوصول' : (t.subscription_ends_at ? 'نهاية الاشتراك' : 'نهاية التجربة');
    const endValue = t.lifetime ? 'دائم' : fmtDate(endDate);
    const endIcon = t.lifetime ? 'gem' : 'calendar-clock';
    const limFields = t.lifetime ? '∞' : t.allowed_fields;
    const limStaff  = t.lifetime ? '∞' : t.allowed_staff;
    const dis = t.suspended ? ' disabled title="فعّل الملعب أولًا"' : '';
    const hasSub = !!t.subscription_ends_at;
    const trialFuture = t.trial_ends_at && new Date(t.trial_ends_at) > new Date();
    return `
      <a href="${window.utils.path('/admin/tenants')}" class="text-sm text-secondary" style="display:inline-flex;align-items:center;gap:4px;margin-bottom:var(--space-3)">
        <i data-lucide="chevron-right" style="width:16px;height:16px"></i> كل الملاعب
      </a>
      <div class="page-header">
        <div>
          <h2 style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            ${t.logo_url ? `<img class="tenant-logo-chip tenant-logo-chip--lg" src="${window.utils.escapeHtml(t.logo_url)}" alt="">` : ''}
            <span>${window.utils.escapeHtml(t.name)}</span>
            <span class="status-badge status-badge--${s.cls}" style="vertical-align:middle">${s.label}</span>
          </h2>
          <div class="page-subtitle">أُنشئ ${fmtDate(t.created_at)}${o.full_name ? ' · المالك ' + window.utils.escapeHtml(o.full_name) : ''}</div>
        </div>
        <div class="actions">
          <button class="btn btn--secondary btn--sm" data-act="toggle">${t.suspended ? 'تفعيل' : 'تعطيل'}</button>
          ${t.lifetime ? `
            <button class="btn btn--ghost btn--sm" data-act="revoke-lifetime"${dis}>إلغاء الوصول الدائم</button>
          ` : `
            <button class="btn btn--secondary btn--sm" data-act="trial"${dis}>تمديد التجربة</button>
            ${trialFuture ? `<button class="btn btn--ghost btn--sm" data-act="end-trial"${dis}>إنهاء التجربة</button>` : ''}
            <button class="btn btn--primary btn--sm" data-act="grant"${dis}>منح/تمديد اشتراك</button>
            ${hasSub ? `<button class="btn btn--ghost btn--sm" data-act="end-sub"${dis}>إنهاء الاشتراك</button>` : ''}
            <button class="btn btn--secondary btn--sm" data-act="grant-lifetime"${dis}>منح وصول دائم</button>
          `}
        </div>
      </div>

      <div class="stats-grid">
        ${statCard('goal', 'الأرضيات', `${c.fields ?? 0} <span class="text-tertiary" style="font-size:var(--text-md)">/ ${limFields}</span>`, t.lifetime ? 'مستخدمة / بلا حدّ' : 'مستخدمة / المسموح')}
        ${statCard('user', 'الموظفون', `${c.staff ?? 0} <span class="text-tertiary" style="font-size:var(--text-md)">/ ${limStaff}</span>`, t.lifetime ? 'مستخدمون / بلا حدّ' : 'مستخدمون / المسموح')}
        ${statCard('clipboard-list', 'الحجوزات', c.bookings ?? 0, 'إجمالي الحجوزات')}
        ${statCard(endIcon, endLabel, endValue, s.label)}
      </div>

      <div class="card" style="margin-bottom:var(--space-4)">
        <div class="card-body">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);flex-wrap:wrap">
            <div class="text-sm">
              <div><span class="text-secondary">المالك:</span> ${o.full_name ? window.utils.escapeHtml(o.full_name) : '—'}</div>
              <div><span class="text-secondary">البريد:</span> ${o.email ? `<a href="mailto:${window.utils.escapeHtml(o.email)}">${window.utils.escapeHtml(o.email)}</a>` : '—'}</div>
            </div>
            ${t.lifetime ? '' : `<button class="btn btn--ghost btn--sm" data-act="limits"><i data-lucide="sliders-horizontal"></i> تعديل الحدود</button>`}
          </div>
        </div>
      </div>

      ${renderSupport(d.support_sessions)}

      <h3 style="font-size:var(--text-md);margin:0 0 var(--space-3)">سجلّ الاشتراكات</h3>
      ${renderSubs(d.subscriptions || [])}

      <h3 style="font-size:var(--text-md);margin:var(--space-5) 0 var(--space-3)">سجلّ الإجراءات</h3>
      ${window.adminAudit.render(d.audit || [], { showTenant: false })}
    `;
  }

  const page = {
    async mount(container, ctx) {
      const tenantId = ctx.params && ctx.params[0];
      let alive = true;
      page._cleanup = [() => { alive = false; }];

      async function load() {
        container.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
        try {
          // متوازيان: تسلسلهما يؤخّر رسم الصفحة بجولة خادمٍ بلا سبب
          const [d, sessions] = await Promise.all([
            window.api.adminTenantDetail(tenantId),
            window.supportApi.adminListSessions(tenantId).catch(() => [])
          ]);
          d.support_sessions = sessions;
          if (!alive) return;
          container.innerHTML = render(d);
          window.utils.renderIcons(container);
          wire(d);
        } catch (err) {
          if (!alive) return;
          container.innerHTML = `<div class="card"><div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert"></i></div><h3>تعذّر تحميل الملعب</h3><p>${window.utils.escapeHtml(window.utils.formatError(err))}</p></div></div>`;
          window.utils.renderIcons(container);
        }
      }


      // نافذة بحقول رقمية ثم تنفيذ
      function numberModal({ title, intro, fields, submitText, onSubmit }) {
        const body = `
          ${intro ? `<p class="text-sm text-secondary">${intro}</p>` : ''}
          <form id="adm-form">
            ${fields.map((f) => `
              <div class="form-group">
                <label class="form-label" for="${f.name}">${f.label}</label>
                <input type="number" class="form-control" id="${f.name}" name="${f.name}" value="${f.value}" min="${f.min ?? 0}" required>
                ${f.help ? `<span class="form-help">${f.help}</span>` : ''}
              </div>`).join('')}
          </form>`;
        const ctrl = window.utils.openModal({
          title,
          body,
          footer: `
            <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
            <button type="submit" class="btn btn--primary" form="adm-form" id="adm-submit">${submitText}</button>`
        });
        ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
        ctrl.modal.querySelector('#adm-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const vals = {};
          fields.forEach((f) => { vals[f.name] = Number(fd.get(f.name)); });
          const btn = ctrl.modal.querySelector('#adm-submit');
          btn.disabled = true;
          try {
            await onSubmit(vals);
            ctrl.close();
            window.utils.toast('تم بنجاح', 'success');
            await load();
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
            btn.disabled = false;
          }
        });
      }

      function wire(d) {
        const t = d.tenant;
        const byAct = (a) => container.querySelector(`[data-act="${a}"]`);

        // عرض إيصال اشتراك في نافذة منبثقة (المشرف مخوّل عبر RLS)
        container.querySelectorAll('[data-receipt]').forEach((btn) => {
          btn.addEventListener('click', () => window.receiptViewer.open(btn.getAttribute('data-receipt')));
        });

        // نافذة إجراء مع سبب اختياري يُسجَّل في سجلّ الإجراءات
        function reasonModal({ title, intro, reasonLabel, confirmText, danger, run, successMsg }) {
          const body = `
            <p class="text-sm text-secondary">${intro}</p>
            <form id="rsn-form">
              <div class="form-group">
                <label class="form-label" for="rsn-reason">${reasonLabel} <span class="optional">اختياري</span></label>
                <textarea class="form-control" id="rsn-reason" rows="2" maxlength="300" placeholder="يظهر في سجلّ الإجراءات"></textarea>
              </div>
            </form>`;
          const ctrl = window.utils.openModal({
            title,
            body,
            footer: `
              <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
              <button type="submit" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" form="rsn-form" id="rsn-submit">${confirmText}</button>`
          });
          ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
          ctrl.modal.querySelector('#rsn-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const reason = (ctrl.modal.querySelector('#rsn-reason').value || '').trim();
            const btn = ctrl.modal.querySelector('#rsn-submit');
            btn.disabled = true;
            try {
              await run(reason || null);
              ctrl.close();
              window.utils.toast(successMsg, 'success');
              await load();
            } catch (err) {
              window.utils.toast(window.utils.formatError(err), 'error');
              btn.disabled = false;
            }
          });
        }

        const nm = window.utils.escapeHtml(t.name);

        byAct('toggle').addEventListener('click', () => {
          const activate = t.suspended; // معطّل ⇒ نفعّل، والعكس
          reasonModal({
            title: activate ? 'تفعيل الملعب' : 'تعطيل الملعب',
            intro: activate
              ? `إعادة تفعيل "${nm}"؟ سيعود وصوله للنظام.`
              : `تعطيل "${nm}"؟ سيُمنع الوصول فوراً (والحجز العام) حتى إعادة التفعيل.`,
            reasonLabel: activate ? 'سبب التفعيل' : 'سبب التعطيل',
            confirmText: activate ? 'تفعيل' : 'تعطيل',
            danger: !activate,
            run: (r) => window.api.adminSetTenantActive(t.id, activate, r),
            successMsg: activate ? 'تم تفعيل الملعب' : 'تم تعطيل الملعب'
          });
        });

        const endTrialBtn = byAct('end-trial');
        if (endTrialBtn) endTrialBtn.addEventListener('click', () => {
          reasonModal({
            title: 'إنهاء التجربة',
            intro: `إنهاء تجربة "${nm}" الآن؟ ستنتهي فورًا (يُلغي أي تمديد).`,
            reasonLabel: 'سبب الإنهاء',
            confirmText: 'إنهاء التجربة',
            danger: true,
            run: (r) => window.api.adminEndTrial(t.id, r),
            successMsg: 'تم إنهاء التجربة'
          });
        });

        const endSubBtn = byAct('end-sub');
        if (endSubBtn) endSubBtn.addEventListener('click', () => {
          reasonModal({
            title: 'إنهاء الاشتراك',
            intro: `إنهاء اشتراك "${nm}" الآن؟ يُزال الاشتراك المدفوع (يعود الملعب للتجربة إن كانت سارية، وإلا يُقفل). لا يُعطّل الحساب.`,
            reasonLabel: 'سبب الإنهاء',
            confirmText: 'إنهاء الاشتراك',
            danger: true,
            run: (r) => window.api.adminEndSubscription(t.id, r),
            successMsg: 'تم إنهاء الاشتراك'
          });
        });

        const trialBtn = byAct('trial');
        if (trialBtn) trialBtn.addEventListener('click', () => {
          numberModal({
            title: 'تمديد التجربة',
            intro: 'تُضاف الأيام إلى نهاية التجربة الحالية (أو من الآن إن انتهت).',
            fields: [{ name: 'days', label: 'عدد الأيام', value: 3, min: 1 }],
            submitText: 'تمديد',
            onSubmit: (v) => window.api.adminExtendTrial(t.id, v.days)
          });
        });

        const grantBtn = byAct('grant');
        if (grantBtn) grantBtn.addEventListener('click', () => {
          numberModal({
            title: 'منح / تمديد اشتراك',
            intro: 'يمدّد الاشتراك بعدد الأيام ويضبط الحدود ويُلغي الإيقاف.',
            fields: [
              { name: 'days',   label: 'عدد الأيام', value: 30, min: 1 },
              { name: 'fields', label: 'حد الأرضيات', value: t.allowed_fields, min: 1 },
              { name: 'staff',  label: 'حد الموظفين', value: t.allowed_staff, min: 0 }
            ],
            submitText: 'منح الاشتراك',
            onSubmit: (v) => window.api.adminGrantSubscription(t.id, v.days, v.fields, v.staff)
          });
        });

        const limitsBtn = byAct('limits');
        if (limitsBtn) limitsBtn.addEventListener('click', () => {
          numberModal({
            title: 'تعديل الحدود',
            fields: [
              { name: 'fields', label: 'حد الأرضيات', value: t.allowed_fields, min: 1 },
              { name: 'staff',  label: 'حد الموظفين', value: t.allowed_staff, min: 0 }
            ],
            submitText: 'حفظ',
            onSubmit: (v) => window.api.adminSetLimits(t.id, v.fields, v.staff)
          });
        });

        // ── الدخول نيابةً ────────────────────────────────────────────
        // الوجهة تُبنى كما تبنيها auth.withBase: في الحزمة الأصلية لا خادم
        // يعيد كتابة المسارات، فـ'/dashboard' وحده يفتح قوقعة التطبيق لا صفحته.
        function appPath(p) {
          const resolved = window.native ? window.native.docPath(p) : p;
          return (window.__BASE__ || '') + resolved;
        }

        async function runSupport(fn, msg) {
          try {
            await fn();
            window.utils.toast(msg, 'success');
            await load();
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
          }
        }

        const supRequestBtn = byAct('sup-request');
        if (supRequestBtn) supRequestBtn.addEventListener('click', () => {
          // السبب إلزامي — والقاعدة ترفض دونه. يقرؤه المالك قبل أن يوافق،
          // فليس حقلاً للأرشيف بل هو نصّ الطلب نفسه.
          const ctrl = window.utils.openModal({
            title: 'طلب الدخول نيابةً',
            body: `
              <p class="text-sm text-secondary">يصل المالك إشعارٌ على جوّاله بهذا السبب. لا يُفتح شيء قبل موافقته، وتنتهي الجلسة وحدها بعد 30 دقيقة.</p>
              <form id="sup-form" autocomplete="off">
                <div class="form-group">
                  <label class="form-label" for="sup-reason">سبب الدخول</label>
                  <textarea class="form-control" id="sup-reason" rows="2" maxlength="200" required
                            placeholder="مثال: أضبط لك أوقات الفتح والإغلاق"></textarea>
                  <span class="form-help">اكتبه بلسان المالك — هو من سيقرؤه.</span>
                </div>
              </form>`,
            footer: `
              <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
              <button type="submit" class="btn btn--primary" form="sup-form" id="sup-submit">أرسل الطلب</button>`
          });
          ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
          ctrl.modal.querySelector('#sup-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const reason = (ctrl.modal.querySelector('#sup-reason').value || '').trim();
            const btn = ctrl.modal.querySelector('#sup-submit');
            btn.disabled = true;
            try {
              await window.supportApi.adminRequestSession(t.id, reason);
              ctrl.close();
              window.utils.toast('وصل الطلب جوّال المالك', 'success');
              await load();
            } catch (err) {
              window.utils.toast(window.utils.formatError(err), 'error');
              btn.disabled = false;
            }
          });
        });

        const supDirectBtn = byAct('sup-direct');
        if (supDirectBtn) supDirectBtn.addEventListener('click', () => {
          const ctrl = window.utils.openModal({
            title: 'دخول مباشر لحساب الملعب',
            body: `
              <p class="text-sm text-secondary">تدخل الآن بلا موافقة المالك، وتعمل داخل حسابه كأنك هو. لا يصله إشعار ولا يظهر له شريط. المال والهويّة (الاشتراك، جوّال المالك، حذف الحساب) تبقى مقفلة.</p>
              <p class="text-xs text-secondary">يُسجَّل السطر في دفترك باسمك مع هذا السبب — دفاعك لو سُئلت لاحقاً.</p>
              <form id="dir-form" autocomplete="off">
                <div class="form-group">
                  <label class="form-label" for="dir-reason">سبب الدخول</label>
                  <textarea class="form-control" id="dir-reason" rows="2" maxlength="200" required
                            placeholder="مثال: الوزيه أذن شفهياً بالهاتف، أضبط له الأوقات"></textarea>
                </div>
              </form>`,
            footer: `
              <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
              <button type="submit" class="btn btn--primary" form="dir-form" id="dir-submit">ادخل الآن</button>`
          });
          ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
          ctrl.modal.querySelector('#dir-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const reason = (ctrl.modal.querySelector('#dir-reason').value || '').trim();
            const btn = ctrl.modal.querySelector('#dir-submit');
            btn.disabled = true;
            try {
              await window.supportApi.adminDirectSession(t.id, reason);
              window.location.href = appPath('/dashboard');
            } catch (err) {
              window.utils.toast(window.utils.formatError(err), 'error');
              btn.disabled = false;
            }
          });
        });

        const supClaimBtn = byAct('sup-claim');
        if (supClaimBtn) supClaimBtn.addEventListener('click', async () => {
          const id = supClaimBtn.getAttribute('data-session');
          supClaimBtn.disabled = true;
          try {
            await window.supportApi.adminClaimSession(id);
            window.location.href = appPath('/dashboard');
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
            supClaimBtn.disabled = false;
            await load();
          }
        });

        const supOpenBtn = byAct('sup-open');
        if (supOpenBtn) supOpenBtn.addEventListener('click', () => {
          window.location.href = appPath('/dashboard');
        });

        const supEndBtn = byAct('sup-end');
        if (supEndBtn) supEndBtn.addEventListener('click', () => {
          const id = supEndBtn.getAttribute('data-session');
          runSupport(() => window.supportApi.endSession(id), 'أُنهيت الجلسة');
        });

        const grantLifeBtn = byAct('grant-lifetime');
        if (grantLifeBtn) grantLifeBtn.addEventListener('click', () => {
          reasonModal({
            title: 'منح وصول دائم',
            intro: `منح "${nm}" وصولاً دائمًا (مدى الحياة) بكل المميزات بلا حدود؟ يُلغي أي قيود اشتراك.`,
            reasonLabel: 'سبب المنح',
            confirmText: 'منح وصول دائم',
            danger: false,
            run: (r) => window.api.adminGrantLifetime(t.id, r),
            successMsg: 'تم منح الوصول الدائم'
          });
        });

        const revokeLifeBtn = byAct('revoke-lifetime');
        if (revokeLifeBtn) revokeLifeBtn.addEventListener('click', () => {
          reasonModal({
            title: 'إلغاء الوصول الدائم',
            intro: `إلغاء الوصول الدائم عن "${nm}"؟ سيعود الملعب لمنطق الاشتراك/التجربة العادي.`,
            reasonLabel: 'سبب الإلغاء',
            confirmText: 'إلغاء الوصول الدائم',
            danger: true,
            run: (r) => window.api.adminRevokeLifetime(t.id, r),
            successMsg: 'تم إلغاء الوصول الدائم'
          });
        });
      }

      if (!tenantId) {
        container.innerHTML = `<div class="card"><div class="empty-state"><h3>لا يوجد ملعب</h3></div></div>`;
        return;
      }

      // تحديث لحظي لتفاصيل المنشأة (حالة، اشتراك)
      if (window.realtime) {
        const debounced = window.utils.debounce(load, 500);
        page._cleanup.push(window.realtime.on('tenants:change', debounced));
        page._cleanup.push(window.realtime.on('subscriptions:change', debounced));
        page._cleanup.push(window.realtime.on('support:change', debounced));
      }

      load();
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages['admin-tenant-details'] = page;
})();
