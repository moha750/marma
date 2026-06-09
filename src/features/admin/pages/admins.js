// لوحة المشرف العام — إدارة المشرفين العامّين (إضافة/إزالة).
(function () {
  function render(admins, selfId) {
    const rows = admins.map((a) => {
      const isSelf = a.user_id === selfId;
      return `
        <tr>
          <td data-label="المشرف" class="fw-semibold">${a.name ? window.utils.escapeHtml(a.name) : '—'}${isSelf ? ' <span class="text-tertiary text-xs">(أنت)</span>' : ''}</td>
          <td data-label="البريد">${window.utils.escapeHtml(a.email || '—')}</td>
          <td data-label="أُضيف">${window.utils.formatDate(a.created_at)}</td>
          <td data-label="" class="actions-cell text-end">
            ${isSelf ? '' : `<div class="actions-inline"><button class="btn btn--danger btn--sm" data-remove="${a.user_id}" data-name="${window.utils.escapeHtml(a.email || a.name || '')}">إزالة</button></div>`}
          </td>
        </tr>`;
    }).join('');
    return `
      <div class="table-wrapper">
        <table class="table table--cards">
          <thead>
            <tr><th>المشرف</th><th>البريد</th><th>أُضيف</th><th class="text-end"></th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  const page = {
    async mount(container, ctx) {
      const selfId = ctx && ctx.user && ctx.user.id;
      let alive = true;
      page._cleanup = [() => { alive = false; }];

      container.innerHTML = `
        <div class="page-header">
          <div>
            <h2>المشرفون</h2>
            <div class="page-subtitle">من يملك صلاحية لوحة المشرف العام</div>
          </div>
        </div>
        <div class="card" style="margin-bottom:var(--space-4)">
          <div class="card-body">
            <form id="add-admin-form" class="cal-subbar" style="margin:0">
              <input type="email" class="form-control" id="add-admin-email" placeholder="بريد المستخدم (يجب أن يملك حساباً)" required style="max-width:320px">
              <button type="submit" class="btn btn--primary btn--sm" id="add-admin-btn"><i data-lucide="user-plus"></i> إضافة مشرف</button>
            </form>
            <span class="form-help">يُضاف المستخدم كمشرف عام بصلاحية كاملة على اللوحة.</span>
          </div>
        </div>
        <div id="admins-body"></div>
      `;
      window.utils.renderIcons(container);

      const body = container.querySelector('#admins-body');
      const form = container.querySelector('#add-admin-form');
      const emailEl = container.querySelector('#add-admin-email');

      async function load() {
        body.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
        try {
          const admins = await window.api.adminListAdmins();
          if (!alive) return;
          body.innerHTML = render(admins, selfId);
          window.utils.renderIcons(body);
          body.querySelectorAll('[data-remove]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const ok = await window.utils.confirm({
                title: 'إزالة مشرف',
                message: `إزالة صلاحية المشرف عن "${btn.dataset.name}"؟`,
                confirmText: 'إزالة', danger: true
              });
              if (!ok) return;
              try {
                await window.api.adminRemoveAdmin(btn.dataset.remove);
                window.utils.toast('تمت الإزالة', 'success');
                await load();
              } catch (err) {
                window.utils.toast(window.utils.formatError(err), 'error');
              }
            });
          });
        } catch (err) {
          if (!alive) return;
          body.innerHTML = `<div class="card"><div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert"></i></div><h3>تعذّر التحميل</h3><p>${window.utils.escapeHtml(window.utils.formatError(err))}</p></div></div>`;
          window.utils.renderIcons(body);
        }
      }

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = (emailEl.value || '').trim();
        if (!email) return;
        const btn = container.querySelector('#add-admin-btn');
        btn.disabled = true;
        try {
          await window.api.adminAddAdmin(email);
          window.utils.toast('تمت إضافة المشرف', 'success');
          emailEl.value = '';
          await load();
        } catch (err) {
          window.utils.toast(window.utils.formatError(err), 'error');
        } finally {
          btn.disabled = false;
        }
      });

      load();
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages['admin-admins'] = page;
})();
