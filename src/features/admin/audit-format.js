// تنسيق سجلّ نشاط المشرفين — مشترك بين تفاصيل الملعب والتبويب العام.
window.adminAudit = (function () {
  const ACTIONS = {
    activate:           { label: 'تفعيل الملعب',      icon: 'circle-check', cls: 'active'  },
    suspend:            { label: 'تعطيل الملعب',      icon: 'ban',          cls: 'expired' },
    extend_trial:       { label: 'تمديد التجربة',     icon: 'calendar-plus', cls: 'trial'  },
    grant_subscription: { label: 'منح/تمديد اشتراك',  icon: 'badge-check',  cls: 'active'  },
    end_subscription:   { label: 'إنهاء الاشتراك',    icon: 'circle-x',     cls: 'expired' },
    end_trial:          { label: 'إنهاء التجربة',     icon: 'calendar-x',   cls: 'expired' },
    grant_lifetime:     { label: 'منح وصول دائم',     icon: 'gem',          cls: 'active'  },
    revoke_lifetime:    { label: 'إلغاء الوصول الدائم', icon: 'gem',        cls: 'expired' },
    set_limits:         { label: 'تعديل الحدود',      icon: 'sliders-horizontal', cls: 'grace' }
  };

  const fmtDate = (v) => v ? window.utils.formatDate(v) : '—';

  function meta(action) {
    return ACTIONS[action] || { label: action, icon: 'activity', cls: 'trial' };
  }

  function detailText(action, d) {
    d = d || {};
    switch (action) {
      case 'extend_trial':
        return `+${d.days} يوم${d.until ? ` · حتى ${fmtDate(d.until)}` : ''}`;
      case 'grant_subscription':
        return `${d.days} يوم · ${d.fields ?? '—'} أرضية · ${d.staff ?? '—'} موظف`;
      case 'set_limits':
        return `الأرضيات ${d.fields_from}→${d.fields_to} · الموظفون ${d.staff_from}→${d.staff_to}`;
      case 'suspend':
      case 'activate':
      case 'end_trial':
      case 'end_subscription':
      case 'grant_lifetime':
      case 'revoke_lifetime':
        return d.reason ? `السبب: ${d.reason}` : '—';
      default:
        return '—';
    }
  }

  function actionCell(action) {
    const m = meta(action);
    return `<span class="audit-action"><i data-lucide="${m.icon}"></i> <span class="status-badge status-badge--${m.cls}">${m.label}</span></span>`;
  }

  // render(list, { showTenant }) → جدول متجاوب أو حالة فارغة
  function render(list, opts) {
    opts = opts || {};
    const showTenant = !!opts.showTenant;
    if (!list || !list.length) {
      return `<div class="card"><div class="empty-state">
        <div class="empty-icon"><i data-lucide="history"></i></div>
        <h3>لا إجراءات بعد</h3><p>ستظهر هنا كل الإجراءات الإدارية (تفعيل، تمديد، منح اشتراك…).</p>
      </div></div>`;
    }
    const head = `<tr><th>الإجراء</th>${showTenant ? '<th>الملعب</th>' : ''}<th>التفاصيل</th><th>المشرف</th><th>التاريخ</th></tr>`;
    const rows = list.map((a) => {
      const tenantCell = showTenant
        ? `<td data-label="الملعب" class="fw-semibold">${a.tenant_id
            ? `<a href="${window.utils.path('/admin/tenants/' + a.tenant_id)}">${window.utils.escapeHtml(a.tenant_name || '—')}</a>`
            : window.utils.escapeHtml(a.tenant_name || '—')}</td>`
        : '';
      return `
        <tr>
          <td data-label="الإجراء">${actionCell(a.action)}</td>
          ${tenantCell}
          <td data-label="التفاصيل">${window.utils.escapeHtml(detailText(a.action, a.details))}</td>
          <td data-label="المشرف">${window.utils.escapeHtml(a.actor || '—')}</td>
          <td data-label="التاريخ">${window.utils.formatDateTime(a.created_at)}</td>
        </tr>`;
    }).join('');
    return `
      <div class="table-wrapper">
        <table class="table table--cards">
          <thead>${head}</thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  return { render, detailText, actionCell, meta };
})();
