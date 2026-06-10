// لوحة المشرف العام — صفحة «حسابي» (عرض + تعديل الاسم + تغيير كلمة المرور).
// المشرف لا يملك صفًّا في profiles → الاسم يُخزَّن في auth.user_metadata.
(function () {
  function infoRow(label, value) {
    return `
      <div style="min-width:0">
        <div class="text-xs text-tertiary fw-medium mb-sm">${label}</div>
        <div class="fw-semibold" style="overflow-wrap:anywhere">${value}</div>
      </div>`;
  }

  const page = {
    async mount(container, ctx) {
      ctx = ctx || (window.layout && window.layout.getContext()) || {};
      let user = ctx.user || {};
      // اجلب أحدث بيانات المستخدم (الاسم قد يكون أُحدِّث)
      try { const { data } = await window.sb.auth.getUser(); if (data && data.user) user = data.user; } catch (_) {}
      const email = user.email || '—';
      const meta = user.user_metadata || {};
      const currentName = meta.display_name || meta.full_name || '';

      container.innerHTML = `
        <div class="page-header">
          <div>
            <h2>حسابي</h2>
            <div class="page-subtitle">معلومات حسابك وأمانه</div>
          </div>
        </div>

        <div class="card mb-md">
          <div class="card-body">
            <div style="display:flex;flex-direction:column;gap:var(--space-4)">
              ${infoRow('البريد الإلكتروني', window.utils.escapeHtml(email))}
              ${infoRow('الدور', 'مشرف عام')}
            </div>
          </div>
        </div>

        <div class="card mb-md">
          <div class="card-header"><h3>الاسم</h3></div>
          <div class="card-body">
            <form id="name-form">
              <div class="form-group">
                <label class="form-label" for="acct-name">الاسم الظاهر</label>
                <input type="text" class="form-control" id="acct-name" maxlength="80" required
                       value="${window.utils.escapeHtml(currentName)}">
              </div>
              <div class="card-actions">
                <button type="submit" class="btn btn--primary" id="name-save">حفظ الاسم</button>
              </div>
            </form>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>تغيير كلمة المرور</h3></div>
          <div class="card-body">
            <form id="pass-form">
              <div class="form-group">
                <label class="form-label" for="acct-pass">كلمة المرور الجديدة</label>
                <input type="password" class="form-control" id="acct-pass" minlength="6" required autocomplete="new-password">
                <span class="form-help">٦ أحرف على الأقل.</span>
              </div>
              <div class="form-group">
                <label class="form-label" for="acct-pass2">تأكيد كلمة المرور</label>
                <input type="password" class="form-control" id="acct-pass2" minlength="6" required autocomplete="new-password">
              </div>
              <div class="card-actions">
                <button type="submit" class="btn btn--primary" id="pass-save">تحديث كلمة المرور</button>
              </div>
            </form>
          </div>
        </div>
      `;
      window.utils.renderIcons(container);

      // ── تعديل الاسم ──
      const nameForm = container.querySelector('#name-form');
      const nameInput = container.querySelector('#acct-name');
      nameForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = (nameInput.value || '').trim();
        if (!name) { window.utils.toast('الاسم مطلوب', 'error'); return; }
        const btn = container.querySelector('#name-save');
        btn.disabled = true;
        try {
          const { error } = await window.sb.auth.updateUser({ data: { display_name: name, full_name: name } });
          if (error) throw error;
          const nameEl = document.querySelector('.sidebar-user-name');
          if (nameEl) nameEl.textContent = name;
          const avEl = document.querySelector('.sidebar-user .user-avatar');
          if (avEl) avEl.textContent = (name.trim().charAt(0) || '?').toUpperCase();
          window.utils.toast('تم حفظ الاسم', 'success');
        } catch (err) {
          window.utils.toast(window.utils.formatError(err), 'error');
        } finally {
          btn.disabled = false;
        }
      });

      // ── تغيير كلمة المرور ──
      const passForm = container.querySelector('#pass-form');
      passForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const p1 = container.querySelector('#acct-pass').value;
        const p2 = container.querySelector('#acct-pass2').value;
        if (p1.length < 6) { window.utils.toast('كلمة المرور قصيرة (٦ أحرف على الأقل)', 'error'); return; }
        if (p1 !== p2) { window.utils.toast('كلمتا المرور غير متطابقتين', 'error'); return; }
        const btn = container.querySelector('#pass-save');
        btn.disabled = true;
        try {
          const { error } = await window.sb.auth.updateUser({ password: p1 });
          if (error) throw error;
          passForm.reset();
          window.utils.toast('تم تحديث كلمة المرور', 'success');
        } catch (err) {
          window.utils.toast(window.utils.formatError(err), 'error');
        } finally {
          btn.disabled = false;
        }
      });
    },

    unmount() {}
  };

  window.pages = window.pages || {};
  window.pages['admin-account'] = page;
})();
