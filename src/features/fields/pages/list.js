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

      const isLifetime = !!(ctx.status && ctx.status.lifetime);
      const allowedFields = isLifetime
        ? Infinity
        : ((ctx.status && ctx.status.allowed_fields) || 1);

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
            let isOnboardingPending = false;
            try { isOnboardingPending = sessionStorage.getItem('marma:onboarding:pending') === '1'; } catch (_) {}
            const isOnboarding = isOwner && (window.utils.getQueryParam('onboarding') === '1' || isOnboardingPending);
            listContainer.innerHTML = `
              ${limitBanner}
              <div class="card">
                <div class="empty-state">
                  <div class="empty-icon"><i data-lucide="goal"></i></div>
                  <h3>${isOnboarding ? 'مرحباً! خطوة أخيرة لتفعيل الحجز' : 'لا توجد أرضيات بعد'}</h3>
                  <p>${isOwner
                      ? (isOnboarding
                          ? 'أضف ملعبك الأول مع مدينته ورقم جواله. بعدها ستحصل على رابط حجز عام جاهز للمشاركة.'
                          : 'ابدأ بإضافة أول أرضية لملعبك. ستظهر فوراً في صفحة الحجز العامة.')
                      : 'لم يقم المالك بإضافة أرضيات بعد.'}</p>
                  ${isOwner ? `<button class="btn btn--primary" id="empty-add">+ ${isOnboarding ? 'أضف الملعب الأول' : 'إضافة أرضية'}</button>` : ''}
                </div>
              </div>
            `;
            window.utils.renderIcons(listContainer);
            const ea = listContainer.querySelector('#empty-add');
            if (ea) ea.addEventListener('click', () => openFieldModal(null));
            if (isOnboarding) {
              // افتح المودال تلقائياً للمالك الذي بدأ للتو
              openFieldModal(null);
              // نظّف الـ flag من URL حتى لا يتكرر عند التحديث
              try {
                const url = new URL(window.location.href);
                url.searchParams.delete('onboarding');
                history.replaceState(null, '', url.toString());
              } catch (_) {}
            }
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
                <div class="stat-value tabular-nums">${active} <span class="text-tertiary" style="font-size:var(--text-lg)">/ ${isLifetime ? '∞' : allowedFields}</span></div>
                <div class="stat-sub">${fields.length} إجمالي · ${fields.length - active} معطّلة</div>
              </div>
            </div>

            <div class="table-wrapper">
              <table class="table table--cards">
                <thead>
                  <tr>
                    <th>اسم الأرضية</th>
                    <th>المدينة</th>
                    <th>الجوال</th>
                    <th>الحالة</th>
                    ${isOwner ? '<th class="actions-cell"></th>' : ''}
                  </tr>
                </thead>
                <tbody>
                  ${fields.map((f, i) => `
                    <tr data-status="${f.is_active ? 'confirmed' : 'completed'}" data-id="${f.id}">
                      <td data-label="اسم الأرضية" class="fw-semibold">
                        <span class="row-rank tabular-nums" title="الترتيب">${i + 1}</span>
                        ${(f.image_urls && f.image_urls[0])
                          ? `<img src="${window.utils.escapeHtml(f.image_urls[0])}" class="field-list-thumb" alt="">`
                          : ''}
                        ${window.utils.escapeHtml(f.name)}
                      </td>
                      <td data-label="المدينة">${window.utils.escapeHtml(f.city || '—')}</td>
                      <td data-label="الجوال" class="tabular-nums">${window.utils.escapeHtml(f.phone || '—')}</td>
                      <td data-label="الحالة" class="card-tag">${statusChip(f.is_active)}</td>
                      ${isOwner ? `
                        <td class="actions-cell">
                          <div class="actions-inline">
                            <button class="btn btn--xs btn--ghost drag-handle" data-action="drag" data-id="${f.id}" title="اسحب لإعادة الترتيب" aria-label="اسحب لإعادة الترتيب">
                              <i data-lucide="grip-vertical"></i>
                            </button>
                            <button class="btn btn--xs btn--ghost" data-action="move-up" data-id="${f.id}" title="تحريك لأعلى" ${i === 0 ? 'disabled' : ''}>
                              <i data-lucide="arrow-up"></i><span>أعلى</span>
                            </button>
                            <button class="btn btn--xs btn--ghost" data-action="move-down" data-id="${f.id}" title="تحريك لأسفل" ${i === fields.length - 1 ? 'disabled' : ''}>
                              <i data-lucide="arrow-down"></i><span>أسفل</span>
                            </button>
                            <button class="btn btn--xs btn--ghost" data-action="edit" data-id="${f.id}" title="تعديل">
                              <i data-lucide="pencil"></i><span>تعديل</span>
                            </button>
                            <button class="btn btn--xs btn--ghost" data-action="toggle" data-id="${f.id}" title="${f.is_active ? 'تعطيل' : 'تفعيل'}">
                              <i data-lucide="${f.is_active ? 'eye-off' : 'eye'}"></i><span>${f.is_active ? 'تعطيل' : 'تفعيل'}</span>
                            </button>
                            <button class="btn btn--xs btn--danger-quiet" data-action="delete" data-id="${f.id}" title="حذف">
                              <i data-lucide="trash-2"></i><span>حذف</span>
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
            let reordering = false;
            // يحفظ ترتيباً جديداً (مصفوفة أرضيات مُعاد ترتيبها) ويعيد التحميل.
            async function persistOrder(reordered) {
              if (reordering) return;
              // لا تحفظ إن لم يتغيّر شيء فعلياً
              if (reordered.every((f, i) => f.id === fields[i].id)) return;
              reordering = true;
              listContainer.querySelectorAll('[data-action="move-up"],[data-action="move-down"],[data-action="drag"]')
                .forEach((b) => { b.disabled = true; });
              try {
                await window.api.reorderFields(reordered.map((f) => f.id));
                invalidateFieldsCache();
                refresh();
              } catch (err) {
                window.utils.toast(window.utils.formatError(err), 'error');
                reordering = false;
                refresh();
              }
            }

            // أزرار الأسهم (تعمل على اللمس أيضاً)
            function moveField(id, dir) {
              const from = fields.findIndex((f) => f.id === id);
              const to = from + dir;
              if (from < 0 || to < 0 || to >= fields.length) return;
              const reordered = fields.slice();
              [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
              persistOrder(reordered);
            }
            listContainer.querySelectorAll('[data-action="move-up"]').forEach((btn) => {
              btn.addEventListener('click', () => moveField(btn.dataset.id, -1));
            });
            listContainer.querySelectorAll('[data-action="move-down"]').forEach((btn) => {
              btn.addEventListener('click', () => moveField(btn.dataset.id, 1));
            });

            // ── سحب مخصّص سلس (pointer): يرفع العنصر بظلّ ويتبع المؤشّر،
            //     وتنزلق بقية العناصر بنعومة (FLIP) لتفسح له المكان. يبدأ من
            //     المقبض فقط حتى لا يتعارض مع نقر بقية الأزرار. ──
            const tbody = listContainer.querySelector('tbody');
            if (tbody) {
              let drag = null;

              function startDrag(e) {
                if (reordering || drag) return;
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                const handle = e.target.closest('[data-action="drag"]');
                if (!handle) return;
                const row = handle.closest('tr[data-id]');
                if (!row) return;
                e.preventDefault();
                const rect = row.getBoundingClientRect();

                // شريحة تحجز مكان العنصر أثناء رفعه
                const ph = document.createElement('tr');
                ph.className = 'sortable-placeholder';
                ph.style.height = rect.height + 'px';
                row.after(ph);

                // ارفع الصف نفسه (يبقى ضمن سياق as-cards فيحافظ على شكل الكرت)
                row.classList.add('sortable-dragging');
                Object.assign(row.style, {
                  position: 'fixed', margin: '0', zIndex: '1000', pointerEvents: 'none',
                  width: rect.width + 'px', left: rect.left + 'px', top: rect.top + 'px',
                });

                drag = { row, ph, grabY: e.clientY - rect.top, left: rect.left, lastBefore: ph.nextElementSibling };
                document.body.classList.add('sortable-active');
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', endDrag, { once: true });
                window.addEventListener('pointercancel', endDrag, { once: true });
              }

              function onMove(e) {
                if (!drag) return;
                drag.row.style.top = (e.clientY - drag.grabY) + 'px';
                drag.row.style.left = drag.left + 'px';
                // الصف الذي يجب وضع الشريحة قبله (حسب منتصف كل صف)
                const rows = [...tbody.querySelectorAll('tr[data-id]')].filter((r) => r !== drag.row);
                let before = null;
                for (const r of rows) {
                  const rc = r.getBoundingClientRect();
                  if (e.clientY < rc.top + rc.height / 2) { before = r; break; }
                }
                if (before === drag.lastBefore) return; // لم يتغيّر الموضع
                drag.lastBefore = before;
                flipMove(before);
              }

              // FLIP: سجّل المواضع → أعد الترتيب → حرّك من القديم إلى الجديد بنعومة
              function flipMove(before) {
                const movers = [...tbody.children].filter((c) => c !== drag.row);
                const firsts = new Map(movers.map((r) => [r, r.getBoundingClientRect().top]));
                if (before) tbody.insertBefore(drag.ph, before); else tbody.appendChild(drag.ph);
                for (const r of movers) {
                  const dy = firsts.get(r) - r.getBoundingClientRect().top;
                  if (!dy) continue;
                  r.style.transition = 'none';
                  r.style.transform = `translateY(${dy}px)`;
                  void r.offsetHeight; // أجبر reflow قبل الانتقال
                  requestAnimationFrame(() => {
                    r.style.transition = 'transform .18s var(--ease-out, ease)';
                    r.style.transform = '';
                  });
                }
              }

              function endDrag() {
                if (!drag) return;
                const { row, ph } = drag;
                window.removeEventListener('pointermove', onMove);
                document.body.classList.remove('sortable-active');
                ph.replaceWith(row);                 // أعد الصف لمكان الشريحة
                row.classList.remove('sortable-dragging');
                row.style.cssText = '';
                [...tbody.children].forEach((r) => { r.style.transition = ''; r.style.transform = ''; });
                const order = [...tbody.querySelectorAll('tr[data-id]')].map((r) => r.dataset.id);
                drag = null;
                const reordered = order.map((id) => fields.find((f) => f.id === id)).filter(Boolean);
                persistOrder(reordered);
              }

              tbody.addEventListener('pointerdown', startDrag);
            }

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
            </div>
            <div class="form-row cols-2">
              <div class="form-group">
                <label class="form-label" for="city">المدينة <span class="required">*</span></label>
                <input type="text" class="form-control" id="city" name="city" required
                       value="${editing ? window.utils.escapeHtml(field.city || '') : ''}"
                       placeholder="مثلاً: الأحساء">
              </div>
              <div class="form-group">
                <label class="form-label" for="phone">رقم الجوال <span class="required">*</span></label>
                <input type="tel" class="form-control" id="phone" name="phone" required
                       value="${editing ? window.utils.escapeHtml(field.phone || '') : ''}"
                       placeholder="05XXXXXXXX">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">موقع الملعب على الخريطة</label>
              <div id="location-picker"></div>
              <span class="form-help">ابحث باسم ملعبك أو انقر على موقعه في الخريطة، واسحب الدبوس لضبطه. يظهر للعميل كخريطة وزر "افتح في الخرائط". (اختياري)</span>
            </div>
            <div class="form-group">
              <label class="form-label" for="field-description">وصف الأرضية</label>
              <textarea class="form-control" id="field-description" name="description" rows="3" maxlength="600"
                        placeholder="ما يميّز هذه الأرضية؟ (نوع العشب، الإضاءة، الخدمات...)">${editing ? window.utils.escapeHtml(field.description || '') : ''}</textarea>
              <span class="form-help">يظهر في صفحة الأرضية. حد أقصى 600 حرف.</span>
            </div>
            <div class="form-group">
              <label class="form-label" for="surface_type">نوع الأرضية</label>
              <select class="form-control" id="surface_type" name="surface_type">
                <option value="">— غير محدد —</option>
                ${Object.entries(window.utils.SURFACE_LABELS).map(([k, v]) => `
                  <option value="${k}" ${editing && field.surface_type === k ? 'selected' : ''}>${v}</option>
                `).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">المزايا</label>
              <div class="amenity-grid" id="amenity-chips">
                ${Object.entries(window.utils.AMENITY_LABELS).map(([k, v]) => {
                  const active = editing && Array.isArray(field.amenities) && field.amenities.includes(k);
                  const icon = window.utils.AMENITY_ICONS[k] || 'check';
                  return `<button type="button" class="amenity-chip${active ? ' is-active' : ''}" data-key="${k}"><i data-lucide="${icon}"></i><span>${v}</span></button>`;
                }).join('')}
                ${(editing && Array.isArray(field.amenities) ? field.amenities.filter((a) => !window.utils.AMENITY_LABELS[a]) : []).map((txt) => {
                  const safe = window.utils.escapeHtml(txt);
                  return `<span class="amenity-chip amenity-chip--custom is-active" data-custom="${safe}"><i data-lucide="sparkles"></i><span>${safe}</span><button type="button" class="amenity-chip__remove" data-action="remove-custom" aria-label="إزالة"><i data-lucide="x"></i></button></span>`;
                }).join('')}
              </div>
              <div class="amenity-add">
                <input type="text" class="form-control" id="amenity-custom-input" maxlength="24" placeholder="ميزة أخرى؟ اكتبها هنا">
                <button type="button" class="btn btn--secondary btn--sm" id="amenity-custom-add"><i data-lucide="plus"></i> إضافة</button>
              </div>
              <span class="form-help">اضغط لتفعيل/إلغاء ميزة، أو أضف ميزة خاصة بملعبك.</span>
            </div>
            <div class="form-group">
              <label class="form-label">
                صور الأرضية
                <span class="form-help-inline" id="field-gallery-counter"></span>
              </label>
              <div class="field-gallery" id="field-gallery"></div>
              <span class="form-help">${editing
                ? 'الصورة الأولى تظهر كغلاف. تُحفظ التغييرات فوراً — JPG/PNG/WebP، حد 5 ميجابايت لكل صورة.'
                : 'الصورة الأولى تظهر كغلاف'}</span>
            </div>
            <span class="form-help">مدة الموعد والسعر يُضبطان من <a href="${window.utils.path('/schedule')}">صفحة أيام وفترات العمل</a>.</span>
          </form>
        `;
        const footer = `
          <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
          <button type="submit" class="btn btn--primary" form="field-form">${editing ? 'حفظ' : 'إضافة'}</button>
        `;
        const objectUrls = [];   // معاينات الصور المجهّزة — تُحرَّر عند إغلاق النافذة
        const ctrl = window.utils.openModal({
          title: editing ? 'تعديل أرضية' : 'إضافة أرضية',
          body: formHtml,
          footer,
          onClose: () => objectUrls.forEach((u) => URL.revokeObjectURL(u))
        });
        const form = ctrl.modal.querySelector('#field-form');
        window.utils.bindPhoneInput(form.phone);
        ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);

        // إحداثيات موقع الأرضية — تُحدَّد عبر خريطة قوقل (بحث بالاسم + دبوس قابل للسحب).
        // اختيارية تمامًا: غيابها لا يمنع الحفظ.
        let resolvedCoords = (editing && field.latitude != null && field.longitude != null)
          ? { lat: Number(field.latitude), lng: Number(field.longitude) }
          : null;
        let locPicker = null;
        const pickerHost = ctrl.modal.querySelector('#location-picker');
        if (pickerHost && window.locationPicker) {
          window.locationPicker.create(pickerHost, {
            lat: resolvedCoords ? resolvedCoords.lat : undefined,
            lng: resolvedCoords ? resolvedCoords.lng : undefined,
            city: editing ? (field.city || '') : '',
            onChange: (c) => { resolvedCoords = c; }
          }).then((p) => { locPicker = p; }).catch(() => {});
        }

        // ── معرض الصور: تعديل = حفظ فوري، إضافة = تجهيز محلي يُرفع عند الحفظ ──
        const galleryEl = ctrl.modal.querySelector('#field-gallery');
        const counterEl = ctrl.modal.querySelector('#field-gallery-counter');
        const MAX_IMG = window.api.MAX_IMAGES_PER_FIELD || 8;
        let galleryBusy = false;
        // كل عنصر: { url } للمحفوظة (تعديل) أو { url, file } للمجهّزة (إضافة)
        let galleryItems = editing
          ? window.api.listFieldImages(field).map((u) => ({ url: u }))
          : [];

        function renderGallery() {
          if (!galleryEl) return;
          const items = galleryItems.map((it, i) => `
            <div class="field-gallery__item${i === 0 ? ' field-gallery__item--cover' : ''}" data-url="${window.utils.escapeHtml(it.url)}" data-index="${i}">
              <img src="${window.utils.escapeHtml(it.url)}" alt="" loading="lazy">
              ${i === 0 ? '<span class="field-gallery__cover-badge">غلاف</span>' : ''}
              <div class="field-gallery__actions">
                <button type="button" class="field-gallery__btn" data-action="move-prev" ${i === 0 ? 'disabled' : ''} title="تقديم">
                  <i data-lucide="arrow-up"></i>
                </button>
                <button type="button" class="field-gallery__btn" data-action="move-next" ${i === galleryItems.length - 1 ? 'disabled' : ''} title="تأخير">
                  <i data-lucide="arrow-down"></i>
                </button>
                <button type="button" class="field-gallery__btn field-gallery__btn--danger" data-action="remove" title="حذف">
                  <i data-lucide="trash-2"></i>
                </button>
              </div>
            </div>
          `).join('');
          const addBtn = galleryItems.length < MAX_IMG ? `
            <label class="field-gallery__add">
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden data-role="add-image">
              <i data-lucide="plus"></i>
              <span>إضافة صورة</span>
            </label>
          ` : '';
          galleryEl.innerHTML = items + addBtn;
          if (counterEl) counterEl.textContent = `(${galleryItems.length} / ${MAX_IMG})`;
          window.utils.renderIcons(galleryEl);
        }

        async function withBusy(fn) {
          if (galleryBusy) return;
          galleryBusy = true;
          galleryEl.dataset.busy = '1';
          try { await fn(); }
          catch (err) { window.utils.toast(window.utils.formatError(err), 'error'); }
          finally {
            galleryBusy = false;
            delete galleryEl.dataset.busy;
          }
        }

        // تحقّق مبدئي للملف المجهّز (يُعاد التحقق عند الرفع الفعلي بعد الإنشاء)
        function validateStagedImage(file) {
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            window.utils.toast('الصيغة غير مدعومة (JPG/PNG/WebP)', 'error');
            return false;
          }
          if (file.size > 5 * 1024 * 1024) {
            window.utils.toast('حجم الصورة يتجاوز 5 ميجابايت', 'error');
            return false;
          }
          return true;
        }

        if (galleryEl) {
          renderGallery();

          galleryEl.addEventListener('change', (e) => {
            const input = e.target.closest('input[data-role="add-image"]');
            if (!input) return;
            const file = input.files && input.files[0];
            input.value = '';
            if (!file) return;
            if (editing) {
              withBusy(async () => {
                const next = await window.api.addFieldImage(field.id, file);
                galleryItems = next.map((u) => ({ url: u }));
                renderGallery();
                invalidateFieldsCache();
              });
            } else {
              // إضافة: تجهيز محلي (معاينة فورية، يُرفع عند الحفظ)
              if (!validateStagedImage(file)) return;
              if (galleryItems.length >= MAX_IMG) {
                window.utils.toast(`الحد الأقصى ${MAX_IMG} صور`, 'warning');
                return;
              }
              const url = URL.createObjectURL(file);
              objectUrls.push(url);
              galleryItems.push({ url, file });
              renderGallery();
            }
          });

          galleryEl.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const itemEl = btn.closest('.field-gallery__item');
            if (!itemEl) return;
            const index = Number(itemEl.dataset.index);
            const action = btn.dataset.action;

            if (action === 'remove') {
              if (editing) {
                const url = itemEl.dataset.url;
                withBusy(async () => {
                  const next = await window.api.removeFieldImage(field.id, url);
                  galleryItems = next.map((u) => ({ url: u }));
                  renderGallery();
                  invalidateFieldsCache();
                });
              } else {
                const [removed] = galleryItems.splice(index, 1);
                if (removed && removed.url.startsWith('blob:')) URL.revokeObjectURL(removed.url);
                renderGallery();
              }
              return;
            }

            const movable = (action === 'move-prev' && index > 0)
              || (action === 'move-next' && index < galleryItems.length - 1);
            if (!movable) return;
            const j = action === 'move-prev' ? index - 1 : index + 1;
            if (editing) {
              const urls = galleryItems.map((it) => it.url);
              [urls[j], urls[index]] = [urls[index], urls[j]];
              withBusy(async () => {
                const saved = await window.api.reorderFieldImages(field.id, urls);
                galleryItems = saved.map((u) => ({ url: u }));
                renderGallery();
                invalidateFieldsCache();
              });
            } else {
              [galleryItems[j], galleryItems[index]] = [galleryItems[index], galleryItems[j]];
              renderGallery();
            }
          });
        }

        // ── تفعيل/إلغاء chips المزايا مع حد 12 ────────────
        const amenityChipsEl = ctrl.modal.querySelector('#amenity-chips');
        if (amenityChipsEl) {
          amenityChipsEl.addEventListener('click', (e) => {
            const removeBtn = e.target.closest('[data-action="remove-custom"]');
            if (removeBtn) {
              const chip = removeBtn.closest('.amenity-chip--custom');
              if (chip) chip.remove();
              return;
            }
            const btn = e.target.closest('.amenity-chip');
            if (!btn || btn.classList.contains('amenity-chip--custom')) return; // المخصّصة لا تُبدَّل
            btn.classList.toggle('is-active');
          });

          // إضافة ميزة مخصّصة (نص حرّ) بضوابط: قصّ، منع تكرار، سقف 6 (الطول يحدّه maxlength)
          const customInput = ctrl.modal.querySelector('#amenity-custom-input');
          const customAddBtn = ctrl.modal.querySelector('#amenity-custom-add');
          const addCustomAmenity = () => {
            const val = (customInput.value || '').trim().replace(/\s+/g, ' ');
            if (!val) return;
            const norm = (s) => s.toLocaleLowerCase('ar');
            const labelValues = Object.values(window.utils.AMENITY_LABELS).map(norm);
            const customs = Array.from(amenityChipsEl.querySelectorAll('.amenity-chip--custom'))
              .map((el) => el.dataset.custom);
            if (labelValues.includes(norm(val)) || customs.map(norm).includes(norm(val))) {
              window.utils.toast('هذه الميزة موجودة بالفعل', 'warning');
              return;
            }
            const chip = document.createElement('span');
            chip.className = 'amenity-chip amenity-chip--custom is-active';
            chip.dataset.custom = val;
            chip.innerHTML = '<i data-lucide="sparkles"></i><span></span>'
              + '<button type="button" class="amenity-chip__remove" data-action="remove-custom" aria-label="إزالة"><i data-lucide="x"></i></button>';
            chip.querySelector('span').textContent = val; // آمن من XSS
            amenityChipsEl.appendChild(chip);
            window.utils.renderIcons(chip);
            customInput.value = '';
            customInput.focus();
          };
          if (customAddBtn) customAddBtn.addEventListener('click', addCustomAmenity);
          if (customInput) customInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); addCustomAmenity(); }
          });
        }

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const cityValue = (fd.get('city') || '').trim();
          const phoneValue = (fd.get('phone') || '').trim();
          if (!cityValue) {
            window.utils.toast('المدينة مطلوبة', 'error');
            form.city.focus();
            return;
          }
          if (!window.utils.isValidSaudiPhone(phoneValue)) {
            window.utils.toast('رقم الجوال يجب أن يبدأ بـ 05 ويتكون من 10 أرقام', 'error');
            form.phone.focus();
            return;
          }
          // موقع الأرضية اختياري: إن حُدِّد على الخريطة نبني رابطًا من الإحداثيات
          // (لزر "افتح في الخرائط" لدى العميل) — وإلا نتركه فارغًا. لا شيء يوقف الحفظ.
          const locationUrl = resolvedCoords
            ? `https://www.google.com/maps?q=${resolvedCoords.lat},${resolvedCoords.lng}`
            : '';
          const amenities = amenityChipsEl
            ? Array.from(amenityChipsEl.querySelectorAll('.amenity-chip.is-active'))
                .map((el) => el.dataset.key || el.dataset.custom)
                .filter(Boolean)
            : [];
          const payload = {
            name: fd.get('name'),
            city: cityValue,
            phone: phoneValue,
            location_url: locationUrl,
            latitude:  resolvedCoords ? resolvedCoords.lat : null,
            longitude: resolvedCoords ? resolvedCoords.lng : null,
            description: (fd.get('description') || '').trim() || null,
            surface_type: (fd.get('surface_type') || '').trim() || null,
            amenities
          };
          const stagedFiles = editing ? [] : galleryItems.filter((it) => it.file).map((it) => it.file);
          const submitBtn = ctrl.modal.querySelector('button[type="submit"]');
          const origSubmitText = submitBtn.textContent;
          submitBtn.disabled = true;
          submitBtn.textContent = stagedFiles.length ? 'جارٍ الحفظ ورفع الصور...' : 'جارٍ الحفظ...';
          try {
            if (editing) {
              await window.api.updateField(field.id, payload);
              window.utils.toast('تم تحديث الأرضية', 'success');
              invalidateFieldsCache();
              ctrl.close();
              refresh();
            } else {
              const saved = await window.api.createField(payload);
              // ارفع الصور المجهّزة بالترتيب (الأولى = الغلاف)
              let failed = 0;
              for (const file of stagedFiles) {
                try { await window.api.addFieldImage(saved.id, file); }
                catch (_) { failed++; }
              }
              try { sessionStorage.removeItem('marma:onboarding:pending'); } catch (_) {}
              invalidateFieldsCache();
              ctrl.close();
              refresh();
              if (failed > 0) {
                window.utils.toast(`تمت إضافة الأرضية، لكن تعذّر رفع ${failed} صورة — أضفها من التعديل`, 'warning');
              } else {
                window.utils.toast('تمت إضافة الأرضية', 'success');
              }
            }
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
          } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = origSubmitText;
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
