// صفحة الموظفين - module pattern (SPA + legacy)
(function () {
  const TEMPLATE = `
    <div class="page-header">
      <h2>الموظفون</h2>
      <div class="actions">
        <button class="btn btn--primary" id="invite-btn">+ دعوة موظف</button>
      </div>
    </div>

    <div class="card mb-lg">
      <div class="card-header">الموظفون الحاليون</div>
      <div id="staff-list">
        <div class="loader-center"><div class="loader"></div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">الدعوات المعلقة</div>
      <div id="invitations-list">
        <div class="loader-center"><div class="loader"></div></div>
      </div>
    </div>
  `;

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }

  const page = {
    async mount(container, ctx) {
      if (ctx.profile.role !== 'owner') {
        // الراوتر يحمي العادة، لكن fallback إضافي للـ legacy
        container.innerHTML = `<div class="card"><div class="empty-state"><p>هذه الصفحة متاحة للمالك فقط</p></div></div>`;
        return;
      }

      container.innerHTML = TEMPLATE;

      const staffList = container.querySelector('#staff-list');
      const invitationsList = container.querySelector('#invitations-list');
      const inviteBtn = container.querySelector('#invite-btn');

      let alive = true;
      const cleanup = [];
      page._cleanup = cleanup;

      function buildInviteUrl(code) {
        return `${window.location.origin}/auth/signup?invite=${encodeURIComponent(code)}`;
      }

      async function refresh() {
        if (!alive) return;
        try {
          const [staff, invitations] = await Promise.all([
            window.api.listStaff(),
            window.api.listInvitations()
          ]);
          if (!alive) return;

          if (!staff.length) {
            staffList.innerHTML = '<div class="empty-state"><p>لا يوجد موظفون بعد. ابدأ بدعوة موظفك الأول.</p></div>';
          } else {
            staffList.innerHTML = `
              <div class="table-wrapper" style="border:0;border-radius:0">
                <table class="table">
                  <thead>
                    <tr>
                      <th>الاسم</th>
                      <th>الدور</th>
                      <th>تاريخ الانضمام</th>
                      <th class="text-end">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${staff.map((s) => {
                      const isSelf = s.id === ctx.user.id;
                      return `
                        <tr>
                          <td><strong>${window.utils.escapeHtml(s.full_name)}</strong>${isSelf ? ' <span class="badge badge--info">أنت</span>' : ''}</td>
                          <td>${s.role === 'owner' ? '<span class="badge badge--success">مالك</span>' : '<span class="badge badge--muted">موظف</span>'}</td>
                          <td class="text-muted">${window.utils.formatDate(s.created_at)}</td>
                          <td class="text-end">
                            ${!isSelf && s.role === 'staff' ? `<button class="btn btn--danger btn--sm" data-action="remove-staff" data-id="${s.id}" data-name="${window.utils.escapeHtml(s.full_name)}">إزالة</button>` : ''}
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            `;

            staffList.querySelectorAll('[data-action="remove-staff"]').forEach((btn) => {
              btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                const name = btn.dataset.name;
                const ok = await window.utils.confirm({
                  title: 'إزالة موظف',
                  message: `هل أنت متأكد من إزالة "${name}" من فريق الملعب؟ سيفقد الوصول فوراً.`,
                  confirmText: 'إزالة',
                  danger: true
                });
                if (!ok) return;
                try {
                  await window.api.removeStaff(id);
                  window.utils.toast('تمت إزالة الموظف', 'success');
                  refresh();
                } catch (err) {
                  window.utils.toast(window.utils.formatError(err), 'error');
                }
              });
            });
          }

          const pendingInvites = invitations.filter((i) => !i.used_at);
          if (!pendingInvites.length) {
            invitationsList.innerHTML = '<div class="empty-state"><p>لا توجد دعوات معلقة</p></div>';
          } else {
            invitationsList.innerHTML = `
              <div class="table-wrapper" style="border:0;border-radius:0">
                <table class="table">
                  <thead>
                    <tr>
                      <th>الاسم</th>
                      <th>البريد</th>
                      <th>تنتهي في</th>
                      <th>الرابط</th>
                      <th class="text-end">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${pendingInvites.map((i) => {
                      const url = buildInviteUrl(i.code);
                      return `
                        <tr>
                          <td>${window.utils.escapeHtml(i.full_name)}</td>
                          <td>${window.utils.escapeHtml(i.email)}</td>
                          <td class="text-muted">${window.utils.formatDate(i.expires_at)}</td>
                          <td>
                            <button class="btn btn--ghost btn--sm" data-action="copy" data-url="${window.utils.escapeHtml(url)}">نسخ الرابط</button>
                          </td>
                          <td class="text-end">
                            <button class="btn btn--danger btn--sm" data-action="delete-invite" data-id="${i.id}">حذف</button>
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            `;

            invitationsList.querySelectorAll('[data-action="copy"]').forEach((btn) => {
              btn.addEventListener('click', () => {
                copyToClipboard(btn.dataset.url);
                window.utils.toast('تم نسخ رابط الدعوة', 'success');
              });
            });
            invitationsList.querySelectorAll('[data-action="delete-invite"]').forEach((btn) => {
              btn.addEventListener('click', async () => {
                const ok = await window.utils.confirm({
                  title: 'حذف دعوة',
                  message: 'هل أنت متأكد من حذف هذه الدعوة؟',
                  confirmText: 'حذف',
                  danger: true
                });
                if (!ok) return;
                try {
                  await window.api.deleteInvitation(btn.dataset.id);
                  window.utils.toast('تم حذف الدعوة', 'success');
                  refresh();
                } catch (err) {
                  window.utils.toast(window.utils.formatError(err), 'error');
                }
              });
            });
          }
        } catch (err) {
          if (!alive) return;
          staffList.innerHTML = `<div class="empty-state"><p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p></div>`;
        }
      }

      function openInviteModal() {
        const formHtml = `
          <form id="invite-form" autocomplete="off">
            <div class="form-group">
              <label class="form-label">اسم الموظف <span class="required">*</span></label>
              <input type="text" class="form-control" name="full_name" required>
            </div>
            <div class="form-group">
              <label class="form-label">البريد الإلكتروني <span class="required">*</span></label>
              <input type="email" class="form-control" name="email" required>
              <span class="form-help">سيُستخدم لتسجيل دخول الموظف</span>
            </div>
          </form>
        `;
        const footer = `
          <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
          <button type="submit" class="btn btn--primary" form="invite-form">إنشاء الدعوة</button>
        `;
        const ctrl = window.utils.openModal({ title: 'دعوة موظف جديد', body: formHtml, footer });
        ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
        ctrl.modal.querySelector('#invite-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          try {
            const invitation = await window.api.createInvitation({
              full_name: fd.get('full_name').trim(),
              email: fd.get('email').trim()
            });
            ctrl.close();
            showInviteLinkModal(invitation);
            refresh();
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
          }
        });
      }

      function showInviteLinkModal(invitation) {
        const url = buildInviteUrl(invitation.code);
        const body = `
          <p>تم إنشاء الدعوة بنجاح. أرسل الرابط التالي للموظف ليكمل التسجيل:</p>
          <div class="invite-link-box">
            <code>${window.utils.escapeHtml(url)}</code>
            <button class="btn btn--primary btn--sm" id="copy-link-btn">نسخ</button>
          </div>
          <p class="text-muted mt-md" style="font-size:0.9rem">صلاحية الدعوة 7 أيام. يمكنك حذفها في أي وقت من قائمة الدعوات.</p>
        `;
        const footer = `<button type="button" class="btn btn--primary" data-action="ok">تم</button>`;
        const ctrl = window.utils.openModal({ title: 'رابط الدعوة', body, footer });
        ctrl.modal.querySelector('[data-action="ok"]').addEventListener('click', ctrl.close);
        ctrl.modal.querySelector('#copy-link-btn').addEventListener('click', () => {
          copyToClipboard(url);
          window.utils.toast('تم نسخ الرابط', 'success');
        });
      }

      inviteBtn.addEventListener('click', openInviteModal);

      cleanup.push(() => {
        alive = false;
        inviteBtn.removeEventListener('click', openInviteModal);
      });

      refresh();
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages.staff = page;
})();
