// لوحة المشرف العام — نظرة عامة (KPIs). قراءة فقط من RPCs الموجودة، بلا migration.
(function () {
  // حالة المستأجر — نفس منطق صفحة الملاعب
  function statusOf(t) {
    if (!t.is_active) return 'expired';
    if (t.subscription_ends_at && new Date(t.subscription_ends_at) < new Date()) return 'grace';
    if (t.trial_ends_at && new Date(t.trial_ends_at) < new Date() && !t.subscription_ends_at) return 'grace';
    if (t.subscription_status === 'active') return 'active';
    return 'trial';
  }

  function card({ icon, label, value, sub, variant }) {
    const v = variant ? ` stat-card--${variant}` : '';
    const chip = variant ? `stat-icon-chip stat-icon-chip--${variant}` : 'stat-icon-chip';
    return `
      <div class="stat-card${v}">
        <div class="stat-card-head">
          <span class="${chip}"><i data-lucide="${icon}"></i></span>
          <span class="stat-label">${label}</span>
        </div>
        <div class="stat-value tabular-nums">${value}</div>
        ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
      </div>`;
  }

  function render(tenants, pending) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const in7 = new Date(now.getTime() + 7 * 86400000);
    const counts = { active: 0, trial: 0, grace: 0, expired: 0 };
    let newThisMonth = 0, expiringSoon = 0;

    tenants.forEach((t) => {
      counts[statusOf(t)]++;
      if (t.created_at && new Date(t.created_at) >= monthStart) newThisMonth++;
      if (t.is_active && t.subscription_ends_at) {
        const e = new Date(t.subscription_ends_at);
        if (e >= now && e <= in7) expiringSoon++;
      }
    });

    const total = tenants.length;
    const inactive = counts.grace + counts.expired;
    const pendingAmount = pending.reduce((s, p) => s + (Number(p.amount) || 0), 0);

    return `
      <div class="page-header">
        <div>
          <h2>نظرة عامة</h2>
          <div class="page-subtitle">نبض المنصّة — الملاعب والاشتراكات</div>
        </div>
      </div>
      <div class="stats-grid">
        ${card({ icon: 'goal', label: 'إجمالي الملاعب', value: total, sub: `${counts.active} مشترك · ${counts.trial} تجربة` })}
        ${card({ icon: 'badge-check', label: 'مشتركون نشطون', value: counts.active, sub: 'اشتراك مدفوع فعّال' })}
        ${card({ icon: 'hourglass', label: 'تجارب نشطة', value: counts.trial, sub: 'في فترة التجربة المجانية' })}
        ${card({ icon: 'credit-card', label: 'طلبات معلّقة', value: pending.length, sub: pending.length ? `${window.utils.formatCurrency(pendingAmount)} بانتظار المراجعة` : 'لا طلبات معلّقة', variant: pending.length ? 'warning' : '' })}
        ${card({ icon: 'triangle-alert', label: 'تنتهي خلال 7 أيام', value: expiringSoon, sub: 'اشتراكات قاربت الانتهاء', variant: expiringSoon ? 'warning' : '' })}
        ${card({ icon: 'circle-slash', label: 'منتهية / سماح', value: inactive, sub: `${counts.grace} سماح · ${counts.expired} مغلق` })}
        ${card({ icon: 'user-plus', label: 'جديدة هذا الشهر', value: newThisMonth, sub: 'ملاعب سُجّلت هذا الشهر' })}
      </div>
    `;
  }

  const page = {
    async mount(container) {
      container.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
      let alive = true;
      page._cleanup = [() => { alive = false; }];
      try {
        const [tenants, pending] = await Promise.all([
          window.api.adminListTenants(),
          window.api.adminListPendingSubscriptions()
        ]);
        if (!alive) return;
        container.innerHTML = render(tenants || [], pending || []);
        window.utils.renderIcons(container);
      } catch (err) {
        if (!alive) return;
        container.innerHTML = `
          <div class="page-header"><div><h2>نظرة عامة</h2></div></div>
          <div class="card"><div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert"></i></div><h3>تعذّر تحميل البيانات</h3><p>${window.utils.escapeHtml(window.utils.formatError(err))}</p></div></div>`;
        window.utils.renderIcons(container);
      }
    },
    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages['admin-overview'] = page;
})();
