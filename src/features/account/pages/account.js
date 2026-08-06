// صفحة «حسابي» — معلومات الحساب + تعديل الاسم + تغيير كلمة المرور.
// متاحة لكل الأدوار (مالك/موظف). تعتمد Supabase Auth — بلا تبعيّات.
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
      const user = ctx.user || {};
      const profile = ctx.profile || {};
      const tenant = ctx.tenant || {};
      const email = user.email || '—';
      const roleLabel = profile.role === 'owner' ? 'مالك' : 'موظف';

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
              ${infoRow('الدور', roleLabel)}
              ${infoRow('الملعب', window.utils.escapeHtml(tenant.name || '—'))}
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
                       value="${window.utils.escapeHtml(profile.full_name || '')}">
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

        <div class="card" style="margin-top:var(--space-4)">
          <div class="card-header"><h3>النظام والخصوصية</h3></div>
          <div class="card-body">
            <div style="display:flex;gap:var(--space-3);flex-wrap:wrap">
              <a class="btn btn--ghost btn--sm" href="${window.utils.path('/legal/privacy.html')}">
                <i data-lucide="shield-check"></i> سياسة الخصوصية
              </a>
              <a class="btn btn--ghost btn--sm" href="${window.utils.path('/legal/terms.html')}">
                <i data-lucide="file-text"></i> شروط الاستخدام
              </a>
            </div>
          </div>
        </div>

        <div class="card danger-zone" style="margin-top:var(--space-4)">
          <div class="card-header"><h3>حذف الحساب</h3></div>
          <div class="card-body">
            <p class="text-muted text-sm" style="margin-bottom:var(--space-3)">
              ${profile.role === 'owner'
                ? 'حذف حسابك يمحو ملعبك وكل بياناته نهائياً: الحجوزات، العملاء، الأرضيات، التقارير، وحسابات موظفيك. لا يمكن استرجاع شيء بعد التنفيذ.'
                : 'حذف حسابك يُلغي عضويتك في هذا الملعب ويمحو بياناتك الشخصية. حجوزات الملعب تبقى ملكاً لمالكه.'}
            </p>
            <div class="card-actions">
              <button type="button" class="btn btn--danger" id="delete-account-btn">
                <i data-lucide="trash-2"></i> حذف حسابي نهائياً
              </button>
            </div>
          </div>
        </div>

        <div class="card" style="margin-top:var(--space-4)">
          <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-2)">
            <h3>الأجهزة المسجّلة</h3>
            <button type="button" class="btn btn--ghost btn--sm" id="sessions-signout-others">
              <i data-lucide="log-out"></i><span>الخروج من الأجهزة الأخرى</span>
            </button>
          </div>
          <div class="card-body">
            <div id="sessions-list"><div class="loader-center"><div class="loader"></div></div></div>
            <p class="form-help" style="margin-top:var(--space-3);margin-bottom:0">
              إنهاء جهاز يلغي جلسته؛ قد يستغرق خروجه فعليًّا حتى ساعة حتى تنتهي صلاحية رمز دخوله الحالي.
            </p>
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
          const { error } = await window.sb.from('profiles').update({ full_name: name }).eq('id', user.id);
          if (error) throw error;
          // مزامنة الاسم مع user_metadata (يستخدمه عرض المشرف)
          try { await window.sb.auth.updateUser({ data: { display_name: name, full_name: name } }); } catch (_) {}
          // تحديث الشريط الجانبي مباشرةً
          if (ctx.profile) ctx.profile.full_name = name;
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

      // ── الأجهزة المسجّلة ──
      function parseUA(ua) {
        ua = ua || '';
        let os = '';
        if (/Windows/i.test(ua)) os = 'Windows';
        else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
        else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
        else if (/Android/i.test(ua)) os = 'Android';
        else if (/Linux/i.test(ua)) os = 'Linux';
        let browser = '';
        if (/Edg\//i.test(ua)) browser = 'Edge';
        else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
        else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Internet';
        else if (/CriOS/i.test(ua) || (/Chrome\//i.test(ua) && !/Edg\//i.test(ua))) browser = 'Chrome';
        else if (/Firefox\/|FxiOS/i.test(ua)) browser = 'Firefox';
        else if (/Version\/.*Safari/i.test(ua)) browser = 'Safari';
        const label = [browser, os].filter(Boolean).join(' · ') || 'جهاز غير معروف';
        const icon = /iPhone|iPod|Mobile/i.test(ua) ? 'smartphone'
                   : /iPad|Tablet/i.test(ua) ? 'tablet'
                   : 'monitor';
        return { label, icon };
      }

      function relTime(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        const diff = (Date.now() - d.getTime()) / 1000;
        if (isNaN(diff)) return '—';
        if (diff < 90) return 'الآن';
        if (diff < 3600) return `منذ ${Math.floor(diff / 60)} دقيقة`;
        if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} ساعة`;
        if (diff < 2592000) return `منذ ${Math.floor(diff / 86400)} يوم`;
        return window.utils.formatDate(iso);
      }

      function sessionRow(s) {
        const { label, icon } = parseUA(s.user_agent);
        const meta = `آخر نشاط ${relTime(s.last_seen)}${s.ip ? ' · ' + window.utils.escapeHtml(String(s.ip)) : ''}`;
        return `
          <div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3) 0;border-top:1px solid var(--border-subtle)">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;flex:none;border-radius:var(--radius-md);background:var(--surface-2);color:var(--text-secondary)"><i data-lucide="${icon}"></i></span>
            <div style="flex:1;min-width:0">
              <div class="fw-semibold" style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap">
                ${window.utils.escapeHtml(label)}
                ${s.is_current ? '<span class="chip-status chip-status--success">هذا الجهاز</span>' : ''}
              </div>
              <div class="text-xs text-tertiary" style="margin-top:2px">${meta}</div>
            </div>
            ${s.is_current ? '' : `<button type="button" class="btn btn--xs btn--danger-quiet" data-action="revoke" data-id="${s.id}" title="تسجيل الخروج"><i data-lucide="log-out"></i><span class="btn-label">خروج</span></button>`}
          </div>`;
      }

      const sessionsList = container.querySelector('#sessions-list');
      const signoutOthersBtn = container.querySelector('#sessions-signout-others');

      async function loadSessions() {
        sessionsList.innerHTML = '<div class="loader-center"><div class="loader"></div></div>';
        try {
          const { data, error } = await window.sb.rpc('list_my_sessions');
          if (error) throw error;
          const sessions = data || [];
          if (!sessions.length) {
            sessionsList.innerHTML = '<p class="text-tertiary" style="margin:0">لا توجد جلسات نشطة.</p>';
            if (signoutOthersBtn) signoutOthersBtn.style.display = 'none';
            return;
          }
          if (signoutOthersBtn) signoutOthersBtn.style.display = sessions.length > 1 ? '' : 'none';
          sessionsList.innerHTML = sessions.map(sessionRow).join('');
          window.utils.renderIcons(sessionsList);
          sessionsList.querySelectorAll('[data-action="revoke"]').forEach((btn) => {
            btn.addEventListener('click', async () => {
              const ok = await window.utils.confirm({
                title: 'إنهاء الجلسة',
                message: 'تسجيل الخروج من هذا الجهاز؟',
                confirmText: 'خروج', danger: true,
              });
              if (!ok) return;
              btn.disabled = true;
              try {
                const { error: rErr } = await window.sb.rpc('revoke_my_session', { p_session_id: btn.dataset.id });
                if (rErr) throw rErr;
                window.utils.toast('تم إنهاء الجلسة', 'success');
                loadSessions();
              } catch (err) {
                window.utils.toast(window.utils.formatError(err), 'error');
                btn.disabled = false;
              }
            });
          });
        } catch (err) {
          sessionsList.innerHTML = `<p class="text-danger" style="margin:0">${window.utils.escapeHtml(window.utils.formatError(err))}</p>`;
        }
      }

      if (signoutOthersBtn) {
        signoutOthersBtn.addEventListener('click', async () => {
          const ok = await window.utils.confirm({
            title: 'الخروج من الأجهزة الأخرى',
            message: 'سيتم تسجيل الخروج من كل الأجهزة عدا هذا الجهاز.',
            confirmText: 'متابعة', danger: true,
          });
          if (!ok) return;
          signoutOthersBtn.disabled = true;
          try {
            const { error } = await window.sb.auth.signOut({ scope: 'others' });
            if (error) throw error;
            window.utils.toast('تم تسجيل الخروج من الأجهزة الأخرى', 'success');
            loadSessions();
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
          } finally {
            signoutOthersBtn.disabled = false;
          }
        });
      }

      // ── حذف الحساب ──
      // متطلَّب إلزامي في متجرَي أبل وقوقل (أبل 5.1.1(v)): الحذف يُبدأ ويكتمل
      // من داخل التطبيق، لا بمراسلة الدعم. والتنفيذ في Edge Function باسم
      // delete-account لأن حذف هوية المصادقة يحتاج مفتاح service_role.
      const deleteBtn = container.querySelector('#delete-account-btn');
      if (deleteBtn) {
        const isOwner = profile.role === 'owner';
        deleteBtn.addEventListener('click', async () => {
          // حاجزان للمالك (منشأة كاملة تُمحى)، وحاجز واحد للموظّف.
          const first = await window.utils.confirm({
            title: 'حذف الحساب نهائياً',
            message: isOwner
              ? `سيُحذف ملعب «${window.utils.escapeHtml(tenant.name || '')}» وكل بياناته، وحساباتُ موظفيك. لا رجوع بعد ذلك.`
              : 'سيُحذف حسابك وتُلغى عضويتك في الملعب. لا رجوع بعد ذلك.',
            confirmText: 'متابعة', danger: true
          });
          if (!first) return;

          // المالك يكتب كلمة التأكيد بيده: نقرتان متتاليتان تحدثان بالخطأ،
          // وكتابةُ كلمةٍ لا تحدث بالخطأ.
          if (isOwner) {
            const typed = await promptConfirmWord();
            if (typed !== 'حذف') {
              if (typed !== null) window.utils.toast('لم تُطابق كلمة التأكيد — لم يُحذف شيء', 'warning');
              return;
            }
          }

          deleteBtn.disabled = true;
          const label = deleteBtn.innerHTML;
          deleteBtn.innerHTML = 'جارٍ الحذف…';
          try {
            // ألغِ اشتراك الإشعارات والجلسة الفعّالة قبل فقد الرمز
            try { if (window.push && window.push.teardown) await window.push.teardown(); } catch (_) {}

            const { data, error } = await window.sb.functions.invoke('delete-account', {
              body: { delete_business: isOwner }
            });
            if (error) throw error;
            if (data && data.error) throw new Error(data.error);

            window.utils.toast('تم حذف حسابك', 'success');
            // الرمز صار لهوية محذوفة — نظّف محلياً ثم اخرج
            try { await window.sb.auth.signOut({ scope: 'local' }); } catch (_) {}
            if (window.store) window.store.clearAll();
            const base = (window.__BASE__ || '');
            const loginPath = window.native ? window.native.docPath('/auth/login') : '/auth/login';
            window.location.replace(base + loginPath);
          } catch (err) {
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = label;
            const msg = String((err && err.message) || err);
            window.utils.toast(
              msg.includes('identity_delete_failed')
                ? 'حُذفت بياناتك لكن تعذّر حذف هوية الدخول — راسل الدعم لإكمالها'
                : window.utils.formatError(err),
              'error'
            );
          }
        });
      }

      // نافذة كتابة كلمة التأكيد — تُرجع النص، أو null عند الإلغاء
      function promptConfirmWord() {
        return new Promise((resolve) => {
          let settled = false;
          const done = (v) => { if (!settled) { settled = true; resolve(v); } };
          const ctrl = window.utils.openModal({
            title: 'تأكيد أخير',
            body: `
              <p class="text-sm" style="margin-bottom:var(--space-3)">
                اكتب كلمة <strong>حذف</strong> لتأكيد محو الملعب وكل بياناته.
              </p>
              <input type="text" class="form-control" id="confirm-word" autocomplete="off" dir="rtl">`,
            footer: `
              <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
              <button type="button" class="btn btn--danger" data-action="confirm">حذف نهائياً</button>`,
            onClose: () => done(null)
          });
          const input = ctrl.modal.querySelector('#confirm-word');
          input.focus();
          ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', () => { ctrl.close(); done(null); });
          ctrl.modal.querySelector('[data-action="confirm"]').addEventListener('click', () => {
            const v = (input.value || '').trim();
            ctrl.close();
            done(v);
          });
        });
      }

      loadSessions();
    },

    unmount() {}
  };

  window.pages = window.pages || {};
  window.pages['account'] = page;
})();
