// لوحة المشرف العام — تفاصيل الملعب + إجراءات إدارية (تفعيل/تعطيل، تمديد تجربة،
// منح اشتراك، تعديل الحدود). كل الإجراءات محميّة بـ is_super_admin في الـ RPC.
(function () {
  const fmtDateTime = (v) => v ? window.utils.formatDateTime(v) : '—';
  const fmtDate = (v) => v ? window.utils.formatDate(v) : '—';

  function statusInfo(t, isActive) {
    if (t.suspended) return { cls: 'expired', label: 'موقوف' };
    if (!isActive) return { cls: 'expired', label: 'منتهٍ' };
    if (t.subscription_ends_at && new Date(t.subscription_ends_at) < new Date()) return { cls: 'grace', label: 'فترة سماح' };
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
            <tr><th>التاريخ</th><th>الحالة</th><th>الباقة</th><th>المبلغ</th><th>المرجع</th><th>الفترة</th></tr>
          </thead>
          <tbody>
            ${subs.map((s) => `
              <tr>
                <td data-label="التاريخ">${fmtDateTime(s.created_at)}</td>
                <td data-label="الحالة" class="card-tag"><span class="status-badge status-badge--${subStatusCls(s.status)}">${subStatusLabel(s.status)}</span></td>
                <td data-label="الباقة" class="tabular-nums">${s.requested_fields || '—'} أرضية + ${s.requested_staff || '—'} موظف</td>
                <td data-label="المبلغ">${s.amount != null ? window.utils.formatCurrency(s.amount) : '—'}</td>
                <td data-label="المرجع">${s.payment_reference ? `<code>${window.utils.escapeHtml(s.payment_reference)}</code>` : '—'}</td>
                <td data-label="الفترة">${s.period_start ? `${fmtDate(s.period_start)} ← ${fmtDate(s.period_end)}` : (s.reject_reason ? window.utils.escapeHtml(s.reject_reason) : '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function render(d) {
    const t = d.tenant;
    const s = statusInfo(t, d.is_active);
    const o = d.owner || {};
    const c = d.counts || {};
    const endDate = t.subscription_ends_at || t.trial_ends_at;
    const endLabel = t.subscription_ends_at ? 'نهاية الاشتراك' : 'نهاية التجربة';
    return `
      <a href="${window.utils.path('/admin/tenants')}" class="text-sm text-secondary" style="display:inline-flex;align-items:center;gap:4px;margin-bottom:var(--space-3)">
        <i data-lucide="chevron-right" style="width:16px;height:16px"></i> كل الملاعب
      </a>
      <div class="page-header">
        <div>
          <h2>${window.utils.escapeHtml(t.name)} <span class="status-badge status-badge--${s.cls}" style="vertical-align:middle">${s.label}</span></h2>
          <div class="page-subtitle">أُنشئ ${fmtDate(t.created_at)}${o.full_name ? ' · المالك ' + window.utils.escapeHtml(o.full_name) : ''}</div>
        </div>
        <div class="actions">
          <button class="btn btn--secondary btn--sm" data-act="toggle">${t.suspended ? 'تفعيل' : 'تعطيل'}</button>
          <button class="btn btn--secondary btn--sm" data-act="trial">تمديد التجربة</button>
          <button class="btn btn--primary btn--sm" data-act="grant">منح/تمديد اشتراك</button>
        </div>
      </div>

      <div class="stats-grid">
        ${statCard('goal', 'الأرضيات', `${c.fields ?? 0} <span class="text-tertiary" style="font-size:var(--text-md)">/ ${t.allowed_fields}</span>`, 'مستخدمة / المسموح')}
        ${statCard('user', 'الموظفون', `${c.staff ?? 0} <span class="text-tertiary" style="font-size:var(--text-md)">/ ${t.allowed_staff}</span>`, 'مستخدمون / المسموح')}
        ${statCard('clipboard-list', 'الحجوزات', c.bookings ?? 0, 'إجمالي الحجوزات')}
        ${statCard('calendar-clock', endLabel, fmtDate(endDate), s.label)}
      </div>

      <div class="card" style="margin-bottom:var(--space-4)">
        <div class="card-body">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);flex-wrap:wrap">
            <div class="text-sm">
              <div><span class="text-secondary">المالك:</span> ${o.full_name ? window.utils.escapeHtml(o.full_name) : '—'}</div>
              <div><span class="text-secondary">البريد:</span> ${o.email ? `<a href="mailto:${window.utils.escapeHtml(o.email)}">${window.utils.escapeHtml(o.email)}</a>` : '—'}</div>
            </div>
            <button class="btn btn--ghost btn--sm" data-act="limits"><i data-lucide="sliders-horizontal"></i> تعديل الحدود</button>
          </div>
        </div>
      </div>

      <h3 style="font-size:var(--text-md);margin:0 0 var(--space-3)">سجلّ الاشتراكات</h3>
      ${renderSubs(d.subscriptions || [])}
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
          const d = await window.api.adminTenantDetail(tenantId);
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

      async function runAction(fn, successMsg) {
        try {
          await fn();
          window.utils.toast(successMsg, 'success');
          await load();
        } catch (err) {
          window.utils.toast(window.utils.formatError(err), 'error');
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

        byAct('toggle').addEventListener('click', async () => {
          const activate = t.suspended; // معطّل حالياً ⇒ نفعّل، والعكس
          const ok = await window.utils.confirm({
            title: activate ? 'تفعيل الملعب' : 'تعطيل الملعب',
            message: activate
              ? `إعادة تفعيل "${t.name}"؟ سيعود وصوله للنظام.`
              : `تعطيل "${t.name}"؟ سيُمنع الوصول فوراً (والحجز العام) حتى إعادة التفعيل.`,
            confirmText: activate ? 'تفعيل' : 'تعطيل',
            danger: !activate
          });
          if (!ok) return;
          runAction(() => window.api.adminSetTenantActive(t.id, activate),
            activate ? 'تم تفعيل الملعب' : 'تم تعطيل الملعب');
        });

        byAct('trial').addEventListener('click', () => {
          numberModal({
            title: 'تمديد التجربة',
            intro: 'تُضاف الأيام إلى نهاية التجربة الحالية (أو من الآن إن انتهت).',
            fields: [{ name: 'days', label: 'عدد الأيام', value: 3, min: 1 }],
            submitText: 'تمديد',
            onSubmit: (v) => window.api.adminExtendTrial(t.id, v.days)
          });
        });

        byAct('grant').addEventListener('click', () => {
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

        byAct('limits').addEventListener('click', () => {
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
      }

      if (!tenantId) {
        container.innerHTML = `<div class="card"><div class="empty-state"><h3>لا يوجد ملعب</h3></div></div>`;
        return;
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
