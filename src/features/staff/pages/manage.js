// إدارة الموظفين — تبويبات (الموظفون | الدعوات) + modern templates
(function () {
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

  function roleBadge(role) {
    if (role === 'owner') return '<span class="badge badge--success">مالك</span>';
    return '<span class="badge badge--muted">موظف</span>';
  }

  function TEMPLATE() {
    return `
      <div class="page-header">
        <div>
          <h2>الفريق</h2>
          <div class="page-subtitle">إدارة موظفي الملعب ودعواتهم</div>
        </div>
        <div class="actions">
          <button class="btn btn--primary" id="invite-btn">
            <i data-lucide="user-plus"></i> دعوة موظف
          </button>
        </div>
      </div>

      <div class="chip-rail mb-md" id="tabs">
        <button class="chip is-active" data-tab="staff">
          <i data-lucide="users" style="width:12px;height:12px"></i>
          <span>الموظفون</span>
          <span class="badge badge--muted" id="staff-count">…</span>
        </button>
        <button class="chip" data-tab="invites">
          <i data-lucide="mail" style="width:12px;height:12px"></i>
          <span>الدعوات المعلّقة</span>
          <span class="badge badge--muted" id="invites-count">…</span>
        </button>
      </div>

      <div class="card" id="tab-content">
        <div class="loader-center"><div class="loader"></div></div>
      </div>
    `;
  }

  const page = {
    async mount(container, ctx) {
      if (ctx.profile.role !== 'owner') {
        container.innerHTML = `
          <div class="card">
            <div class="empty-state">
              <div class="empty-icon"><i data-lucide="shield-x"></i></div>
              <h3>للمالكين فقط</h3>
              <p>هذه الصفحة متاحة لمالك الملعب فقط.</p>
            </div>
          </div>
        `;
        window.utils.renderIcons(container);
        return;
      }

      container.innerHTML = TEMPLATE();
      window.utils.renderIcons(container);

      const tabContent  = container.querySelector('#tab-content');
      const tabs        = container.querySelectorAll('[data-tab]');
      const inviteBtn   = container.querySelector('#invite-btn');
      const staffCount  = container.querySelector('#staff-count');
      const invCount    = container.querySelector('#invites-count');

      const allowedStaff = (ctx.status && ctx.status.allowed_staff) || 0;
      const pageHeader   = container.querySelector('.page-header');
      const limitBannerSlot = document.createElement('div');
      pageHeader.parentNode.insertBefore(limitBannerSlot, pageHeader.nextSibling);

      function applyLimitToInviteBtn(used) {
        const atLimit = used >= allowedStaff;
        const isTrial = allowedStaff === 0;
        inviteBtn.disabled = atLimit;
        inviteBtn.title = atLimit
          ? (isTrial ? 'إضافة الموظفين غير متاحة في التجربة. اشترك لتفعيلها.'
                     : 'بلغت حد الموظفين. ارفع الباقة من صفحة الاشتراك.')
          : '';
        const msg = isTrial
          ? 'إضافة الموظفين غير متاحة خلال التجربة المجانية.'
          : `بلغت حد الموظفين (${used}/${allowedStaff}).`;
        limitBannerSlot.innerHTML = atLimit ? `
          <div class="trial-banner trial-banner--soon" style="margin-bottom: var(--space-4); border-radius: var(--radius-md)">
            <span class="trial-banner-icon"><i data-lucide="info"></i></span>
            <span>${msg}</span>
            <a class="trial-banner-cta" href="${window.utils.path('/subscription')}">${isTrial ? 'اشترك الآن' : 'ارفع الباقة'}</a>
          </div>
        ` : '';
        window.utils.renderIcons(limitBannerSlot);
      }

      let currentTab = 'staff';
      let alive = true;
      const cleanup = [];
      page._cleanup = cleanup;

      function buildInviteUrl(code) {
        return `${window.location.origin}${window.utils.path('/auth/signup')}?invite=${encodeURIComponent(code)}`;
      }

      function setTab(name) {
        currentTab = name;
        tabs.forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
        refresh();
      }

      tabs.forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));

      function renderStaff(staff) {
        if (!staff.length) {
          return `
            <div class="empty-state">
              <div class="empty-icon"><i data-lucide="users"></i></div>
              <h3>لا يوجد موظفون بعد</h3>
              <p>ابدأ بدعوة موظفك الأول من زر "دعوة موظف" أعلاه.</p>
            </div>
          `;
        }
        return `
          <div class="table-wrapper" style="box-shadow:none;border-radius:0">
            <table class="table">
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>الدور</th>
                  <th>تاريخ الانضمام</th>
                  <th class="actions-cell"></th>
                </tr>
              </thead>
              <tbody>
                ${staff.map((s) => {
                  const isSelf = s.id === ctx.user.id;
                  return `
                    <tr>
                      <td>
                        <div class="fw-semibold">${window.utils.escapeHtml(s.full_name)}</div>
                        ${isSelf ? '<span class="badge badge--info">أنت</span>' : ''}
                      </td>
                      <td>${roleBadge(s.role)}</td>
                      <td class="text-tertiary text-xs">${window.utils.formatDate(s.created_at)}</td>
                      <td class="actions-cell">
                        ${!isSelf && s.role === 'staff' ? `
                          <div class="actions-inline">
                            <button class="btn btn--xs btn--danger-quiet" data-action="remove-staff"
                                    data-id="${s.id}" data-name="${window.utils.escapeHtml(s.full_name)}"
                                    title="إزالة">
                              <i data-lucide="user-minus"></i>
                            </button>
                          </div>
                        ` : ''}
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      function renderInvites(invitations) {
        const pending = invitations.filter((i) => !i.used_at);
        if (!pending.length) {
          return `
            <div class="empty-state">
              <div class="empty-icon"><i data-lucide="mail-check"></i></div>
              <h3>لا توجد دعوات معلّقة</h3>
              <p>كل الدعوات المرسلة استُخدمت أو انتهت صلاحيتها.</p>
            </div>
          `;
        }
        return `
          <div class="table-wrapper" style="box-shadow:none;border-radius:0">
            <table class="table">
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>البريد الإلكتروني</th>
                  <th>تنتهي في</th>
                  <th class="actions-cell"></th>
                </tr>
              </thead>
              <tbody>
                ${pending.map((i) => {
                  const url = buildInviteUrl(i.code);
                  return `
                    <tr>
                      <td class="fw-semibold">${window.utils.escapeHtml(i.full_name)}</td>
                      <td class="text-muted">${window.utils.escapeHtml(i.email)}</td>
                      <td class="text-tertiary text-xs">${window.utils.formatDate(i.expires_at)}</td>
                      <td class="actions-cell">
                        <div class="actions-inline">
                          <button class="btn btn--xs btn--accent-quiet" data-action="copy"
                                  data-url="${window.utils.escapeHtml(url)}" title="نسخ الرابط">
                            <i data-lucide="link"></i>
                          </button>
                          <button class="btn btn--xs btn--danger-quiet" data-action="delete-invite"
                                  data-id="${i.id}" title="حذف">
                            <i data-lucide="trash-2"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      async function refresh() {
        if (!alive) return;
        tabContent.innerHTML = '<div class="loader-center"><div class="loader"></div></div>';
        try {
          const [staff, invitations] = await Promise.all([
            window.api.listStaff(),
            window.api.listInvitations()
          ]);
          if (!alive) return;

          const pendingInv = invitations.filter((i) => !i.used_at);
          const staffMembers = staff.filter((s) => s.role === 'staff');
          staffCount.textContent = `${staffMembers.length}/${allowedStaff}`;
          invCount.textContent   = pendingInv.length;
          applyLimitToInviteBtn(staffMembers.length + pendingInv.length);

          if (currentTab === 'staff') {
            tabContent.innerHTML = renderStaff(staff);
          } else {
            tabContent.innerHTML = renderInvites(invitations);
          }

          // ربط أفعال
          tabContent.querySelectorAll('[data-action="copy"]').forEach((btn) => {
            btn.addEventListener('click', () => {
              copyToClipboard(btn.dataset.url);
              window.utils.toast('تم نسخ رابط الدعوة', 'success');
            });
          });

          tabContent.querySelectorAll('[data-action="remove-staff"]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const id = btn.dataset.id;
              const name = btn.dataset.name;
              const ok = await window.utils.confirm({
                title: 'إزالة موظف',
                message: `هل أنت متأكد من إزالة "${name}"؟ سيفقد الوصول فوراً.`,
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

          tabContent.querySelectorAll('[data-action="delete-invite"]').forEach((btn) => {
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

          window.utils.renderIcons(container);
        } catch (err) {
          if (!alive) return;
          tabContent.innerHTML = `
            <div class="empty-state">
              <div class="empty-icon"><i data-lucide="triangle-alert"></i></div>
              <p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p>
            </div>
          `;
          window.utils.renderIcons(container);
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
              <span class="form-help">سيُستخدم لتسجيل دخول الموظف.</span>
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
              email:     fd.get('email').trim()
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
          <p>تم إنشاء الدعوة. أرسل الرابط التالي للموظف ليكمل التسجيل:</p>
          <div class="invite-link-box">
            <code>${window.utils.escapeHtml(url)}</code>
            <button class="btn btn--primary btn--sm" id="copy-link-btn">
              <i data-lucide="copy"></i> نسخ
            </button>
          </div>
          <p class="text-muted text-xs mt-md">صلاحية الدعوة 7 أيام. يمكنك حذفها في أي وقت من قائمة الدعوات.</p>
        `;
        const footer = `<button type="button" class="btn btn--primary" data-action="ok">تم</button>`;
        const ctrl = window.utils.openModal({ title: 'رابط الدعوة', body, footer });
        ctrl.modal.querySelector('[data-action="ok"]').addEventListener('click', ctrl.close);
        ctrl.modal.querySelector('#copy-link-btn').addEventListener('click', () => {
          copyToClipboard(url);
          window.utils.toast('تم نسخ الرابط', 'success');
        });
        window.utils.renderIcons(ctrl.modal);
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
