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
                <div class="stat-value tabular-nums">${active} <span class="text-tertiary" style="font-size:var(--text-lg)">/ ${allowedFields}</span></div>
                <div class="stat-sub">${fields.length} إجمالي · ${fields.length - active} معطّلة</div>
              </div>
            </div>

            <div class="table-wrapper">
              <table class="table">
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
                  ${fields.map((f) => `
                    <tr data-status="${f.is_active ? 'confirmed' : 'completed'}" data-id="${f.id}">
                      <td class="fw-semibold">
                        ${(f.image_urls && f.image_urls[0])
                          ? `<img src="${window.utils.escapeHtml(f.image_urls[0])}" class="field-list-thumb" alt="">`
                          : ''}
                        ${window.utils.escapeHtml(f.name)}
                      </td>
                      <td>${window.utils.escapeHtml(f.city || '—')}</td>
                      <td class="tabular-nums">${window.utils.escapeHtml(f.phone || '—')}</td>
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
            </div>
            <div class="form-row cols-2">
              <div class="form-group">
                <label class="form-label" for="city">المدينة <span class="required">*</span></label>
                <input type="text" class="form-control" id="city" name="city" required
                       value="${editing ? window.utils.escapeHtml(field.city || '') : ''}"
                       placeholder="مثلاً: الأحساء، الهفوف">
              </div>
              <div class="form-group">
                <label class="form-label" for="phone">رقم الجوال <span class="required">*</span></label>
                <input type="tel" class="form-control" id="phone" name="phone" required
                       value="${editing ? window.utils.escapeHtml(field.phone || '') : ''}"
                       placeholder="05XXXXXXXX">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label" for="location_url">رابط الموقع على الخرائط</label>
              <input type="url" class="form-control" id="location_url" name="location_url"
                     value="${editing ? window.utils.escapeHtml(field.location_url || '') : ''}"
                     placeholder="https://maps.app.goo.gl/...">
              <span class="form-help">افتح Google Maps → مشاركة → انسخ الرابط هنا. سيظهر للعملاء كزر "افتح في الخرائط".</span>
              <div id="location_url_status" class="form-help" hidden></div>
            </div>
            <div class="form-group">
              <label class="form-label" for="field-description">وصف الأرضية</label>
              <textarea class="form-control" id="field-description" name="description" rows="3" maxlength="600"
                        placeholder="ما يميّز هذه الأرضية؟ (نوع العشب، الإضاءة، الخدمات...)">${editing ? window.utils.escapeHtml(field.description || '') : ''}</textarea>
              <span class="form-help">يظهر في صفحة الأرضية. حد أقصى 600 حرف.</span>
            </div>
            <div class="form-row cols-2">
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
                <div class="bp-amenity-chips" id="amenity-chips">
                  ${Object.entries(window.utils.AMENITY_LABELS).map(([k, v]) => {
                    const active = editing && Array.isArray(field.amenities) && field.amenities.includes(k);
                    return `<button type="button" class="bp-amenity-chip${active ? ' is-active' : ''}" data-key="${k}">${v}</button>`;
                  }).join('')}
                </div>
                <span class="form-help">اضغط لإضافة/إزالة الميزة. حد أقصى 12.</span>
              </div>
            </div>
            ${editing ? `
            <div class="form-group">
              <label class="form-label">
                صور الأرضية
                <span class="form-help-inline" id="field-gallery-counter"></span>
              </label>
              <div class="field-gallery" id="field-gallery"></div>
              <span class="form-help">الصورة الأولى تظهر كغلاف. تُحفظ التغييرات فوراً — JPG/PNG/WebP، حد 5 ميجابايت لكل صورة.</span>
            </div>
            ` : `
            <div class="form-group">
              <label class="form-label">صور الأرضية</label>
              <div class="form-help">احفظ المعلومات الأساسية أولاً، ثم ستظهر شاشة إضافة الصور تلقائياً.</div>
            </div>
            `}
            <span class="form-help">مدة الموعد والسعر يُضبطان من <a href="${window.utils.path('/schedule')}">صفحة أيام وفترات العمل</a>.</span>
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
        const form = ctrl.modal.querySelector('#field-form');
        window.utils.bindPhoneInput(form.phone);
        ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);

        // إحداثيات الموقع: محفوظة بعد resolve ناجح للرابط (أو من الصف عند التعديل)
        let resolvedCoords = (editing && field.latitude != null && field.longitude != null)
          ? { lat: Number(field.latitude), lng: Number(field.longitude) }
          : null;
        let lastResolvedUrl = (editing && resolvedCoords) ? (field.location_url || '') : '';
        const statusEl = ctrl.modal.querySelector('#location_url_status');
        const setStatus = (text, kind) => {
          if (!text) { statusEl.hidden = true; statusEl.textContent = ''; statusEl.removeAttribute('style'); return; }
          statusEl.hidden = false;
          statusEl.textContent = text;
          const color = kind === 'success' ? 'var(--success, #16a34a)'
                       : kind === 'error'   ? 'var(--danger,  #dc2626)'
                       : '';
          statusEl.style.color = color;
        };

        const urlInput = ctrl.modal.querySelector('#location_url');
        let resolveSeq = 0;
        const resolveUrl = async () => {
          const url = (urlInput.value || '').trim();
          if (!url) {
            resolvedCoords = null;
            lastResolvedUrl = '';
            setStatus('', null);
            return;
          }
          if (!/^https?:\/\//i.test(url)) {
            resolvedCoords = null;
            setStatus('رابط الموقع يجب أن يبدأ بـ https://', 'error');
            return;
          }
          if (url === lastResolvedUrl && resolvedCoords) {
            return; // لم يتغير الرابط منذ آخر resolve ناجح
          }
          const mySeq = ++resolveSeq;
          resolvedCoords = null;
          setStatus('جاري التحقق من الموقع...', null);
          try {
            const { data, error } = await window.sb.functions.invoke('resolve-maps-url', { body: { url } });
            if (mySeq !== resolveSeq) return; // أُلغي بطلب أحدث
            if (error) throw error;
            if (data && typeof data.latitude === 'number' && typeof data.longitude === 'number') {
              resolvedCoords = { lat: data.latitude, lng: data.longitude };
              lastResolvedUrl = url;
              setStatus('✓ تم تثبيت الموقع', 'success');
            } else {
              setStatus('تعذّر قراءة هذا الرابط. افتح Google Maps → مشاركة → نسخ الرابط، ثم ألصقه هنا.', 'error');
            }
          } catch (err) {
            if (mySeq !== resolveSeq) return;
            setStatus('تعذّر قراءة هذا الرابط. افتح Google Maps → مشاركة → نسخ الرابط، ثم ألصقه هنا.', 'error');
          }
        };
        urlInput.addEventListener('blur', resolveUrl);
        // أظهر الحالة الابتدائية عند تعديل أرضية محفوظة بإحداثيات
        if (editing && resolvedCoords && field.location_url) {
          setStatus('✓ تم تثبيت الموقع', 'success');
        }

        // ── معرض الصور (وضع التعديل فقط) ───────────────────────────
        const galleryEl = ctrl.modal.querySelector('#field-gallery');
        const counterEl = ctrl.modal.querySelector('#field-gallery-counter');
        let galleryUrls = editing ? window.api.listFieldImages(field) : [];
        let galleryBusy = false;
        const MAX_IMG = window.api.MAX_IMAGES_PER_FIELD || 8;

        function renderGallery() {
          if (!galleryEl) return;
          const items = galleryUrls.map((url, i) => `
            <div class="field-gallery__item${i === 0 ? ' field-gallery__item--cover' : ''}" data-url="${window.utils.escapeHtml(url)}" data-index="${i}">
              <img src="${window.utils.escapeHtml(url)}" alt="" loading="lazy">
              ${i === 0 ? '<span class="field-gallery__cover-badge">غلاف</span>' : ''}
              <div class="field-gallery__actions">
                <button type="button" class="field-gallery__btn" data-action="move-prev" ${i === 0 ? 'disabled' : ''} title="تقديم">
                  <i data-lucide="arrow-up"></i>
                </button>
                <button type="button" class="field-gallery__btn" data-action="move-next" ${i === galleryUrls.length - 1 ? 'disabled' : ''} title="تأخير">
                  <i data-lucide="arrow-down"></i>
                </button>
                <button type="button" class="field-gallery__btn field-gallery__btn--danger" data-action="remove" title="حذف">
                  <i data-lucide="trash-2"></i>
                </button>
              </div>
            </div>
          `).join('');
          const addBtn = galleryUrls.length < MAX_IMG ? `
            <label class="field-gallery__add">
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden data-role="add-image">
              <i data-lucide="plus"></i>
              <span>إضافة صورة</span>
            </label>
          ` : '';
          galleryEl.innerHTML = items + addBtn;
          if (counterEl) counterEl.textContent = `(${galleryUrls.length} / ${MAX_IMG})`;
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

        if (editing) {
          renderGallery();

          galleryEl.addEventListener('change', (e) => {
            const input = e.target.closest('input[data-role="add-image"]');
            if (!input) return;
            const file = input.files && input.files[0];
            input.value = '';
            if (!file) return;
            withBusy(async () => {
              const next = await window.api.addFieldImage(field.id, file);
              galleryUrls = next;
              renderGallery();
              invalidateFieldsCache();
            });
          });

          galleryEl.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const itemEl = btn.closest('.field-gallery__item');
            if (!itemEl) return;
            const index = Number(itemEl.dataset.index);
            const url = itemEl.dataset.url;
            const action = btn.dataset.action;

            if (action === 'remove') {
              withBusy(async () => {
                const next = await window.api.removeFieldImage(field.id, url);
                galleryUrls = next;
                renderGallery();
                invalidateFieldsCache();
              });
              return;
            }
            if (action === 'move-prev' && index > 0) {
              const next = galleryUrls.slice();
              [next[index - 1], next[index]] = [next[index], next[index - 1]];
              withBusy(async () => {
                const saved = await window.api.reorderFieldImages(field.id, next);
                galleryUrls = saved;
                renderGallery();
                invalidateFieldsCache();
              });
              return;
            }
            if (action === 'move-next' && index < galleryUrls.length - 1) {
              const next = galleryUrls.slice();
              [next[index + 1], next[index]] = [next[index], next[index + 1]];
              withBusy(async () => {
                const saved = await window.api.reorderFieldImages(field.id, next);
                galleryUrls = saved;
                renderGallery();
                invalidateFieldsCache();
              });
              return;
            }
          });
        }

        // ── تفعيل/إلغاء chips المزايا مع حد 12 ────────────
        const amenityChipsEl = ctrl.modal.querySelector('#amenity-chips');
        if (amenityChipsEl) {
          amenityChipsEl.addEventListener('click', (e) => {
            const btn = e.target.closest('.bp-amenity-chip');
            if (!btn) return;
            const isActive = btn.classList.contains('is-active');
            if (!isActive) {
              const count = amenityChipsEl.querySelectorAll('.is-active').length;
              if (count >= 12) {
                window.utils.toast('الحد الأقصى 12 ميزة', 'warning');
                return;
              }
            }
            btn.classList.toggle('is-active');
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
          const locationUrl = (fd.get('location_url') || '').trim();
          if (locationUrl && !/^https?:\/\//i.test(locationUrl)) {
            window.utils.toast('رابط الموقع يجب أن يبدأ بـ https://', 'error');
            urlInput.focus();
            return;
          }
          // إن غيّر المستخدم الرابط ولم يحدث blur (مثلاً ضغط حفظ مباشرة)، شغّل resolve أولاً
          if (locationUrl && (locationUrl !== lastResolvedUrl || !resolvedCoords)) {
            await resolveUrl();
          }
          if (locationUrl && !resolvedCoords) {
            window.utils.toast('تحقق من رابط الموقع أولاً', 'error');
            urlInput.focus();
            return;
          }
          const amenities = amenityChipsEl
            ? Array.from(amenityChipsEl.querySelectorAll('.bp-amenity-chip.is-active')).map((el) => el.dataset.key)
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
          const submitBtn = ctrl.modal.querySelector('button[type="submit"]');
          const origSubmitText = submitBtn.textContent;
          submitBtn.disabled = true;
          submitBtn.textContent = 'جاري الحفظ...';
          try {
            if (editing) {
              await window.api.updateField(field.id, payload);
              window.utils.toast('تم تحديث الأرضية', 'success');
              invalidateFieldsCache();
              ctrl.close();
              refresh();
            } else {
              const saved = await window.api.createField(payload);
              window.utils.toast('تمت إضافة الأرضية. أضف صور الأرضية الآن.', 'success');
              try { sessionStorage.removeItem('marma:onboarding:pending'); } catch (_) {}
              invalidateFieldsCache();
              ctrl.close();
              refresh();
              // افتح modal التعديل تلقائياً لتمكين رفع الصور
              openFieldModal(saved);
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
