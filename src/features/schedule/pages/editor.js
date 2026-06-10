// أيام وفترات العمل — محرّر أسبوعي مضمّن (inline) بحفظ تلقائي لكل يوم. للمالك فقط.
// إعادة بناء 2026: لا مودالات لتحرير الفترات — كل يوم صف، الأوقات/المدة/السعر تُحرَّر مباشرة،
// ويُحفظ اليوم تلقائياً عند أي تغيير. شريط "ضبط سريع" لكل الأيام + نسخ يوم لأيام.

(function () {
  const TEMPLATE = `
    <div class="page-header">
      <div>
        <h2>أيام وفترات العمل</h2>
        <div class="page-subtitle">حدّد أوقات كل أرضية ومدة الموعد وسعر الساعة — تُحفظ تلقائياً</div>
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
  const DEFAULT_PERIOD = { open: '16:00', close: '23:00', duration: 60, price: 0 };

  function formatDuration(mins) {
    const m = Number(mins) || 60;
    if (m % 60 === 0) return `${m / 60} ساعة`;
    if (m < 60) return `${m} دقيقة`;
    return `${Math.floor(m / 60)} ساعة و ${m % 60} دقيقة`;
  }

  function toMinuteRange(p) {
    const [oh, om] = p.open.split(':').map(Number);
    const [ch, cm] = p.close.split(':').map(Number);
    const start = oh * 60 + om;
    let end = ch * 60 + cm;
    if (end <= start) end += 24 * 60;
    return [start, end];
  }
  const rangesOverlap = (a, b) => a[0] < b[1] && b[0] < a[1];
  function detectOverlap(periods) {
    const r = periods.filter(isValidTimes).map(toMinuteRange);
    for (let i = 0; i < r.length; i++)
      for (let j = i + 1; j < r.length; j++)
        if (rangesOverlap(r[i], r[j])) return true;
    return false;
  }

  function isValidTimes(p) { return p.open && p.close && p.open !== p.close; }

  function slotInfo(p) {
    if (!isValidTimes(p)) return { valid: false, count: 0, overnight: false };
    const [start, end] = toMinuteRange(p);
    const overnight = end - start > 0 && (p.close <= p.open);
    const total = end - start;
    const count = Math.floor(total / (Number(p.duration) || 60));
    return { valid: true, count, overnight };
  }

  function periodHint(p) {
    const info = slotInfo(p);
    if (!info.valid)
      return `<span class="wh-hint wh-hint--bad"><i data-lucide="triangle-alert"></i> أدخل وقتين مختلفين</span>`;
    if (info.count <= 0)
      return `<span class="wh-hint wh-hint--bad"><i data-lucide="triangle-alert"></i> الفترة أقصر من مدة الموعد</span>`;
    const word = info.count === 1 ? 'موعد' : info.count === 2 ? 'موعدان' : (info.count <= 10 ? 'مواعيد' : 'موعداً');
    const moon = info.overnight
      ? `<span class="wh-hint wh-hint--moon"><i data-lucide="moon"></i> يمتد لليوم التالي</span>`
      : '';
    return `<span class="wh-hint"><i data-lucide="calendar-check"></i> ${info.count} ${word}</span>${moon}`;
  }

  // السعر: فارغ ⇒ null (عند التواصل) · رقم ⇒ ≥ 0 (0 = مجاني)
  function parsePrice(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (s === '') return null;
    return Math.max(0, parseFloat(s) || 0);
  }
  // قيمة input للسعر (فارغ عند null)
  function priceInputVal(v) { return v == null ? '' : v; }

  const page = {
    async mount(container, ctx) {
      container.innerHTML = TEMPLATE;
      const isOwner = ctx.profile.role === 'owner';
      const root = container.querySelector('#schedule-container');
      const fieldsHref = window.utils.path('/fields');

      let fields = [];
      let selectedFieldId = null;
      let periodsByDay = {};
      let alive = true;
      const cleanup = [];
      page._cleanup = cleanup;
      cleanup.push(() => { alive = false; });

      // ─── بيانات ───
      async function loadPeriodsForField() {
        periodsByDay = {};
        DAYS.forEach((d) => { periodsByDay[d.dow] = []; });
        if (!selectedFieldId) return;
        const rows = await window.api.listWorkingPeriods(selectedFieldId);
        rows.forEach((r) => {
          periodsByDay[r.day_of_week].push({
            open:  (r.open_time  || '').substring(0, 5),
            close: (r.close_time || '').substring(0, 5),
            duration: Number(r.slot_duration_minutes) || 60,
            price:    (r.hourly_price === null || r.hourly_price === undefined) ? null : (Number(r.hourly_price) || 0)
          });
        });
        Object.keys(periodsByDay).forEach((dow) =>
          periodsByDay[dow].sort((a, b) => a.open.localeCompare(b.open)));
      }

      // ─── حفظ يوم (تلقائي) — موحّد مع نظام التوست مثل بقية الموقع ───
      async function commitDay(dow, message) {
        const periods = periodsByDay[dow];
        if (periods.some((p) => !isValidTimes(p))) { window.utils.toast('أكمل أوقات الفترة قبل الحفظ', 'error'); return; }
        if (detectOverlap(periods)) { window.utils.toast('فترتان متداخلتان في نفس اليوم', 'error'); return; }
        try {
          const sorted = periods.map((p) => ({ ...p })).sort((a, b) => a.open.localeCompare(b.open));
          await window.api.setDayPeriods(selectedFieldId, dow, sorted);
          periodsByDay[dow] = sorted;
          updateSummary();
          window.utils.toast(message || 'تم الحفظ', 'success');
        } catch (err) {
          window.utils.toast(window.utils.formatError(err), 'error');
        }
      }

      // ─── أفعال على الحالة ───
      function setPeriodField(dow, idx, field, raw) {
        const p = periodsByDay[dow][idx];
        if (!p) return;
        if (field === 'price') p.price = parsePrice(raw);
        else if (field === 'duration') p.duration = parseInt(raw, 10) || 60;
        else p[field] = raw; // open / close
        // حدّث التلميح بلا إعادة رسم (للحفاظ على التركيز)
        const hintEl = root.querySelector(`.wh-day[data-dow="${dow}"] .wh-period[data-idx="${idx}"] .wh-period-hint`);
        if (hintEl) { hintEl.innerHTML = periodHint(p); window.utils.renderIcons(hintEl); }
        const msg = field === 'price' ? 'تم تحديث السعر'
                  : field === 'duration' ? 'تم تحديث مدة الموعد'
                  : 'تم تحديث وقت الفترة';
        commitDay(dow, msg);
      }

      function removePeriod(dow, idx) {
        periodsByDay[dow].splice(idx, 1);
        renderDayBody(dow);
        const msg = periodsByDay[dow].length === 0
          ? `تم حذف الفترة وإغلاق يوم ${DAYS.find((d) => d.dow === dow).name}`
          : 'تم حذف الفترة';
        commitDay(dow, msg);
      }
      function toggleDay(dow, open) {
        if (!open) {
          periodsByDay[dow] = [];
          renderDayBody(dow);
          commitDay(dow, `تم إغلاق يوم ${DAYS.find((d) => d.dow === dow).name}`);
        } else if (periodsByDay[dow].length === 0) {
          // فتح يوم مغلق = تعريف أول فترة عبر المودال؛ الإلغاء يُعيد المفتاح مغلقاً
          openAddPeriodModal(dow, {
            onCancel: () => {
              const t = root.querySelector(`.wh-day[data-dow="${dow}"] [data-toggle]`);
              if (t) t.checked = false;
            }
          });
        }
      }

      // ─── الرسم ───
      async function init() {
        if (!alive) return;
        root.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
        try {
          fields = window.store ? await window.store.get('fields:all') : await window.api.listFields(true);
          if (!alive) return;
          if (!fields.length) {
            root.innerHTML = `
              <div class="card"><div class="empty-state">
                <div class="empty-icon"><i data-lucide="goal"></i></div>
                <h3>لا توجد أرضيات بعد</h3>
                <p>أضف أرضية واحدة على الأقل قبل ضبط أوقات العمل.</p>
                <a href="${fieldsHref}" class="btn btn--primary"><i data-lucide="plus"></i> إضافة أرضية</a>
              </div></div>`;
            window.utils.renderIcons(root);
            return;
          }
          if (!fields.some((f) => f.id === selectedFieldId)) selectedFieldId = fields[0].id;
          await loadPeriodsForField();
          if (!alive) return;
          render();
        } catch (err) {
          if (!alive) return;
          root.innerHTML = `
            <div class="card"><div class="empty-state">
              <div class="empty-icon"><i data-lucide="triangle-alert"></i></div>
              <p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p>
            </div></div>`;
          window.utils.renderIcons(root);
        }
      }

      function render() {
        const field = fields.find((f) => f.id === selectedFieldId) || fields[0];

        root.innerHTML = `
          ${fields.length > 1 ? `
            <div class="chip-rail mb-md" id="wh-fields">
              ${fields.map((f) => `
                <button class="chip ${f.id === selectedFieldId ? 'is-active' : ''}" data-field-id="${f.id}">
                  <i data-lucide="goal" style="width:12px;height:12px"></i>
                  <span>${window.utils.escapeHtml(f.name)}</span>
                  ${!f.is_active ? '<span class="text-tertiary text-xs">معطّلة</span>' : ''}
                </button>`).join('')}
            </div>` : ''}

          <div class="wh-bar">
            <div class="wh-bar-head">
              <div>
                <div class="wh-bar-title">${window.utils.escapeHtml(field.name)}</div>
                <div class="wh-bar-sub" id="wh-summary"></div>
              </div>
            </div>
            ${isOwner ? `
              <details class="wh-quick">
                <summary><i data-lucide="wand-sparkles"></i> ضبط سريع لكل الأيام</summary>
                <div class="wh-quick-body">
                  <div class="wh-quick-grid">
                    <label class="wh-q-field"><span>من</span><input type="time" id="q-open" class="form-control" value="16:00"></label>
                    <label class="wh-q-field"><span>إلى</span><input type="time" id="q-close" class="form-control" value="23:00"></label>
                    <label class="wh-q-field"><span>مدة الموعد</span>
                      <select id="q-dur" class="form-control">${DURATION_OPTS.map((m) => `<option value="${m}" ${m === 60 ? 'selected' : ''}>${formatDuration(m)}</option>`).join('')}</select>
                    </label>
                    <label class="wh-q-field"><span>سعر الساعة</span>
                      <div class="input-group"><input type="number" min="0" step="0.01" id="q-price" class="form-control" value="0" placeholder="عند التواصل"><span class="input-addon">ر.س</span></div>
                    </label>
                  </div>
                  <button class="btn btn--primary" id="q-apply"><i data-lucide="copy-check"></i> طبّق على كل الأيام</button>
                  <p class="wh-quick-note">سيُستبدل جدول كل الأيام بهذه الفترة الواحدة. اترك السعر فارغًا = عند التواصل · 0 = مجاني.</p>
                </div>
              </details>` : ''}
          </div>

          <div class="wh-week" id="wh-week"></div>
        `;

        const week = root.querySelector('#wh-week');
        DAYS.forEach((day) => week.appendChild(buildDayRow(day)));

        // تبديل الأرضية
        root.querySelectorAll('#wh-fields [data-field-id]').forEach((chip) => {
          chip.addEventListener('click', async () => {
            if (chip.dataset.fieldId === selectedFieldId) return;
            selectedFieldId = chip.dataset.fieldId;
            root.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
            try { await loadPeriodsForField(); if (alive) render(); }
            catch (err) { window.utils.toast(window.utils.formatError(err), 'error'); }
          });
        });

        if (isOwner) bindQuickBar();
        bindWeek(week);
        updateSummary();
        window.utils.renderIcons(root);
      }

      function updateSummary() {
        const el = root.querySelector('#wh-summary');
        if (!el) return;
        const total = Object.values(periodsByDay).reduce((s, a) => s + a.length, 0);
        const open = Object.values(periodsByDay).filter((a) => a.length).length;
        el.textContent = open === 0
          ? 'كل الأيام مغلقة'
          : `${open} ${open === 1 ? 'يوم مفتوح' : 'أيام مفتوحة'} · ${total} ${total === 1 ? 'فترة' : 'فترات'}`;
      }

      function buildDayRow(day) {
        const el = document.createElement('div');
        el.className = 'wh-day';
        el.dataset.dow = day.dow;
        const isOpen = (periodsByDay[day.dow] || []).length > 0;
        el.innerHTML = `
          <div class="wh-day-head">
            <div class="wh-day-head-start">
              ${isOwner ? `
                <label class="wh-switch" title="${isOpen ? 'مفتوح' : 'مغلق'}">
                  <input type="checkbox" data-toggle ${isOpen ? 'checked' : ''}>
                  <span class="wh-switch-track"></span>
                </label>` : ''}
              <span class="wh-day-name">${day.name}</span>
              ${!isOwner ? `<span class="chip-status ${isOpen ? 'chip-status--success' : 'chip-status--muted'}">${isOpen ? 'مفتوح' : 'مغلق'}</span>` : ''}
            </div>
            <div class="wh-day-tools">
              ${isOwner ? `
                <button class="wh-add" title="إضافة فترة" ${isOpen ? '' : 'hidden'}><i data-lucide="plus"></i><span>فترة</span></button>
                <button class="wh-copy" data-copy title="نسخ هذا اليوم إلى أيام أخرى" ${isOpen ? '' : 'hidden'}><i data-lucide="copy"></i><span>نسخ</span></button>` : ''}
            </div>
          </div>
          <div class="wh-day-body" data-body></div>`;
        renderDayBodyInto(el.querySelector('[data-body]'), day.dow);
        return el;
      }

      function renderDayBody(dow) {
        const dayEl = root.querySelector(`.wh-day[data-dow="${dow}"]`);
        if (!dayEl) return;
        renderDayBodyInto(dayEl.querySelector('[data-body]'), dow);
        // حدّث المفتاح وأزرار الإضافة/النسخ حسب حالة الفتح
        const isOpen = periodsByDay[dow].length > 0;
        const toggle = dayEl.querySelector('[data-toggle]');
        if (toggle) toggle.checked = isOpen;
        dayEl.querySelectorAll('.wh-add, [data-copy]').forEach((b) => { b.hidden = !isOpen; });
      }

      function renderDayBodyInto(body, dow) {
        const periods = periodsByDay[dow] || [];
        if (!periods.length) {
          body.innerHTML = `<div class="wh-closed"><i data-lucide="moon-star"></i><span>مغلق — لا مواعيد حجز</span></div>`;
          window.utils.renderIcons(body);
          return;
        }
        if (!isOwner) {
          body.innerHTML = `<div class="wh-period-list">${periods.map((p) => `
            <div class="wh-period wh-period--ro">
              <span class="wh-ro-time">${window.utils.formatTimeOfDay(p.open)} → ${window.utils.formatTimeOfDay(p.close)}</span>
              <span class="wh-ro-meta"><i data-lucide="timer"></i> ${formatDuration(p.duration)}</span>
              <span class="wh-ro-meta"><i data-lucide="banknote"></i> ${p.price > 0 ? window.utils.formatCurrency(p.price) + '<span class="text-tertiary">/س</span>' : window.utils.formatPrice(p.price)}</span>
            </div>`).join('')}</div>`;
          window.utils.renderIcons(body);
          return;
        }
        body.innerHTML = `
          <div class="wh-period-list">
            ${periods.map((p, idx) => `
              <div class="wh-period" data-idx="${idx}">
                <div class="wh-period-hint">${periodHint(p)}</div>
                <div class="wh-period-grid">
                  <label class="wh-f"><span class="wh-f-label">من</span>
                    <input type="time" class="form-control" data-f="open" value="${p.open}"></label>
                  <label class="wh-f"><span class="wh-f-label">إلى</span>
                    <input type="time" class="form-control" data-f="close" value="${p.close}"></label>
                  <label class="wh-f"><span class="wh-f-label">مدة الموعد</span>
                    <select class="form-control" data-f="duration">
                      ${DURATION_OPTS.map((m) => `<option value="${m}" ${m === p.duration ? 'selected' : ''}>${formatDuration(m)}</option>`).join('')}
                    </select></label>
                  <label class="wh-f"><span class="wh-f-label">سعر الساعة</span>
                    <div class="input-group"><input type="number" min="0" step="0.01" class="form-control" data-f="price" value="${priceInputVal(p.price)}" placeholder="عند التواصل"><span class="input-addon">ر.س</span></div></label>
                </div>
                <div class="wh-price-note text-tertiary text-xs">اتركه فارغًا = السعر عند التواصل · 0 = مجاني</div>
                <button class="wh-remove" title="حذف هذه الفترة"><i data-lucide="trash-2"></i><span>حذف هذه الفترة</span></button>
              </div>`).join('')}
          </div>`;
        window.utils.renderIcons(body);
      }

      // ─── ربط أحداث الأسبوع (تفويض) ───
      function bindWeek(week) {
        week.addEventListener('change', (e) => {
          const input = e.target.closest('[data-f]');
          if (input) {
            const dow = +input.closest('.wh-day').dataset.dow;
            const idx = +input.closest('.wh-period').dataset.idx;
            setPeriodField(dow, idx, input.dataset.f, input.value);
            return;
          }
          const toggle = e.target.closest('[data-toggle]');
          if (toggle) toggleDay(+toggle.closest('.wh-day').dataset.dow, toggle.checked);
        });
        week.addEventListener('click', (e) => {
          const rm = e.target.closest('.wh-remove');
          if (rm) { removePeriod(+rm.closest('.wh-day').dataset.dow, +rm.closest('.wh-period').dataset.idx); return; }
          const add = e.target.closest('.wh-add');
          if (add) { openAddPeriodModal(+add.closest('.wh-day').dataset.dow); return; }
          const cp = e.target.closest('[data-copy]');
          if (cp && !cp.disabled) { openCopyModal(+cp.closest('.wh-day').dataset.dow); }
        });
      }

      // ─── شريط الضبط السريع ───
      function bindQuickBar() {
        const apply = root.querySelector('#q-apply');
        if (!apply) return;
        apply.addEventListener('click', async () => {
          const open = root.querySelector('#q-open').value;
          const close = root.querySelector('#q-close').value;
          const duration = parseInt(root.querySelector('#q-dur').value, 10) || 60;
          const price = parsePrice(root.querySelector('#q-price').value);
          if (!isValidTimes({ open, close })) { window.utils.toast('أدخل وقتين مختلفين', 'error'); return; }
          const ok = await window.utils.confirm({
            title: 'تطبيق على كل الأيام',
            message: 'سيُستبدل جدول كل أيام الأسبوع بهذه الفترة الواحدة. متابعة؟',
            confirmText: 'تطبيق'
          });
          if (!ok) return;
          const period = { open, close, duration, price };
          apply.disabled = true;
          try {
            for (const d of DAYS) {
              await window.api.setDayPeriods(selectedFieldId, d.dow, [period]);
              periodsByDay[d.dow] = [{ ...period }];
            }
            window.utils.toast('تم تطبيق الفترة على كل الأيام', 'success');
            render();
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
            await loadPeriodsForField(); render();
          }
        });
      }

      // ─── إضافة فترة عبر مودال (مع معاينة حيّة) ───
      // معاينة 1 (تحت من/إلى): مدة الفترة + امتدادها لليوم التالي
      function modalDurationPreview(open, close) {
        if (!isValidTimes({ open, close })) return '';
        const [start, end] = toMinuteRange({ open, close });
        const total = end - start;
        const h = Math.floor(total / 60), m = total % 60;
        const durLabel = m === 0 ? `${h} ساعة` : (h === 0 ? `${m} دقيقة` : `${h} ساعة و ${m} دقيقة`);
        const overnight = close <= open;
        return `<div class="wh-mp ${overnight ? 'wh-mp--warn' : 'wh-mp--ok'}">
          <i data-lucide="${overnight ? 'moon' : 'clock'}"></i>
          <div>مدة الفترة <strong>${durLabel}</strong>${overnight ? ' · <strong>تمتد لليوم التالي</strong>' : ' · في نفس اليوم'}</div></div>`;
      }

      // معاينة 2 (تحت المدة/السعر): عدد المواعيد + سعر الموعد
      function modalSlotsPreview(open, close, duration, price) {
        if (!isValidTimes({ open, close }) || !duration) return '';
        const info = slotInfo({ open, close, duration });
        if (info.count <= 0) {
          return `<div class="wh-mp wh-mp--bad"><i data-lucide="triangle-alert"></i>
            <div>الفترة أقصر من مدة الموعد — لن تُنشأ مواعيد</div></div>`;
        }
        const word = info.count === 1 ? 'موعد' : info.count === 2 ? 'موعدان' : (info.count <= 10 ? 'مواعيد' : 'موعداً');
        const perSlot = price == null ? null : Math.round(price * (duration / 60) * 100) / 100;
        const priceLabel = price == null ? ' · السعر عند التواصل'
                         : price > 0 ? ` · <strong>${window.utils.formatCurrency(perSlot)}</strong> للموعد`
                         : ' · مجاني';
        return `<div class="wh-mp wh-mp--ok"><i data-lucide="calendar-check"></i>
          <div>سيُنشأ <strong>${info.count}</strong> ${word}${priceLabel}</div></div>`;
      }

      function openAddPeriodModal(dow, opts = {}) {
        const day = DAYS.find((d) => d.dow === dow);
        const body = `
          <form id="wh-add-form" autocomplete="off">
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
            <div id="wh-add-dur"></div>
            <div class="form-row cols-2">
              <div class="form-group">
                <label class="form-label">مدة الموعد <span class="required">*</span></label>
                <select class="form-control" name="duration" required>
                  <option value="" disabled selected>اختر المدة</option>
                  ${DURATION_OPTS.map((m) => `<option value="${m}">${formatDuration(m)}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">سعر الساعة</label>
                <div class="input-group">
                  <input type="number" min="0" step="0.01" class="form-control" name="price" placeholder="عند التواصل">
                  <span class="input-addon">ر.س</span>
                </div>
                <span class="form-help">اتركه فارغًا = السعر عند التواصل |0 0 = مجاني</span>
              </div>
            </div>
            <div id="wh-add-slots"></div>
          </form>`;
        const footer = `
          <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
          <button type="submit" class="btn btn--primary" form="wh-add-form">إضافة الفترة</button>`;
        let submitted = false;
        const ctrl = window.utils.openModal({
          title: `إضافة فترة — ${day.name}`, body, footer,
          onClose: () => { if (!submitted && opts.onCancel) opts.onCancel(); }
        });
        const form = ctrl.modal.querySelector('#wh-add-form');
        const durEl = ctrl.modal.querySelector('#wh-add-dur');
        const slotsEl = ctrl.modal.querySelector('#wh-add-slots');
        const update = () => {
          const duration = parseInt(form.duration.value, 10) || 0;
          const price = parsePrice(form.price.value);
          durEl.innerHTML = modalDurationPreview(form.open.value, form.close.value);
          slotsEl.innerHTML = modalSlotsPreview(form.open.value, form.close.value, duration, price);
          window.utils.renderIcons(durEl);
          window.utils.renderIcons(slotsEl);
        };
        form.open.addEventListener('input', update);
        form.close.addEventListener('input', update);
        form.duration.addEventListener('change', update);
        form.price.addEventListener('input', update);
        update();
        ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const open = form.open.value, close = form.close.value;
          const duration = parseInt(form.duration.value, 10) || 60;
          const price = parsePrice(form.price.value);
          if (!isValidTimes({ open, close })) { window.utils.toast('أدخل وقتين مختلفين', 'error'); return; }
          if (detectOverlap([...periodsByDay[dow], { open, close, duration, price }])) {
            window.utils.toast('الفترة تتداخل مع فترة موجودة في هذا اليوم', 'error'); return;
          }
          submitted = true;
          ctrl.close();
          periodsByDay[dow].push({ open, close, duration, price });
          renderDayBody(dow);
          commitDay(dow, `تم إضافة فترة ليوم ${day.name}`);
        });
      }

      // ─── نسخ يوم إلى أيام (مودال مُصغّر — فعل عرضي) ───
      function openCopyModal(sourceDow) {
        const source = DAYS.find((d) => d.dow === sourceDow);
        const sourcePeriods = periodsByDay[sourceDow] || [];
        if (!sourcePeriods.length) return;
        const body = `
          <p class="text-muted text-sm mb-md">انسخ فترات <strong class="text-accent">${source.name}</strong>
            (${sourcePeriods.length} ${sourcePeriods.length === 1 ? 'فترة' : 'فترات'}) إلى:</p>
          <div class="wh-copy-days">
            ${DAYS.filter((d) => d.dow !== sourceDow).map((d) => `
              <label class="form-check"><input type="checkbox" value="${d.dow}"><span>${d.name}</span></label>`).join('')}
          </div>
          <p class="form-help mt-md">سيُستبدل أي فترات موجودة في الأيام المختارة.</p>`;
        const footer = `
          <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
          <button type="button" class="btn btn--primary" id="copy-go">نسخ</button>`;
        const ctrl = window.utils.openModal({ title: `نسخ فترات ${source.name}`, body, footer });
        ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
        ctrl.modal.querySelector('#copy-go').addEventListener('click', async () => {
          const targets = [...ctrl.modal.querySelectorAll('.wh-copy-days input:checked')].map((i) => +i.value);
          if (!targets.length) { window.utils.toast('اختر يوماً واحداً على الأقل', 'error'); return; }
          ctrl.close();
          try {
            for (const dow of targets) {
              const copy = sourcePeriods.map((p) => ({ ...p }));
              await window.api.setDayPeriods(selectedFieldId, dow, copy);
              periodsByDay[dow] = copy;
            }
            window.utils.toast(
              targets.length === 1
                ? `تم النسخ إلى يوم ${DAYS.find((d) => d.dow === targets[0]).name}`
                : `تم النسخ إلى ${targets.length} أيام`,
              'success');
            render();
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
            await loadPeriodsForField(); render();
          }
        });
      }

      if (window.realtime) {
        const debounced = window.utils.debounce(init, 400);
        cleanup.push(window.realtime.on('fields:change', debounced));
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
