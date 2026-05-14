// صفحة أيام وفترات العمل - module pattern (SPA + legacy)
// كل أرضية لها فتراتها الخاصة. للمالك فقط.

(function () {
  const TEMPLATE = `
    <div class="page-header">
      <h2>أيام وفترات العمل</h2>
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
    const mins = totalMins % 60;
    let durationLabel;
    if (mins === 0) durationLabel = `${hours} ساعة`;
    else if (hours === 0) durationLabel = `${mins} دقيقة`;
    else durationLabel = `${hours} ساعة و ${mins} دقيقة`;
    const closeFormatted = window.utils.formatTimeOfDay(close);
    const suffix = isOvernight
      ? `<strong>تنتهي ${closeFormatted} في اليوم التالي</strong>`
      : 'في اليوم نفسه';
    return `<div style="background:${isOvernight ? 'var(--color-warning-light)' : 'var(--color-primary-light)'};color:${isOvernight ? 'var(--color-warning)' : 'var(--color-primary-dark)'};padding:10px 14px;border-radius:var(--radius);font-weight:500;margin-bottom:16px">⏱ المدة: <strong>${durationLabel}</strong> — ${suffix}</div>`;
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
      return `<div style="background:var(--color-danger-light);color:var(--color-danger);padding:10px 14px;border-radius:var(--radius);margin-bottom:16px;font-weight:500;display:flex;align-items:center;gap:8px"><i data-lucide="triangle-alert"></i> مدة الفترة أقصر من مدة الموعد - لن تُنشأ أي مواعيد</div>`;
    }
    const fmt = (mins) => {
      const h = Math.floor(mins / 60) % 24;
      const m = mins % 60;
      return window.utils.formatTimeOfDay(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    };
    const firstStart = startMins;
    const firstEnd = firstStart + durationMins;
    const lastStart = startMins + (slotCount - 1) * durationMins;
    const lastEnd = lastStart + durationMins;
    const slotWord = slotCount === 1 ? 'موعد' : (slotCount === 2 ? 'موعدان' : (slotCount <= 10 ? 'مواعيد' : 'موعداً'));
    return `<div style="background:var(--color-success-light);color:var(--color-primary-dark);padding:10px 14px;border-radius:var(--radius);margin-bottom:16px;font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <i data-lucide="calendar-days"></i> <span>سيتم إنشاء <strong>${slotCount}</strong> ${slotWord} في هذه الفترة</span>
      <div style="font-size:0.85rem;margin-top:4px;opacity:0.85;font-weight:normal">
        ${slotCount === 1 ? '' : 'أول موعد:'} <strong>${fmt(firstStart)} → ${fmt(firstEnd)}</strong>${slotCount > 1 ? ` &nbsp;·&nbsp; آخر موعد: <strong>${fmt(lastStart)} → ${fmt(lastEnd)}</strong>` : ''}
      </div>
    </div>`;
  }

  function toMinuteRange(p) {
    const [oh, om] = p.open.split(':').map(Number);
    const [ch, cm] = p.close.split(':').map(Number);
    const start = oh * 60 + om;
    let end = ch * 60 + cm;
    if (end <= start) end += 24 * 60;
    return [start, end];
  }

  function rangesOverlap(a, b) {
    return a[0] < b[1] && b[0] < a[1];
  }

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
      const fieldsHref = '/fields';

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
        const update = () => { previewEl.innerHTML = previewDuration(openEl.value, closeEl.value); window.utils.renderIcons(previewEl); };
        openEl.addEventListener('input', update);
        closeEl.addEventListener('input', update);
        update();
      }

      function attachSlotsPreview(form, previewEl) {
        const openEl = form.querySelector('[name="open"]');
        const closeEl = form.querySelector('[name="close"]');
        const durationEl = form.querySelector('[name="duration"]');
        const update = () => {
          const dur = parseInt(durationEl.value, 10) || 0;
          previewEl.innerHTML = previewSlots(openEl.value, closeEl.value, dur);
          window.utils.renderIcons(previewEl);
        };
        openEl.addEventListener('input', update);
        closeEl.addEventListener('input', update);
        durationEl.addEventListener('change', update);
        update();
      }

      async function loadPeriodsForField() {
        periodsByDay = {};
        DAYS.forEach((d) => { periodsByDay[d.dow] = []; });
        if (!selectedFieldId) return;
        const rows = await window.api.listWorkingPeriods(selectedFieldId);
        rows.forEach((r) => {
          const open = (r.open_time || '').substring(0, 5);
          const close = (r.close_time || '').substring(0, 5);
          periodsByDay[r.day_of_week].push({
            open,
            close,
            duration: Number(r.slot_duration_minutes) || 60,
            price: Number(r.hourly_price) || 0
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
          fields = window.store
            ? await window.store.get('fields:all')
            : await window.api.listFields(true);
          if (!alive) return;
          if (!fields.length) {
            scheduleContainer.innerHTML = `
              <div class="card">
                <div class="empty-state">
                  <div class="icon"><i data-lucide="goal"></i></div>
                  <h3>لا توجد أرضيات بعد</h3>
                  <p>أضف أرضية واحدة على الأقل من <a href="${fieldsHref}">صفحة الأرضيات</a> قبل ضبط أوقات العمل.</p>
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
          scheduleContainer.innerHTML = `<div class="card"><div class="empty-state"><p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p></div></div>`;
        }
      }

      function render() {
        const selectedField = fields.find((f) => f.id === selectedFieldId) || fields[0];

        scheduleContainer.innerHTML = `
          <div class="card mb-md">
            <div class="card-body">
              <div class="form-group" style="margin:0">
                <label class="form-label">اختر الأرضية</label>
                <select class="form-control" id="field-selector">
                  ${fields.map((f) => `<option value="${f.id}" ${f.id === selectedFieldId ? 'selected' : ''}>${window.utils.escapeHtml(f.name)}${!f.is_active ? ' (معطّلة)' : ''}</option>`).join('')}
                </select>
                <span class="form-help">لكل أرضية فتراتها وأسعارها الخاصة. اختر أرضية لإدارة جدولها.</span>
              </div>
            </div>
          </div>

          <div class="card mb-md">
            <div class="card-body" style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
              <div style="flex:1;min-width:240px">
                <div style="font-weight:700;font-size:1.05rem">${window.utils.escapeHtml(selectedField.name)}</div>
                <div class="text-muted" style="font-size:0.9rem;margin-top:4px">أضف فترات العمل وحدد المدة والسعر لكل فترة.</div>
              </div>
              ${isOwner ? '<button class="btn btn--primary" id="add-period-btn">+ إضافة فترة</button>' : ''}
            </div>
          </div>

          <div id="days-grid" style="display:flex;flex-direction:column;gap:16px"></div>
        `;

        scheduleContainer.querySelector('#field-selector').addEventListener('change', async (e) => {
          selectedFieldId = e.target.value;
          scheduleContainer.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
          try {
            await loadPeriodsForField();
            if (!alive) return;
            render();
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
          }
        });

        if (isOwner) {
          scheduleContainer.querySelector('#add-period-btn').addEventListener('click', () => {
            openMultiDayPeriodModal();
          });
        }

        const grid = scheduleContainer.querySelector('#days-grid');
        DAYS.forEach((day) => {
          grid.appendChild(buildDayCard(day));
        });
        window.utils.renderIcons(scheduleContainer);
      }

      function buildDayCard(day) {
        const card = document.createElement('div');
        card.className = 'card';
        const periods = periodsByDay[day.dow] || [];
        card.innerHTML = `
          <div class="card-header">
            <span>${day.name}</span>
            ${isOwner ? '<button class="btn btn--primary btn--sm" data-act="add">+ إضافة فترة</button>' : ''}
          </div>
          <div class="card-body" data-periods-body>
            ${renderPeriodsList(periods, day.dow)}
          </div>
        `;
        if (isOwner) {
          card.querySelector('[data-act="add"]').addEventListener('click', () => openPeriodEditor(day, null));
          attachPeriodActions(card, day);
        }
        return card;
      }

      function renderPeriodsList(periods, dow) {
        if (!periods.length) {
          return `
            <div class="text-muted text-center" style="padding:12px;background:var(--color-bg);border-radius:var(--radius)">
              ⛔ مغلق - لا توجد فترات حجز لهذا اليوم
            </div>
          `;
        }
        return `
          <div style="display:flex;flex-direction:column;gap:8px">
            ${periods.map((p, idx) => `
              <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 14px;background:var(--color-primary-light);border-radius:var(--radius);color:var(--color-primary-dark);flex-wrap:wrap">
                <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:220px">
                  <div style="font-weight:700;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                    <i data-lucide="clock"></i> <span>${window.utils.formatTimeOfDay(p.open)} → ${window.utils.formatTimeOfDay(p.close)}</span>
                    ${p.close <= p.open ? '<span class="text-muted" style="font-size:0.85rem;margin-inline-start:8px;font-weight:500">(تنتهي اليوم التالي)</span>' : ''}
                  </div>
                  <div style="font-size:0.9rem;opacity:0.85">
                    مدة الموعد: <strong>${formatDuration(p.duration)}</strong>
                    &nbsp;·&nbsp;
                    السعر: <strong>${window.utils.formatCurrency(p.price)}/ساعة</strong>
                  </div>
                </div>
                ${isOwner ? `
                  <div class="flex-row" style="gap:4px;flex-wrap:nowrap">
                    <button class="btn btn--secondary btn--sm" data-act="edit" data-dow="${dow}" data-idx="${idx}">تعديل</button>
                    <button class="btn btn--danger btn--sm" data-act="delete" data-dow="${dow}" data-idx="${idx}">حذف</button>
                  </div>
                ` : ''}
              </div>
            `).join('')}
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
              message: `حذف الفترة ${window.utils.formatTimeOfDay(period.open)} → ${window.utils.formatTimeOfDay(period.close)} من ${day.name}؟`,
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
            <p class="text-muted mb-md">${editing ? 'تعديل' : 'إضافة'} فترة عمل ليوم ${day.name}:</p>
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
                <label class="form-label">السعر بالساعة (ر.س) <span class="required">*</span></label>
                <input type="number" min="0" step="0.01" class="form-control" name="price" required value="${currentPrice}">
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
          title: editing ? `تعديل فترة - ${day.name}` : `إضافة فترة - ${day.name}`,
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
          const open = fd.get('open');
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
            window.utils.toast(`الفترة تتداخل مع فترة موجودة: ${window.utils.formatTimeOfDay(conflict.open)} → ${window.utils.formatTimeOfDay(conflict.close)}`, 'error');
            return;
          }
          ctrl.close();
          await saveDayPeriods(day, newPeriods);
        });
      }

      function openMultiDayPeriodModal() {
        const formHtml = `
          <form id="multi-period-form" autocomplete="off">
            <p class="text-muted mb-md">إضافة فترة عمل لـ <strong>${window.utils.escapeHtml(fields.find((f) => f.id === selectedFieldId).name)}</strong></p>
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
                <label class="form-label">السعر بالساعة (ر.س) <span class="required">*</span></label>
                <input type="number" min="0" step="0.01" class="form-control" name="price" required value="0">
              </div>
            </div>
            <div id="multi-slots-preview"></div>
            <div class="form-group">
              <label class="form-label">الأيام المستهدفة</label>
              <div style="display:flex;flex-direction:column;gap:6px;background:var(--color-bg);padding:12px;border-radius:var(--radius)">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600">
                  <input type="radio" name="mode" value="all" checked>
                  <span>تطبيق على كل أيام الأسبوع</span>
                </label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600">
                  <input type="radio" name="mode" value="custom">
                  <span>تخصيص أيام محددة</span>
                </label>
              </div>
            </div>
            <div id="days-picker" class="hidden" style="background:var(--color-info-light);padding:12px;border-radius:var(--radius)">
              <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(100px, 1fr));gap:8px">
                ${DAYS.map((d) => `
                  <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                    <input type="checkbox" name="day_${d.dow}" value="${d.dow}">
                    <span>${d.name}</span>
                  </label>
                `).join('')}
              </div>
            </div>
          </form>
        `;
        const footer = `
          <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
          <button type="submit" class="btn btn--primary" form="multi-period-form">إضافة</button>
        `;
        const ctrl = window.utils.openModal({ title: 'إضافة فترة عمل', body: formHtml, footer });
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
          const open = fd.get('open');
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
            window.utils.toast(`الفترة تتداخل مع فترات موجودة في كل الأيام المستهدفة (${conflicts.join('، ')})`, 'error');
            return;
          }
          if (conflicts.length) {
            const ok = await window.utils.confirm({
              title: 'تداخل في بعض الأيام',
              message: `الأيام التالية فيها تداخل وسيتم تخطّيها: ${conflicts.join('، ')}. هل تريد المتابعة لباقي الأيام؟`,
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
            window.utils.toast(`تمت إضافة الفترة على ${savedDows.length} ${savedDows.length === 1 ? 'يوم' : 'أيام'}`, 'success');
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

      // realtime: لو تغيرت أرضية (إضافة/تعديل/حذف) أعد التحميل
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
