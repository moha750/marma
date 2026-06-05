// صفحة التقويم — إعادة بناء 2026: هيدر + شريط تحكّم مخصّص + فلاتر أرضيات + مفتاح حالات
(function () {
  const TEMPLATE = `
    <div class="page-header">
      <div>
        <h2>التقويم</h2>
        <div class="page-subtitle">جدول حجوزاتك — استخدم «حجز جديد» أو «حجب موعد» للإضافة</div>
      </div>
      <div class="actions">
        <a href="${window.utils.path('/bookings')}" class="btn btn--secondary"><i data-lucide="list"></i> قائمة الحجوزات</a>
        <button class="btn btn--secondary" id="block-slot-btn"><i data-lucide="lock"></i> حجب موعد</button>
        <button class="btn btn--primary" id="add-booking-btn"><i data-lucide="plus"></i> حجز جديد</button>
      </div>
    </div>

    <div class="cal-toolbar">
      <div class="cal-nav">
        <button class="cal-nav-btn" data-nav="prev" aria-label="السابق"><i data-lucide="chevron-right"></i></button>
        <button class="cal-today" data-nav="today">اليوم</button>
        <button class="cal-nav-btn" data-nav="next" aria-label="التالي"><i data-lucide="chevron-left"></i></button>
      </div>
      <div class="cal-title" id="cal-title">—</div>
      <div class="cal-views">
        <button class="cal-view" data-view="dayGridMonth">شهر</button>
        <button class="cal-view" data-view="timeGridWeek">أسبوع</button>
        <button class="cal-view" data-view="timeGridDay">يوم</button>
        <button class="cal-view" data-view="listWeek">قائمة</button>
      </div>
    </div>

    <div class="cal-subbar">
      <div class="cal-fields" id="cal-fields"><span class="cal-fields-lbl">الأرضيات:</span></div>
      <div class="cal-legend">
        <span class="cal-leg"><span class="swatch swatch--confirmed"></span> مؤكد</span>
        <span class="cal-leg"><span class="swatch swatch--pending"></span> بانتظار الموافقة</span>
        <span class="cal-leg"><span class="swatch swatch--blocked"></span> محجوب</span>
        <span class="cal-leg"><span class="swatch swatch--cancelled"></span> ملغي</span>
      </div>
    </div>

    <div class="cal-outside hidden" id="cal-outside">
      <i data-lucide="alert-triangle"></i>
      <span id="cal-outside-text"></span>
      <button type="button" class="cal-outside-btn" id="cal-outside-toggle"></button>
    </div>

    <div class="cal-card"><div id="calendar"></div></div>

    <div class="cal-hint">
      <i data-lucide="mouse-pointer-click"></i>
      <span>انقر «حجز جديد» أو «حجب موعد» لإضافة · انقر على أي موعد في الجدول لإدارته</span>
    </div>
  `;

  function token(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function fieldPalette() {
    return ['--cat-1', '--cat-2', '--cat-3', '--cat-4', '--cat-5', '--cat-6', '--cat-7', '--cat-8']
      .map(token);
  }

  const page = {
    async mount(container, ctx) {
      if (typeof window.FullCalendar === 'undefined') {
        container.innerHTML = `<div class="card"><div class="empty-state"><p class="text-danger">مكتبة التقويم لم تُحمَّل. أعد تحميل الصفحة.</p></div></div>`;
        return;
      }

      container.innerHTML = TEMPLATE;
      window.utils.renderIcons(container);

      const calendarEl = container.querySelector('#calendar');
      const addBtn = container.querySelector('#add-booking-btn');
      const blockBtn = container.querySelector('#block-slot-btn');
      const titleEl = container.querySelector('#cal-title');
      const fieldsEl = container.querySelector('#cal-fields');
      const navBtns = container.querySelectorAll('[data-nav]');
      const viewBtns = container.querySelectorAll('.cal-view');
      const outsideEl = container.querySelector('#cal-outside');
      const outsideText = container.querySelector('#cal-outside-text');
      const outsideToggle = container.querySelector('#cal-outside-toggle');

      let fields = [];
      const fieldColorMap = {};
      const hiddenFields = new Set();
      let calendar = null;
      let baseWindow = { min: '08:00:00', max: '24:00:00' };  // مشتقّة من أوقات العمل
      let currentWindow = baseWindow;                          // الفعلية حالياً
      let revealOutside = false;                               // أظهَر المالك الحجوزات الخارجة؟
      let lastEvents = [];                                     // آخر أحداث مجلوبة (للتبديل)
      let alive = true;
      const cleanup = [];
      page._cleanup = cleanup;

      function colorForField(fieldId) {
        return fieldColorMap[fieldId] || token('--neutral-600');
      }

      function refetch() { if (calendar) calendar.refetchEvents(); }

      // نافذة عرض الساعات: تُشتقّ من فترات العمل الفعلية لكل الأرضيات
      // فلا تظهر شبكة ميتة خارج أوقات التشغيل. fallback آمن إن تعذّر.
      function toMin(t) { const p = String(t).split(':'); return (+p[0]) * 60 + (+p[1]); }
      function minToHms(m) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(Math.floor(m / 60))}:${pad(m % 60)}:00`;
      }
      async function computeSlotWindow() {
        if (!window.scheduleApi || !fields.length) return { min: '08:00:00', max: '24:00:00' };
        try {
          const lists = await Promise.all(
            fields.map((f) => window.scheduleApi.listWorkingPeriods(f.id).catch(() => []))
          );
          let minOpen = Infinity, maxClose = -Infinity;
          lists.flat().forEach((p) => {
            const o = toMin(p.open_time);
            let c = toMin(p.close_time);
            if (c <= o) c += 1440; // فترة تمتد بعد منتصف الليل
            if (o < minOpen) minOpen = o;
            if (c > maxClose) maxClose = c;
          });
          if (!isFinite(minOpen) || !isFinite(maxClose)) return { min: '08:00:00', max: '24:00:00' };
          const minH = Math.max(0, Math.floor(minOpen / 60));
          const maxH = Math.min(28, Math.max(Math.ceil(maxClose / 60), minH + 4));
          const pad = (n) => String(n).padStart(2, '0');
          return { min: pad(minH) + ':00:00', max: pad(maxH) + ':00:00' };
        } catch (_) {
          return { min: '08:00:00', max: '24:00:00' };
        }
      }

      // حدود الحدث بالدقائق ضمن يومه (مع تمديد ما يعبر منتصف الليل بعد 24:00)
      function eventBounds(ev) {
        const s = new Date(ev.start), e = new Date(ev.end);
        let sMin = s.getHours() * 60 + s.getMinutes();
        let eMin = e.getHours() * 60 + e.getMinutes();
        if (eMin <= sMin) eMin += 1440;
        return { sMin, eMin };
      }

      // حدث يقع خارج نافذة أوقات العمل المعروضة
      function isOutside(ev) {
        const { sMin, eMin } = eventBounds(ev);
        return sMin < toMin(baseWindow.min) || eMin > toMin(baseWindow.max);
      }

      function setWindow(min, max) {
        if (min === currentWindow.min && max === currentWindow.max) return;
        currentWindow = { min, max };
        calendar.setOption('slotMinTime', min);
        calendar.setOption('slotMaxTime', max);
      }

      // الحالة الافتراضية: الجدول مركّز على أوقات العمل. عند وجود حجوزات خارجها
      // نعرض تنبيهاً صريحاً، ولا نوسّع النافذة إلا بطلب المالك (نقرة «عرض»).
      function updateOutsideState(events) {
        if (!calendar) return;
        const outside = events.filter(isOutside);

        if (revealOutside && outside.length) {
          let lo = toMin(baseWindow.min), hi = toMin(baseWindow.max);
          outside.forEach((ev) => {
            const { sMin, eMin } = eventBounds(ev);
            if (sMin < lo) lo = sMin;
            if (eMin > hi) hi = eMin;
          });
          lo = Math.max(0, Math.floor(lo / 60) * 60);
          hi = Math.min(30 * 60, Math.ceil(hi / 60) * 60);
          setWindow(minToHms(lo), minToHms(hi));
        } else {
          setWindow(baseWindow.min, baseWindow.max);
        }

        renderOutsideNotice(outside.length);
      }

      function renderOutsideNotice(n) {
        if (!outsideEl) return;
        if (n === 0) { outsideEl.classList.add('hidden'); return; }
        const noun = n === 1 ? 'حجز واحد' : (n === 2 ? 'حجزان' : `${n} حجوزات`);
        outsideEl.classList.remove('hidden');
        outsideEl.classList.toggle('is-revealed', revealOutside);
        outsideText.textContent = revealOutside
          ? `تُعرض ${noun} خارج أوقات العمل`
          : `${noun} خارج أوقات العمل الحالية`;
        outsideToggle.textContent = revealOutside ? 'إخفاء' : 'عرض';
        window.utils.renderIcons(outsideEl);
      }

      // شرائح الأرضيات — إظهار/إخفاء أحداث كل أرضية. تختفي كاملة لو أرضية واحدة.
      function renderFields() {
        fieldsEl.querySelectorAll('.cal-fchip').forEach((el) => el.remove());
        if (fields.length < 2) { fieldsEl.style.display = 'none'; return; }
        fieldsEl.style.display = '';
        fields.forEach((f) => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'cal-fchip';
          chip.innerHTML = `<span class="dot" style="background:${colorForField(f.id)}"></span><span class="name">${window.utils.escapeHtml(f.name)}</span>`;
          chip.addEventListener('click', () => {
            if (hiddenFields.has(f.id)) { hiddenFields.delete(f.id); chip.classList.remove('is-off'); }
            else { hiddenFields.add(f.id); chip.classList.add('is-off'); }
            refetch();
          });
          fieldsEl.appendChild(chip);
        });
      }

      // تاريخ محلي YYYY-MM-DD
      function toLocalDate(d) {
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      }
      // دمج المواعيد المتجاورة في مدى واحد (حجب أنظف على الجدول)
      function mergeContiguous(items) {
        const sorted = items.slice().sort((a, b) => a.start.localeCompare(b.start));
        const out = [];
        sorted.forEach((it) => {
          const last = out[out.length - 1];
          if (last && last.end === it.start) last.end = it.end;
          else out.push({ start: it.start, end: it.end });
        });
        return out;
      }

      // نافذة حجب موعد — صريحة: أرضية + تاريخ + نقر المواعيد المتاحة (اختيار متعدّد) + سبب
      function openBlockModal(presetFieldId, presetDate) {
        const list = fields.filter((f) => f.is_active !== false);
        const opts = (list.length ? list : fields);
        if (!opts.length) { window.utils.toast('أضف أرضية واحدة على الأقل أولاً', 'warning'); return; }
        const today = toLocalDate(new Date());
        const body = `
          <form id="block-form" autocomplete="off">
            <div class="form-row cols-2">
              <div class="form-group">
                <label class="form-label">الأرضية <span class="required">*</span></label>
                <select class="form-control" name="field_id" required>
                  ${opts.map((f) => `<option value="${f.id}">${window.utils.escapeHtml(f.name)}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">التاريخ <span class="required">*</span></label>
                <input type="date" class="form-control" name="date" value="${presetDate || today}" min="${today}">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">المواعيد المتاحة <span class="required">*</span></label>
              <div class="form-help" style="margin-bottom:var(--space-2)">انقر موعداً أو أكثر لحجبه — يختفي عندها من الحجز العام</div>
              <div id="block-slots" class="slot-empty">اختر الأرضية والتاريخ لعرض المواعيد…</div>
            </div>
            <div class="form-group">
              <label class="form-label">السبب (اختياري)</label>
              <input type="text" class="form-control" name="notes" maxlength="80" placeholder="مثال: لعب خاص">
              <div style="display:flex;flex-wrap:wrap;gap:var(--space-2);margin-top:var(--space-2)">
                ${['لعب خاص', 'صيانة', 'مناسبة'].map((r) => `<button type="button" class="btn btn--xs btn--ghost" data-reason="${r}">${r}</button>`).join('')}
              </div>
            </div>
          </form>
        `;
        const footer = `
          <div style="flex:1"></div>
          <button type="button" class="btn btn--ghost" data-action="close">إلغاء</button>
          <button type="button" class="btn btn--primary" id="block-confirm" disabled>
            <i data-lucide="lock"></i> حجب (<span id="block-count">0</span>)
          </button>
        `;
        const ctrl = window.utils.openModal({ title: 'حجب موعد', body, footer, size: 'lg' });
        window.utils.renderIcons(ctrl.modal);

        const form = ctrl.modal.querySelector('#block-form');
        const fieldSel = form.field_id;
        const dateInput = form.date;
        const notesInput = form.notes;
        const slotsArea = ctrl.modal.querySelector('#block-slots');
        const confirmBtn = ctrl.modal.querySelector('#block-confirm');
        const countEl = ctrl.modal.querySelector('#block-count');
        const selected = new Map(); // startIso -> { start, end }

        if (presetFieldId) fieldSel.value = presetFieldId;
        ctrl.modal.querySelectorAll('[data-reason]').forEach((b) => {
          b.addEventListener('click', () => { notesInput.value = b.dataset.reason; });
        });

        function updateCount() {
          countEl.textContent = selected.size;
          confirmBtn.disabled = selected.size === 0;
        }

        function renderSlots(slots) {
          if (!slots.length) {
            slotsArea.className = 'slot-empty';
            slotsArea.textContent = 'الأرضية مغلقة في هذا اليوم.';
            return;
          }
          if (!slots.some((s) => s.is_available && !s.is_past)) {
            slotsArea.className = 'slot-empty';
            slotsArea.textContent = 'لا مواعيد متاحة للحجب في هذا اليوم.';
            return;
          }
          slotsArea.className = '';
          const grid = document.createElement('div');
          grid.className = 'slot-grid';
          slots.forEach((s) => {
            const startIso = new Date(s.slot_start).toISOString();
            const endIso = new Date(s.slot_end).toISOString();
            const usable = s.is_available && !s.is_past;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'slot-btn';
            if (!s.is_available) btn.classList.add('is-busy');
            btn.disabled = !usable;
            const status = s.is_past ? 'انتهى' : (!s.is_available ? 'محجوز' : 'متاح');
            btn.innerHTML = `
              <div class="slot-time">${window.utils.formatTime(s.slot_start)} → ${window.utils.formatTime(s.slot_end)}</div>
              <div class="slot-status">${status}</div>
            `;
            if (usable) {
              btn.addEventListener('click', () => {
                if (selected.has(startIso)) { selected.delete(startIso); btn.classList.remove('is-selected'); }
                else { selected.set(startIso, { start: startIso, end: endIso }); btn.classList.add('is-selected'); }
                updateCount();
              });
            }
            grid.appendChild(btn);
          });
          slotsArea.innerHTML = '';
          slotsArea.appendChild(grid);
        }

        async function loadSlots() {
          selected.clear();
          updateCount();
          const fieldId = fieldSel.value;
          const dateStr = dateInput.value;
          if (!fieldId || !dateStr) {
            slotsArea.className = 'slot-empty';
            slotsArea.textContent = 'اختر الأرضية والتاريخ لعرض المواعيد…';
            return;
          }
          slotsArea.className = 'slot-empty';
          slotsArea.innerHTML = '<div class="loader"></div>';
          try {
            const slots = await window.api.getAvailableSlots(fieldId, dateStr);
            renderSlots(slots);
          } catch (err) {
            slotsArea.className = 'slot-empty';
            slotsArea.innerHTML = `<span class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</span>`;
          }
        }

        fieldSel.addEventListener('change', loadSlots);
        dateInput.addEventListener('change', loadSlots);
        loadSlots();

        ctrl.modal.querySelector('[data-action="close"]').addEventListener('click', ctrl.close);
        confirmBtn.addEventListener('click', async () => {
          if (!selected.size) return;
          const fieldId = fieldSel.value;
          const notes = notesInput.value.trim() || null;
          const ranges = mergeContiguous([...selected.values()]);
          const n = selected.size;
          confirmBtn.disabled = true;
          try {
            for (const r of ranges) {
              await window.api.createBlock({ field_id: fieldId, start_time: r.start, end_time: r.end, notes });
            }
            window.utils.toast(n > 1 ? `تم حجب ${n} مواعيد` : 'تم حجب الموعد', 'success');
            ctrl.close();
            refetch();
          } catch (err) {
            confirmBtn.disabled = false;
            const msg = (err && err.code === '23P01')
              ? 'أحد المواعيد يتقاطع مع حجز أو حجب موجود — حدّث القائمة'
              : window.utils.formatError(err);
            window.utils.toast(msg, 'error');
          }
        });
      }

      // نافذة إدارة موعد محجوب: عرض + إلغاء الحجب
      function openBlockManage(booking) {
        const fieldName = booking.fields ? booking.fields.name : '—';
        const body = `
          <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-3)">
            <span class="stat-icon-chip"><i data-lucide="lock"></i></span>
            <div>
              <div class="fw-semibold">${window.utils.escapeHtml(fieldName)}</div>
              <div class="text-xs text-secondary">موعد محجوب — لا يظهر للحجز العام</div>
            </div>
          </div>
          <div class="text-sm" style="display:flex;flex-direction:column;gap:var(--space-2)">
            <div><span class="text-secondary">الوقت:</span> ${window.utils.escapeHtml(window.utils.formatDateTime(booking.start_time))} → ${window.utils.escapeHtml(window.utils.formatTime(booking.end_time))}</div>
            ${booking.notes ? `<div><span class="text-secondary">السبب:</span> ${window.utils.escapeHtml(booking.notes)}</div>` : ''}
          </div>
        `;
        const footer = `
          <button type="button" class="btn btn--danger" data-action="unblock"><i data-lucide="lock-open"></i> إلغاء الحجب</button>
          <div style="flex:1"></div>
          <button type="button" class="btn btn--ghost" data-action="close">إغلاق</button>
        `;
        const ctrl = window.utils.openModal({ title: 'موعد محجوب', body, footer });
        window.utils.renderIcons(ctrl.modal);
        ctrl.modal.querySelector('[data-action="close"]').addEventListener('click', ctrl.close);
        ctrl.modal.querySelector('[data-action="unblock"]').addEventListener('click', async () => {
          const ok = await window.utils.confirm({
            title: 'إلغاء الحجب',
            message: 'سيعود هذا الموعد متاحاً للحجز العام. متابعة؟',
            confirmText: 'إلغاء الحجب',
            danger: true
          });
          if (!ok) return;
          try {
            await window.api.deleteBlock(booking.id);
            window.utils.toast('تم إلغاء الحجب', 'success');
            ctrl.close();
            refetch();
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
          }
        });
      }

      async function fetchEvents(info, success, failure) {
        if (!alive) { success([]); return; }
        try {
          const bookings = await window.api.listBookings({
            from: info.startStr,
            to: info.endStr,
            includeBlocks: true
          });
          if (!alive) { success([]); return; }
          const events = bookings
            .filter((b) => !hiddenFields.has(b.field_id))
            .map((b) => {
              const fieldName = b.fields ? b.fields.name : '—';
              const color = colorForField(b.field_id);
              // لون الحالة (accent): منه نشتقّ الخلفية المكتومة والحدّ والشريط الجانبي
              let accent, classes = [], title;
              if (b.status === 'blocked') {
                accent = token('--neutral-500');
                classes.push('status-blocked');
                title = `${fieldName}${b.notes ? ` — ${b.notes}` : ' — محجوب'}`;
              } else {
                const customerName = b.customers ? b.customers.full_name : '—';
                if (b.status === 'cancelled') {
                  accent = token('--danger');
                  classes.push('status-cancelled');
                } else if (b.status === 'pending') {
                  accent = token('--warning');
                } else {
                  accent = color; // مؤكد/مكتمل → لون الأرضية
                }
                title = `${fieldName} — ${customerName}`;
              }
              // نمط مكتوم: خلفية ملوّنة خفيفة + حدّ خفيف + نص داكن (الشريط الجانبي عبر CSS)
              const bg = `color-mix(in srgb, ${accent} 14%, var(--surface-1))`;
              const border = `color-mix(in srgb, ${accent} 32%, transparent)`;
              const txt = (b.status === 'cancelled') ? token('--danger') : token('--text-primary');
              return {
                id: b.id,
                title,
                start: b.start_time,
                end: b.end_time,
                backgroundColor: bg,
                borderColor: border,
                textColor: txt,
                classNames: classes,
                extendedProps: { booking: b, accent }
              };
            });
          success(events);
          lastEvents = events;
          updateOutsideState(events);
        } catch (err) {
          console.error(err);
          window.utils.toast(window.utils.formatError(err), 'error');
          failure(err);
        }
      }

      try {
        fields = window.store
          ? await window.store.get('fields:all')
          : await window.api.listFields(true);
        if (!alive) return;
        const palette = fieldPalette();
        fields.forEach((f, i) => {
          fieldColorMap[f.id] = palette[i % palette.length];
        });
        renderFields();
      } catch (err) {
        window.utils.toast(window.utils.formatError(err), 'error');
      }

      const isMobile = window.matchMedia('(max-width: 768px)').matches;
      baseWindow = await computeSlotWindow();
      currentWindow = baseWindow;

      calendar = new window.FullCalendar.Calendar(calendarEl, {
        initialView: isMobile ? 'timeGridDay' : 'timeGridWeek',
        locale: 'ar',
        direction: 'rtl',
        height: 'auto',
        nowIndicator: true,
        selectable: false,
        allDaySlot: false,
        slotMinTime: baseWindow.min,
        slotMaxTime: baseWindow.max,
        slotDuration: '00:30:00',
        slotLabelInterval: '01:00:00',
        expandRows: true,
        dayMaxEvents: true,
        eventDisplay: 'block',   // أحداث الشهر كشرائح ملوّنة (لا نقاط) لتطابق الأسبوع/اليوم
        headerToolbar: false,
        eventTimeFormat: { hour: 'numeric', minute: '2-digit', hour12: true, meridiem: 'short' },
        slotLabelFormat: { hour: 'numeric', minute: '2-digit', hour12: true, meridiem: 'short' },
        // رأس اليوم في عرض الأسبوع/اليوم: اسم اليوم فوق رقم اليوم (مكدّس)
        dayHeaderContent(arg) {
          if (arg.view.type.indexOf('timeGrid') === 0) {
            const wd = new Intl.DateTimeFormat('ar', { weekday: 'short' }).format(arg.date);
            const num = new Intl.DateTimeFormat('ar', { day: 'numeric' }).format(arg.date);
            return { html: `<span class="fc-dayhead-wd">${wd}</span><span class="fc-dayhead-num">${num}</span>` };
          }
          return arg.text; // الافتراضي (اسم اليوم) لعرض الشهر والقائمة
        },
        events: fetchEvents,
        datesSet() {
          const view = calendar.view.type;
          if (titleEl) titleEl.textContent = calendar.view.title;
          viewBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
          // على الجوال: امنح عرضَي الأسبوع/الشهر عرضاً أدنى مقروءاً فتُمرَّر البطاقة
          // أفقياً بدل انضغاط الأعمدة السبعة. اليوم/القائمة يبقيان بعرض الشاشة.
          const small = window.matchMedia('(max-width: 768px)').matches;
          const multiCol = (view === 'timeGridWeek' || view === 'dayGridMonth');
          calendarEl.style.minWidth = (small && multiCol) ? '680px' : '';
          try { calendar.updateSize(); } catch (_) {}
        },
        eventDidMount(arg) {
          // لون الحالة للشريط الجانبي والأيقونة (يستهلكه CSS عبر var(--ev-accent))
          if (arg.event.extendedProps.accent) {
            arg.el.style.setProperty('--ev-accent', arg.event.extendedProps.accent);
          }
          // أيقونة حالة موحّدة (Lucide) لكل حدث بدل الإيموجي.
          // الشبكة تستخدم .fc-event-title والقائمة .fc-list-event-title.
          const STATUS_ICON = {
            confirmed: 'check', completed: 'check-check',
            pending: 'clock', cancelled: 'x', blocked: 'lock'
          };
          const icon = STATUS_ICON[arg.event.extendedProps.booking.status];
          if (!icon) return;
          const titleEl = arg.el.querySelector('.fc-event-title') || arg.el.querySelector('.fc-list-event-title');
          if (!titleEl || titleEl.querySelector('.fc-ev-icon')) return;
          const i = document.createElement('i');
          i.setAttribute('data-lucide', icon);
          i.className = 'fc-ev-icon';
          titleEl.insertBefore(i, titleEl.firstChild);
          window.utils.renderIcons(titleEl);
        },
        eventClick(info) {
          const booking = info.event.extendedProps.booking;
          if (booking.status === 'blocked') {
            openBlockManage(booking);
            return;
          }
          window.bookingModal.open({
            booking,
            onSaved: () => calendar && calendar.refetchEvents()
          });
        }
      });
      calendar.render();

      // شريط التحكّم المخصّص
      navBtns.forEach((b) => {
        b.addEventListener('click', () => {
          const nav = b.dataset.nav;
          if (nav === 'prev') calendar.prev();
          else if (nav === 'next') calendar.next();
          else calendar.today();
        });
      });
      viewBtns.forEach((b) => {
        b.addEventListener('click', () => calendar.changeView(b.dataset.view));
      });

      const onAdd = () => {
        window.bookingModal.open({
          onSaved: () => calendar && calendar.refetchEvents()
        });
      };
      addBtn.addEventListener('click', onAdd);

      const onBlock = () => openBlockModal();
      if (blockBtn) blockBtn.addEventListener('click', onBlock);

      // تبديل عرض/إخفاء الحجوزات خارج أوقات العمل
      if (outsideToggle) {
        outsideToggle.addEventListener('click', () => {
          revealOutside = !revealOutside;
          updateOutsideState(lastEvents);
        });
      }

      // realtime: أعد جلب أحداث FullCalendar عند أي تغيير
      if (window.realtime) {
        const debouncedRefetch = window.utils.debounce(() => {
          if (calendar) calendar.refetchEvents();
        }, 400);
        cleanup.push(window.realtime.on('bookings:change', debouncedRefetch));
      }

      cleanup.push(() => {
        alive = false;
        addBtn.removeEventListener('click', onAdd);
        if (blockBtn) blockBtn.removeEventListener('click', onBlock);
        if (calendar) {
          try { calendar.destroy(); } catch (_) {}
          calendar = null;
        }
      });
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages.calendar = page;
})();
