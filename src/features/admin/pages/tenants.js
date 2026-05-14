// لوحة المشرف العام - قائمة الملاعب وحالاتها
(async function () {
  await window.adminLayout.renderShell({
    activeTab: 'tenants',
    pageTitle: 'الملاعب'
  });

  const container = document.getElementById('admin-tenants-container');

  function statusInfo(t) {
    if (!t.is_active) return { cls: 'expired', label: 'مغلق' };
    if (t.subscription_ends_at && new Date(t.subscription_ends_at) < new Date()) return { cls: 'grace', label: 'سماح (انتهى الاشتراك)' };
    if (t.trial_ends_at && new Date(t.trial_ends_at) < new Date() && !t.subscription_ends_at) return { cls: 'grace', label: 'سماح (انتهت التجربة)' };
    if (t.subscription_status === 'active') return { cls: 'active', label: 'مشترك' };
    return { cls: 'trial', label: 'تجربة' };
  }

  try {
    const tenants = await window.api.adminListTenants();
    if (!tenants.length) {
      container.innerHTML = `<div class="card"><div class="empty-state"><div class="icon"><i data-lucide="inbox"></i></div><h3>لا توجد ملاعب</h3></div></div>`;
      window.utils.renderIcons(container);
      return;
    }
    container.innerHTML = `
      <div class="card">
        <div class="card-body">
          <div class="table-wrapper">
            <table class="table">
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>المدينة</th>
                  <th>الحالة</th>
                  <th>نهاية التجربة</th>
                  <th>نهاية الاشتراك</th>
                  <th>تاريخ الإنشاء</th>
                  <th>آخر اشتراك مُعتمد</th>
                </tr>
              </thead>
              <tbody>
                ${tenants.map((t) => {
                  const s = statusInfo(t);
                  return `
                    <tr>
                      <td><strong>${window.utils.escapeHtml(t.name)}</strong>${t.phone ? `<div class="text-muted" style="font-size:0.8rem">${window.utils.escapeHtml(t.phone)}</div>` : ''}</td>
                      <td>${window.utils.escapeHtml(t.city || '—')}</td>
                      <td><span class="status-badge status-badge--${s.cls}">${s.label}</span></td>
                      <td>${t.trial_ends_at ? window.utils.formatDateTime(t.trial_ends_at) : '—'}</td>
                      <td>${t.subscription_ends_at ? window.utils.formatDateTime(t.subscription_ends_at) : '—'}</td>
                      <td>${window.utils.formatDate(t.created_at)}</td>
                      <td>${t.last_subscription_at ? window.utils.formatDate(t.last_subscription_at) : '—'}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    window.utils.renderIcons(container);
  } catch (err) {
    container.innerHTML = `<div class="card"><div class="empty-state"><div class="icon"><i data-lucide="triangle-alert"></i></div><h3>تعذّر تحميل البيانات</h3><p>${window.utils.escapeHtml(window.utils.formatError(err))}</p></div></div>`;
    window.utils.renderIcons(container);
  }
})();
