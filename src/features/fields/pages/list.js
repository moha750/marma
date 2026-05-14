// صفحة الأرضيات - module pattern (SPA + legacy)
(function () {
  const TEMPLATE = `
    <div class="page-header">
      <h2>الأرضيات</h2>
      <div class="actions">
        <button class="btn btn--primary" id="add-field-btn">+ إضافة أرضية</button>
      </div>
    </div>
    <div id="fields-container">
      <div class="loader-center"><div class="loader loader--lg"></div></div>
    </div>
  `;

  function renderRow(f, isOwner) {
    const status = f.is_active
      ? '<span class="badge badge--success">نشط</span>'
      : '<span class="badge badge--muted">معطّل</span>';
    return `
      <tr>
        <td><strong>${window.utils.escapeHtml(f.name)}</strong></td>
        <td>${status}</td>
        ${isOwner ? `
          <td class="text-end">
            <div class="actions-cell" style="justify-content:flex-end">
              <button class="btn btn--primary btn--sm" data-action="edit" data-id="${f.id}">✎ تعديل</button>
              <button class="btn btn--secondary btn--sm" data-action="toggle" data-id="${f.id}">${f.is_active ? 'تعطيل' : 'تفعيل'}</button>
              <button class="btn btn--danger btn--sm" data-action="delete" data-id="${f.id}">حذف</button>
            </div>
          </td>
        ` : ''}
      </tr>
    `;
  }

  const page = {
    async mount(container, ctx) {
      container.innerHTML = TEMPLATE;
      const isOwner = ctx.profile.role === 'owner';

      const listContainer = container.querySelector('#fields-container');
      const addBtn = container.querySelector('#add-field-btn');
      if (!isOwner) addBtn.style.display = 'none';

      let alive = true;
      const cleanup = [];
      page._cleanup = cleanup;

      const scheduleHref = '/schedule';

      function invalidateFieldsCache() {
        if (window.store) {
          window.store.invalidate('fields:active');
          window.store.invalidate('fields:all');
        }
      }

      async function refresh() {
        if (!alive) return;
        listContainer.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
        try {
          // لا نستخدم store هنا لأن الصفحة تعرض القائمة كاملة وتحتاج آخر بيانات بعد كل تعديل
          const fields = await window.api.listFields(true);
          if (!alive) return;

          if (!fields.length) {
            listContainer.innerHTML = `
              <div class="card">
                <div class="empty-state">
                  <div class="icon"><i data-lucide="goal"></i></div>
                  <h3>لا توجد أرضيات</h3>
                  <p>${isOwner ? 'ابدأ بإضافة أول أرضية لملعبك' : 'لم يقم المالك بإضافة أرضيات بعد'}</p>
                </div>
              </div>
            `;
            window.utils.renderIcons(listContainer);
            return;
          }

          listContainer.innerHTML = `
            <div class="table-wrapper">
              <table class="table">
                <thead>
                  <tr>
                    <th>اسم الأرضية</th>
                    <th>الحالة</th>
                    ${isOwner ? '<th class="text-end">إجراءات</th>' : ''}
                  </tr>
                </thead>
                <tbody>
                  ${fields.map((f) => renderRow(f, isOwner)).join('')}
                </tbody>
              </table>
            </div>
          `;

          if (isOwner) {
            listContainer.querySelectorAll('[data-action="edit"]').forEach((btn) => {
              btn.addEventListener('click', () => {
                const field = fields.find((f) => f.id === btn.dataset.id);
                openFieldModal(field);
              });
            });
            listContainer.querySelectorAll('[data-action="toggle"]').forEach((btn) => {
              btn.addEventListener('click', async () => {
                const field = fields.find((f) => f.id === btn.dataset.id);
                try {
                  await window.api.updateField(field.id, { is_active: !field.is_active });
                  window.utils.toast(field.is_active ? 'تم تعطيل الأرضية' : 'تم تفعيل الأرضية', 'success');
                  invalidateFieldsCache();
                  refresh();
                } catch (err) {
                  window.utils.toast(window.utils.formatError(err), 'error');
                }
              });
            });
            listContainer.querySelectorAll('[data-action="delete"]').forEach((btn) => {
              btn.addEventListener('click', async () => {
                const field = fields.find((f) => f.id === btn.dataset.id);
                const ok = await window.utils.confirm({
                  title: 'حذف أرضية',
                  message: `هل أنت متأكد من حذف الأرضية "${field.name}"؟ لا يمكن الحذف إذا كان عليها حجوزات.`,
                  confirmText: 'حذف',
                  danger: true
                });
                if (!ok) return;
                try {
                  await window.api.deleteField(field.id);
                  window.utils.toast('تم حذف الأرضية', 'success');
                  invalidateFieldsCache();
                  refresh();
                } catch (err) {
                  window.utils.toast(window.utils.formatError(err), 'error');
                }
              });
            });
          }
          window.utils.renderIcons(listContainer);
        } catch (err) {
          if (!alive) return;
          listContainer.innerHTML = `<div class="card"><div class="empty-state"><p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p></div></div>`;
        }
      }

      function openFieldModal(field) {
        const editing = !!field;
        const formHtml = `
          <form id="field-form" autocomplete="off">
            <div class="form-group">
              <label class="form-label" for="name">اسم الأرضية <span class="required">*</span></label>
              <input type="text" class="form-control" id="name" name="name" required value="${editing ? window.utils.escapeHtml(field.name) : ''}" placeholder="مثلاً: الملعب رقم 1">
              <span class="form-help">مدة الموعد والسعر يُضبطان من <a href="${scheduleHref}">صفحة أيام وفترات العمل</a>.</span>
            </div>
          </form>
        `;
        const footer = `
          <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
          <button type="submit" class="btn btn--primary" form="field-form">${editing ? 'حفظ التعديلات' : 'إضافة'}</button>
        `;
        const ctrl = window.utils.openModal({
          title: editing ? 'تعديل أرضية' : 'إضافة أرضية',
          body: formHtml,
          footer
        });
        ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
        ctrl.modal.querySelector('#field-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const payload = { name: fd.get('name') };
          try {
            if (editing) {
              await window.api.updateField(field.id, payload);
              window.utils.toast('تم تحديث الأرضية', 'success');
            } else {
              await window.api.createField(payload);
              window.utils.toast('تمت إضافة الأرضية', 'success');
            }
            invalidateFieldsCache();
            ctrl.close();
            refresh();
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
          }
        });
      }

      const onAdd = () => openFieldModal(null);
      addBtn.addEventListener('click', onAdd);
      cleanup.push(() => {
        alive = false;
        addBtn.removeEventListener('click', onAdd);
      });

      if (window.realtime) {
        const debouncedRefresh = window.utils.debounce(refresh, 400);
        cleanup.push(window.realtime.on('fields:change', debouncedRefresh));
      }

      refresh();
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages.fields = page;
})();
