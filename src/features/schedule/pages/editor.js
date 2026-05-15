// أيام وفترات العمل — محرر الجدول. للمالك فقط.
// تحديث 2026: تبويبات الأرضيات بـ chip-rail، بطاقات أيام محدّثة، رؤوس فترات بـ chips،
// زر "نسخ إلى أيام أخرى" لكل يوم، modal أنظف للفترة + مع معاينات.

(function () {
  const TEMPLATE = `
    <div class="page-header">
      <div>
        <h2>أيام وفترات العمل</h2>
        <div class="page-subtitle">أوقات افتتاح كل أرضية، مدة الموعد، وسعر الساعة</div>
      </div>
    </div>
    <div id="schedule-container">
      <div class="loader-center"><div class="loader loader--lg"></div></div>
    </div>
  `;

  const DAYS = [
    { dow: 6, name: 'السبت' },
    { dow: 0, name: 'الأحد' },
    { dow: 1, name: 'الاثنين' },
    { dow: 2, name: 'الثلاثاء' },
    { dow: 3, name: 'الأربعاء' },
    { dow: 4, name: 'الخميس' },
    { dow: 5, name: 'الجمعة' }
  ];

  const DURATION_OPTS = [30, 45, 60, 75, 90, 105, 120, 150, 180];

  function formatDuration(mins) {
    const m = Number(mins) || 60;
    if (m % 60 === 0) return `${m / 60} ساعة`;
    if (m < 60) return `${m} دقيقة`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return `${h} ساعة و ${r} دقيقة`;
  }

  function previewDuration(open, close) {
    if (!open || !close || open === close) return '';
    const [oh, om] = open.split(':').map(Number);
    const [ch, cm] = close.split(':').map(Number);
    const startMins = oh * 60 + om;
    let endMins = ch * 60 + cm;
    const isOvernight = endMins <= startMins;
    if (isOvernight) endMins += 24 * 60;
    const totalMins = endMins - startMins;
    const hours = Math.floor(totalMins / 60);
    const mins  = totalMins % 60;
    let durationLabel;
    if (mins === 0) durationLabel = `${hours} ساعة`;
    else if (hours === 0) durationLabel = `${mins} دقيقة`;
    else durationLabel = `${hours} ساعة و ${mins} دقيقة`;
    const closeFormatted = window.utils.formatTimeOfDay(close);
    const suffix = isOvernight
      ? `<strong>تنتهي ${closeFormatted} اليوم التالي</strong>`
      : 'في اليوم نفسه';
    const kind = isOvernight ? 'warning' : 'success';
    return `
      <div class="schedule-preview schedule-preview--${kind}">
        <i data-lucide="${isOvernight ? 'moon' : 'clock'}"></i>
        <div>المدة: <strong>${durationLabel}</strong> — ${suffix}</div>
      </div>
    `;
  }

  function previewSlots(open, close, durationMins) {
    if (!open || !close || open === close || !durationMins) return '';
    const [oh, om] = open.split(':').map(Number);
    const [ch, cm] = close.split(':').map(Number);
    const startMins = oh * 60 + om;
    let endMins = ch * 60 + cm;
    if (endMins <= startMins) endMins += 24 * 60;
    const totalMins = endMins - startMins;
    const slotCount = Math.floor(totalMins / durationMins);
    if (slotCount <= 0) {
      return `
        <div class="schedule-preview schedule-preview--danger">
          <i data-lucide="triangle-alert"></i>
          <div>مدة الفترة أقصر من مدة الموعد — لن تُنشأ أي مواعيد</div>
        </div>
      `;
    }
    const fmt = (mins) => {
      const h = Math.floor(mins / 60) % 24;
      const m = mins % 60;
      return window.utils.formatTimeOfDay(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    };
    const firstStart = startMins;
    const firstEnd   = firstStart + durationMins;
    const lastStart  = startMins + (slotCount - 1) * durationMins;
    const lastEnd    = lastStart + durationMins;
    const slotWord = slotCount === 1 ? 'موعد' : (slotCount === 2 ? 'موعدان' : (slotCount <= 10 ? 'مواعيد' : 'موعداً'));
    return `
      <div class="schedule-preview schedule-preview--accent">
        <i data-lucide="calendar-check"></i>
        <div>
          سيتم إنشاء <strong>${slotCount}</strong> ${slotWord}
          <div class="text-xs" style="margin-top:2px;opacity:0.85">
            ${slotCount === 1 ? '' : 'أول:'} <strong>${fmt(firstStart)} → ${fmt(firstEnd)}</strong>
            ${slotCount > 1 ? `  ·  آخر: <strong>${fmt(lastStart)} → ${fmt(lastEnd)}</strong>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  function toMinuteRange(p) {
    const [oh, om] = p.open.split(':').map(Number);
    const [ch, cm] = p.close.split(':').map(Number);
    const start = oh * 60 + om;
    let end = ch * 60 + cm;
    if (end <= start) end += 24 * 60;
    return [start, end];
  }
  function rangesOverlap(a, b) { return a[0] < b[1] && b[0] < a[1]; }
  function detectOverlap(periods) {
    const ranges = periods.map((p) => toMinuteRange(p));
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        if (rangesOverlap(ranges[i], ranges[j])) return periods[j];
      }
    }
    return null;
  }

  const page = {
    async mount(container, ctx) {
      container.innerHTML = TEMPLATE;
      const isOwner = ctx.profile.role === 'owner';
      const scheduleContainer = container.querySelector('#schedule-container');
      const fieldsHref = window.utils.path('/fields');

      let fields = [];
      let selectedFieldId = null;
      let periodsByDay = {};
      let alive = true;
      const cleanup = [];
      page._cleanup = cleanup;
      cleanup.push(() => { alive = false; });

      function attachDurationPreview(form, previewEl) {
        const openEl = form.querySelector('[name="open"]');
        const closeEl = form.querySelector('[name="close"]');
        const update = () => {
          previewEl.innerHTML = previewDuration(openEl.value, closeEl.value);
          window.utils.renderIcons(previewEl);
        };
        openEl.addEventListener('input', update);
        closeEl.addEventListener('input', update);
        update();
      }

      function attachSlotsPreview(form, previewEl) {
        const openEl  = form.querySelector('[name="open"]');
        const closeEl = form.querySelector('[name="close"]');
        const durEl   = form.querySelector('[name="duration"]');
        const update = () => {
          const dur = parseInt(durEl.value, 10) || 0;
          previewEl.innerHTML = previewSlots(openEl.value, closeEl.value, dur);
          window.utils.renderIcons(previewEl);
        };
        openEl.addEventListener('input', update);
        closeEl.addEventListener('input', update);
        durEl.addEventListener('change', update);
        update();
      }

      async function loadPeriodsForField() {
        periodsByDay = {};
        DAYS.forEach((d) => { periodsByDay[d.dow] = []; });
        if (!selectedFieldId) return;
        const rows = await window.api.listWorkingPeriods(selectedFieldId);
        rows.forEach((r) => {
          const open  = (r.open_time  || '').substring(0, 5);
          const close = (r.close_time || '').substring(0, 5);
          periodsByDay[r.day_of_week].push({
            open, close,
            duration: Number(r.slot_duration_minutes) || 60,
            price:    Number(r.hourly_price) || 0
          });
        });
        Object.keys(periodsByDay).forEach((dow) => {
          periodsByDay[dow].sort((a, b) => a.open.localeCompare(b.open));
        });
      }

      async function init() {
        if (!alive) return;
        scheduleContainer.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
        try {
          fields = window.store ? await window.store.get('fields:all') : await window.api.listFields(true);
          if (!alive) return;
          if (!fields.length) {
            scheduleContainer.innerHTML = `
              <div class="card">
                <div class="empty-state">
                  <div class="empty-icon"><i data-lucide="goal"></i></div>
                  <h3>لا توجد أرضيات بعد</h3>
                  <p>أضف أرضية واحدة على الأقل قبل ضبط أوقات العمل.</p>
                  <a href="${fieldsHref}" class="btn btn--primary"><i data-lucide="plus"></i> إضافة أرضية</a>
                </div>
              </div>
            `;
            window.utils.renderIcons(scheduleContainer);
            return;
          }
          selectedFieldId = fields[0].id;
          await loadPeriodsForField();
          if (!alive) return;
          render();
        } catch (err) {
          if (!alive) return;
          scheduleContainer.innerHTML = `
            <div class="card">
              <div class="empty-state">
                <div class="empty-icon"><i data-lucide="triangle-alert"></i></div>
                <p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p>
              </div>
            </div>
          `;
          window.utils.renderIcons(scheduleContainer);
        }
      }

      function render() {
        const selectedField = fields.find((f) => f.id === selectedFieldId) || fields[0];

        // إحصاء سريع للجدول الحالي
        const totalPeriods = Object.values(periodsByDay).reduce((sum, arr) => sum + arr.length, 0);
        const openDays = Object.values(periodsByDay).filter((arr) => arr.length).length;

        scheduleContainer.innerHTML = `
          <!-- شريط اختيار الأرضية -->
          <div class="chip-rail mb-md" id="field-tabs">
            ${fields.map((f) => `
              <button class="chip ${f.id === selectedFieldId ? 'is-active' : ''}" data-field-id="${f.id}">
                <i data-lucide="goal" style="width:12px;height:12px"></i>
                <span>${window.utils.escapeHtml(f.name)}</span>
                ${!f.is_active ? '<span class="text-tertiary text-xs">معطّلة</span>' : ''}
              </button>
            `).join('')}
          </div>

          <!-- ملخص الأرضية المختارة + أفعال -->
          <div class="card mb-md">
            <div class="card-body" style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);flex-wrap:wrap">
              <div>
                <div class="fw-semibold" style="font-size:var(--text-lg)">${window.utils.escapeHtml(selectedField.name)}</div>
                <div class="text-muted text-xs">${openDays} أيام مفتوحة · ${totalPeriods} ${totalPeriods === 1 ? 'فترة' : 'فترات'} إجمالاً</div>
              </div>
              ${isOwner ? `
                <button class="btn btn--primary" id="add-period-btn">
                  <i data-lucide="plus"></i> إضافة فترة لعدة أيام
                </button>
              ` : ''}
            </div>
          </div>

          <!-- شبكة الأيام -->
          <div id="days-grid" class="days-grid"></div>
        `;

        // تبديل الأرضية بالنقر على chip
        scheduleContainer.querySelectorAll('#field-tabs [data-field-id]').forEach((chip) => {
          chip.addEventListener('click', async () => {
            selectedFieldId = chip.dataset.fieldId;
            scheduleContainer.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
            try {
              await loadPeriodsForField();
              if (!alive) return;
              render();
            } catch (err) {
              window.utils.toast(window.utils.formatError(err), 'error');
            }
          });
        });

        if (isOwner) {
          scheduleContainer.querySelector('#add-period-btn').addEventListener('click', openMultiDayPeriodModal);
        }

        const grid = scheduleContainer.querySelector('#days-grid');
        DAYS.forEach((day) => grid.appendChild(buildDayCard(day)));
        window.utils.renderIcons(scheduleContainer);
      }

      function buildDayCard(day) {
        const card = document.createElement('div');
        card.className = 'card day-card';
        const periods = periodsByDay[day.dow] || [];
        const isOpen = periods.length > 0;

        card.innerHTML = `
          <div class="card-header">
            <div style="display:flex;align-items:center;gap:var(--space-2)">
              <span class="day-card-name">${day.name}</span>
              ${isOpen
                ? `<span class="chip-status chip-status--success">${periods.length} ${periods.length === 1 ? 'فترة' : 'فترات'}</span>`
                : `<span class="chip-status chip-status--muted">مغلق</span>`}
            </div>
            ${isOwner ? `
              <div class="flex-row" style="gap:var(--space-1)">
                ${isOpen ? `
                  <button class="btn btn--xs btn--ghost" data-act="copy" title="نسخ الفترات إلى أيام أخرى">
                    <i data-lucide="copy"></i>
                  </button>
                ` : ''}
                <button class="btn btn--xs btn--accent-quiet" data-act="add" title="إضافة فترة">
                  <i data-lucide="plus"></i>
                  <span>فترة</span>
                </button>
              </div>
            ` : ''}
          </div>
          <div class="card-body day-card-body" data-periods-body>
            ${renderPeriodsList(periods, day.dow)}
          </div>
        `;
        if (isOwner) {
          card.querySelector('[data-act="add"]').addEventListener('click', () => openPeriodEditor(day, null));
          const copyBtn = card.querySelector('[data-act="copy"]');
          if (copyBtn) copyBtn.addEventListener('click', () => openCopyDayModal(day));
          attachPeriodActions(card, day);
        }
        return card;
      }

      function renderPeriodsList(periods, dow) {
        if (!periods.length) {
          return `
            <div class="day-empty">
              <i data-lucide="moon-star"></i>
              <span>مغلق — لا توجد فترات حجز</span>
            </div>
          `;
        }
        return `
          <div class="period-list">
            ${periods.map((p, idx) => {
              const overnight = p.close <= p.open;
              return `
                <div class="period-row">
                  <div class="period-row-main">
                    <div class="period-row-time">
                      <i data-lucide="clock"></i>
                      <span>${window.utils.formatTimeOfDay(p.open)} → ${window.utils.formatTimeOfDay(p.close)}</span>
                      ${overnight ? '<span class="chip-status chip-status--warning" style="margin-inline-start:auto"><i data-lucide="moon" style="width:10px;height:10px"></i> اليوم التالي</span>' : ''}
                    </div>
                    <div class="period-row-meta">
                      <span><i data-lucide="timer"></i> ${formatDuration(p.duration)}</span>
                      <span><i data-lucide="banknote"></i> ${window.utils.formatCurrency(p.price)}<span class="text-tertiary">/س</span></span>
                    </div>
                  </div>
                  ${isOwner ? `
                    <div class="actions-inline" style="opacity:1">
                      <button class="btn btn--xs btn--ghost" data-act="edit" data-dow="${dow}" data-idx="${idx}" title="تعديل">
                        <i data-lucide="pencil"></i>
                      </button>
                      <button class="btn btn--xs btn--danger-quiet" data-act="delete" data-dow="${dow}" data-idx="${idx}" title="حذف">
                        <i data-lucide="trash-2"></i>
                      </button>
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('')}
          </div>
        `;
      }

      function attachPeriodActions(card, day) {
        card.querySelectorAll('[data-act="edit"]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx, 10);
            const period = (periodsByDay[day.dow] || [])[idx];
            if (period) openPeriodEditor(day, { ...period, idx });
          });
        });
        card.querySelectorAll('[data-act="delete"]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const idx = parseInt(btn.dataset.idx, 10);
            const period = (periodsByDay[day.dow] || [])[idx];
            if (!period) return;
            const ok = await window.utils.confirm({
              title: 'حذف فترة',
              message: `حذف ${window.utils.formatTimeOfDay(period.open)} → ${window.utils.formatTimeOfDay(period.close)} من ${day.name}؟`,
              confirmText: 'حذف',
              danger: true
            });
            if (!ok) return;
            const newPeriods = (periodsByDay[day.dow] || []).filter((_, i) => i !== idx);
            await saveDayPeriods(day, newPeriods);
          });
        });
      }

      function openPeriodEditor(day, existing) {
        const editing = existing && existing.idx !== undefined;
        const currentDuration = existing ? Number(existing.duration) : 60;
        const currentPrice = existing ? Number(existing.price) : 0;
        const formHtml = `
          <form id="period-form" autocomplete="off">
            <div class="form-row cols-2">
              <div class="form-group">
                <label class="form-label">من الساعة <span class="required">*</span></label>
                <input type="time" class="form-control" name="open" required value="${existing ? existing.open : ''}">
              </div>
              <div class="form-group">
                <label class="form-label">إلى الساعة <span class="required">*</span></label>
                <input type="time" class="form-control" name="close" required value="${existing ? existing.close : ''}">
              </div>
            </div>
            <div id="single-duration-preview"></div>
            <div class="form-row cols-2">
              <div class="form-group">
                <label class="form-label">مدة الموعد <span class="required">*</span></label>
                <select class="form-control" name="duration" required>
                  ${DURATION_OPTS.map((m) => `<option value="${m}" ${m === currentDuration ? 'selected' : ''}>${formatDuration(m)}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">سعر الساعة <span class="required">*</span></label>
                <div class="input-group">
                  <input type="number" min="0" step="0.01" class="form-control" name="price" required value="${currentPrice}">
                  <span class="input-addon">ر.س</span>
                </div>
              </div>
            </div>
            <div id="single-slots-preview"></div>
          </form>
        `;
        const footer = `
          <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
          <button type="submit" class="btn btn--primary" form="period-form">${editing ? 'حفظ' : 'إضافة'}</button>
        `;
        const ctrl = window.utils.openModal({
          title: editing ? `تعديل فترة — ${day.name}` : `إضافة فترة — ${day.name}`,
          body: formHtml,
          footer
        });
        ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
        const periodForm = ctrl.modal.querySelector('#period-form');
        attachDurationPreview(periodForm, ctrl.modal.querySelector('#single-duration-preview'));
        attachSlotsPreview(periodForm, ctrl.modal.querySelector('#single-slots-preview'));
        periodForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const open  = fd.get('open');
          const close = fd.get('close');
          const duration = parseInt(fd.get('duration'), 10) || 60;
          const price = parseFloat(fd.get('price')) || 0;
          if (!open || !close || open === close) {
            window.utils.toast('أدخل ساعتين مختلفتين', 'error');
            return;
          }
          let newPeriods = [...(periodsByDay[day.dow] || [])];
          const newPeriod = { open, close, duration, price };
          if (editing) newPeriods[existing.idx] = newPeriod;
          else newPeriods.push(newPeriod);
          const conflict = detectOverlap(newPeriods);
          if (conflict) {
            window.utils.toast(`الفترة تتداخل مع: ${window.utils.formatTimeOfDay(conflict.open)} → ${window.utils.formatTimeOfDay(conflict.close)}`, 'error');
            return;
          }
          ctrl.close();
          await saveDayPeriods(day, newPeriods);
        });
      }

      function openMultiDayPeriodModal() {
        const fieldName = fields.find((f) => f.id === selectedFieldId).name;
        const formHtml = `
          <form id="multi-period-form" autocomplete="off">
            <p class="text-muted text-sm mb-md">إضافة فترة عمل لـ <strong class="text-accent">${window.utils.escapeHtml(fieldName)}</strong></p>
            <div class="form-row cols-2">
              <div class="form-group">
                <label class="form-label">من الساعة <span class="required">*</span></label>
                <input type="time" class="form-control" name="open" required>
              </div>
              <div class="form-group">
                <label class="form-label">إلى الساعة <span class="required">*</span></label>
                <input type="time" class="form-control" name="close" required>
              </div>
            </div>
            <div id="multi-duration-preview"></div>
            <div class="form-row cols-2">
              <div class="form-group">
                <label class="form-label">مدة الموعد <span class="required">*</span></label>
                <select class="form-control" name="duration" required>
                  ${DURATION_OPTS.map((m) => `<option value="${m}" ${m === 60 ? 'selected' : ''}>${formatDuration(m)}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">سعر الساعة <span class="required">*</span></label>
                <div class="input-group">
                  <input type="number" min="0" step="0.01" class="form-control" name="price" required value="0">
                  <span class="input-addon">ر.س</span>
                </div>
              </div>
            </div>
            <div id="multi-slots-preview"></div>
            <div class="form-group">
              <label class="form-label">الأيام المستهدفة</label>
              <div class="schedule-mode-picker">
                <label class="form-check">
                  <input type="radio" name="mode" value="all" checked>
                  <span>كل أيام الأسبوع</span>
                </label>
                <label class="form-check">
                  <input type="radio" name="mode" value="custom">
                  <span>أيام محددة</span>
                </label>
              </div>
            </div>
            <div id="days-picker" class="schedule-days-picker hidden">
              ${DAYS.map((d) => `
                <label class="form-check">
                  <input type="checkbox" name="day_${d.dow}" value="${d.dow}">
                  <span>${d.name}</span>
                </label>
              `).join('')}
            </div>
          </form>
        `;
        const footer = `
          <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
          <button type="submit" class="btn btn--primary" form="multi-period-form">إضافة</button>
        `;
        const ctrl = window.utils.openModal({ title: 'إضافة فترة لعدة أيام', body: formHtml, footer });
        const form = ctrl.modal.querySelector('#multi-period-form');
        const daysPicker = ctrl.modal.querySelector('#days-picker');
        attachDurationPreview(form, ctrl.modal.querySelector('#multi-duration-preview'));
        attachSlotsPreview(form, ctrl.modal.querySelector('#multi-slots-preview'));
        form.querySelectorAll('input[name="mode"]').forEach((radio) => {
          radio.addEventListener('change', () => {
            if (form.mode.value === 'custom') daysPicker.classList.remove('hidden');
            else daysPicker.classList.add('hidden');
          });
        });
        ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(form);
          const open  = fd.get('open');
          const close = fd.get('close');
          const duration = parseInt(fd.get('duration'), 10) || 60;
          const price = parseFloat(fd.get('price')) || 0;
          if (!open || !close || open === close) {
            window.utils.toast('أدخل ساعتين مختلفتين', 'error');
            return;
          }
          let targetDows;
          if (fd.get('mode') === 'all') {
            targetDows = DAYS.map((d) => d.dow);
          } else {
            targetDows = DAYS.map((d) => d.dow).filter((dow) => fd.get(`day_${dow}`));
            if (!targetDows.length) {
              window.utils.toast('اختر يوماً واحداً على الأقل', 'error');
              return;
            }
          }
          const newPeriod = { open, close, duration, price };
          const conflicts = [];
          const newPeriodsByDay = {};
          for (const dow of targetDows) {
            const existing = periodsByDay[dow] || [];
            const merged = [...existing, newPeriod];
            const conflict = detectOverlap(merged);
            if (conflict) {
              conflicts.push(DAYS.find((d) => d.dow === dow).name);
            } else {
              newPeriodsByDay[dow] = merged.slice().sort((a, b) => a.open.localeCompare(b.open));
            }
          }
          if (conflicts.length === targetDows.length) {
            window.utils.toast(`الفترة تتداخل في كل الأيام (${conflicts.join('، ')})`, 'error');
            return;
          }
          if (conflicts.length) {
            const ok = await window.utils.confirm({
              title: 'تداخل في بعض الأيام',
              message: `الأيام التالية فيها تداخل وسيتم تخطّيها: ${conflicts.join('، ')}. المتابعة لباقي الأيام؟`,
              confirmText: 'متابعة'
            });
            if (!ok) return;
          }
          ctrl.close();
          const savedDows = Object.keys(newPeriodsByDay).map(Number);
          try {
            for (const dow of savedDows) {
              await window.api.setDayPeriods(selectedFieldId, dow, newPeriodsByDay[dow]);
              periodsByDay[dow] = newPeriodsByDay[dow];
            }
            window.utils.toast(`تمت الإضافة على ${savedDows.length} ${savedDows.length === 1 ? 'يوم' : 'أيام'}`, 'success');
            render();
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
            await loadPeriodsForField();
            render();
          }
        });
      }

      function openCopyDayModal(sourceDay) {
        const sourcePeriods = periodsByDay[sourceDay.dow] || [];
        if (!sourcePeriods.length) return;
        const formHtml = `
          <p class="text-muted text-sm mb-md">انسخ فترات <strong class="text-accent">${sourceDay.name}</strong> (${sourcePeriods.length} ${sourcePeriods.length === 1 ? 'فترة' : 'فترات'}) إلى:</p>
          <div class="schedule-days-picker">
            ${DAYS.filter((d) => d.dow !== sourceDay.dow).map((d) => `
              <label class="form-check">
                <input type="checkbox" name="day_${d.dow}" value="${d.dow}">
                <span>${d.name}</span>
              </label>
            `).join('')}
          </div>
          <p class="form-help mt-md">سيتم استبدال أي فترات موجودة في الأيام المختارة بفترات ${sourceDay.name}.</p>
        `;
        const footer = `
          <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
          <button type="button" class="btn btn--primary" id="copy-confirm">نسخ</button>
        `;
        const ctrl = window.utils.openModal({ title: `نسخ فترات ${sourceDay.name}`, body: formHtml, footer });
        ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
        ctrl.modal.querySelector('#copy-confirm').addEventListener('click', async () => {
          const targetDows = DAYS.filter((d) => d.dow !== sourceDay.dow)
            .map((d) => d.dow)
            .filter((dow) => ctrl.modal.querySelector(`input[name="day_${dow}"]`).checked);
          if (!targetDows.length) {
            window.utils.toast('اختر يوماً واحداً على الأقل', 'error');
            return;
          }
          ctrl.close();
          try {
            for (const dow of targetDows) {
              const copy = sourcePeriods.map((p) => ({ ...p }));
              await window.api.setDayPeriods(selectedFieldId, dow, copy);
              periodsByDay[dow] = copy.slice().sort((a, b) => a.open.localeCompare(b.open));
            }
            window.utils.toast(`تم النسخ إلى ${targetDows.length} ${targetDows.length === 1 ? 'يوم' : 'أيام'}`, 'success');
            render();
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
            await loadPeriodsForField();
            render();
          }
        });
      }

      async function saveDayPeriods(day, periods) {
        try {
          await window.api.setDayPeriods(selectedFieldId, day.dow, periods);
          periodsByDay[day.dow] = periods.slice().sort((a, b) => a.open.localeCompare(b.open));
          window.utils.toast(`تم حفظ فترات ${day.name}`, 'success');
          render();
        } catch (err) {
          window.utils.toast(window.utils.formatError(err), 'error');
        }
      }

      if (window.realtime) {
        const debouncedInit = window.utils.debounce(init, 400);
        cleanup.push(window.realtime.on('fields:change', debouncedInit));
      }

      init();
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages.schedule = page;
})();
