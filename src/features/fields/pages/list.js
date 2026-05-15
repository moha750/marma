// الأرضيات — جدول مع أفعال inline تظهر على hover + status chip + link لـ schedule
(function () {
  const TEMPLATE = `
    <div class="page-header">
      <div>
        <h2>الأرضيات</h2>
        <div class="page-subtitle">أرضيات الملعب القابلة للحجز</div>
      </div>
      <div class="actions">
        <a href="${window.utils.path('/schedule')}" class="btn btn--secondary">
          <i data-lucide="clock"></i> أيام وفترات العمل
        </a>
        <button class="btn btn--primary" id="add-field-btn">
          <i data-lucide="plus"></i> إضافة أرضية
        </button>
      </div>
    </div>
    <div id="fields-container">
      <div class="loader-center"><div class="loader loader--lg"></div></div>
    </div>
  `;

  function statusChip(active) {
    return active
      ? '<span class="chip-status chip-status--success">نشطة</span>'
      : '<span class="chip-status chip-status--muted">معطّلة</span>';
  }

  const page = {
    async mount(container, ctx) {
      container.innerHTML = TEMPLATE;
      window.utils.renderIcons(container);

      const isOwner = ctx.profile.role === 'owner';
      const listContainer = container.querySelector('#fields-container');
      const addBtn = container.querySelector('#add-field-btn');
      if (!isOwner) addBtn.style.display = 'none';

      const allowedFields = (ctx.status && ctx.status.allowed_fields) || 1;

      function applyLimitToAddBtn(currentCount) {
        if (!isOwner) return;
        const atLimit = currentCount >= allowedFields;
        addBtn.disabled = atLimit;
        addBtn.title = atLimit ? 'بلغت حد الأرضيات. ارفع الباقة من صفحة الاشتراك.' : '';
      }

      let alive = true;
      const cleanup = [];
      page._cleanup = cleanup;

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
          const fields = await window.api.listFields(true);
          if (!alive) return;

          const active = fields.filter((f) => f.is_active).length;
          applyLimitToAddBtn(active);
          const atLimit = isOwner && active >= allowedFields;
          const limitBanner = atLimit ? `
            <div class="trial-banner trial-banner--soon" style="margin-bottom: var(--space-4); border-radius: var(--radius-md)">
              <span class="trial-banner-icon"><i data-lucide="info"></i></span>
              <span>بلغت حد الأرضيات (${active}/${allowedFields}).</span>
              <a class="trial-banner-cta" href="${window.utils.path('/subscription')}">ارفع الباقة</a>
            </div>
          ` : '';

          if (!fields.length) {
            listContainer.innerHTML = `
              ${limitBanner}
              <div class="card">
                <div class="empty-state">
                  <div class="empty-icon"><i data-lucide="goal"></i></div>
                  <h3>لا توجد أرضيات بعد</h3>
                  <p>${isOwner ? 'ابدأ بإضافة أول أرضية لملعبك. ستظهر فوراً في صفحة الحجز العامة.' : 'لم يقم المالك بإضافة أرضيات بعد.'}</p>
                  ${isOwner ? '<button class="btn btn--primary" id="empty-add">+ إضافة أرضية</button>' : ''}
                </div>
              </div>
            `;
            window.utils.renderIcons(listContainer);
            const ea = listContainer.querySelector('#empty-add');
            if (ea) ea.addEventListener('click', () => openFieldModal(null));
            return;
          }

          listContainer.innerHTML = `
            ${limitBanner}
            <div class="stats-grid mb-md">
              <div class="stat-card">
                <div class="stat-card-head">
                  <span class="stat-icon-chip"><i data-lucide="goal"></i></span>
                  <span class="stat-label">الأرضيات النشطة</span>
                </div>
                <div class="stat-value tabular-nums">${active} <span class="text-tertiary" style="font-size:var(--text-lg)">/ ${allowedFields}</span></div>
                <div class="stat-sub">${fields.length} إجمالي · ${fields.length - active} معطّلة</div>
              </div>
            </div>

            <div class="table-wrapper">
              <table class="table">
                <thead>
                  <tr>
                    <th>اسم الأرضية</th>
                    <th>الحالة</th>
                    ${isOwner ? '<th class="actions-cell"></th>' : ''}
                  </tr>
                </thead>
                <tbody>
                  ${fields.map((f) => `
                    <tr data-status="${f.is_active ? 'confirmed' : 'completed'}" data-id="${f.id}">
                      <td class="fw-semibold">${window.utils.escapeHtml(f.name)}</td>
                      <td>${statusChip(f.is_active)}</td>
                      ${isOwner ? `
                        <td class="actions-cell">
                          <div class="actions-inline">
                            <button class="btn btn--xs btn--ghost" data-action="edit" data-id="${f.id}" title="تعديل">
                              <i data-lucide="pencil"></i>
                            </button>
                            <button class="btn btn--xs btn--ghost" data-action="toggle" data-id="${f.id}" title="${f.is_active ? 'تعطيل' : 'تفعيل'}">
                              <i data-lucide="${f.is_active ? 'eye-off' : 'eye'}"></i>
                            </button>
                            <button class="btn btn--xs btn--danger-quiet" data-action="delete" data-id="${f.id}" title="حذف">
                              <i data-lucide="trash-2"></i>
                            </button>
                          </div>
                        </td>
                      ` : ''}
                    </tr>
                  `).join('')}
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
                  message: `هل أنت متأكد من حذف "${field.name}"؟ لا يمكن الحذف إذا كان عليها حجوزات.`,
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
          listContainer.innerHTML = `
            <div class="card">
              <div class="empty-state">
                <div class="empty-icon"><i data-lucide="triangle-alert"></i></div>
                <p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p>
              </div>
            </div>
          `;
          window.utils.renderIcons(listContainer);
        }
      }

      function openFieldModal(field) {
        const editing = !!field;
        const formHtml = `
          <form id="field-form" autocomplete="off">
            <div class="form-group">
              <label class="form-label" for="name">اسم الأرضية <span class="required">*</span></label>
              <input type="text" class="form-control" id="name" name="name" required
                     value="${editing ? window.utils.escapeHtml(field.name) : ''}"
                     placeholder="مثلاً: الملعب رقم 1">
              <span class="form-help">مدة الموعد والسعر يُضبطان من <a href="${window.utils.path('/schedule')}">صفحة أيام وفترات العمل</a>.</span>
            </div>
          </form>
        `;
        const footer = `
          <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
          <button type="submit" class="btn btn--primary" form="field-form">${editing ? 'حفظ' : 'إضافة'}</button>
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
        const debounced = window.utils.debounce(refresh, 400);
        cleanup.push(window.realtime.on('fields:change', debounced));
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
