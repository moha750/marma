// صفحة التقويم — إعادة بناء 2026: هيدر + شريط تحكّم مخصّص + فلاتر أرضيات + مفتاح حالات
(function () {
  const TEMPLATE = `
    <div class="page-header">
      <div>
        <h2>الحجوزات</h2>
        <div class="page-subtitle">جدول حجوزاتك — استخدم «حجز جديد» أو «حجب موعد» للإضافة</div>
      </div>
      <div class="actions">
        <button class="btn btn--secondary" id="block-slot-btn"><i data-lucide="lock"></i> حجب موعد</button>
        <button class="btn btn--primary" id="add-booking-btn"><i data-lucide="plus"></i> حجز جديد</button>
      </div>
    </div>
    ${window.layout.pageTabs(window.layout.BOOKING_TABS, '/calendar')}

    <div class="cal-toolbar-c">
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
      </div>
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

      // «حجب موعد» يعيش في مكوّن مشترك — تستدعيه القائمة أيضاً.
      // (كان هنا، ولا يحتاج من التقويم شيئاً: يطلب الأرضية والتاريخ
      //  والمواعيد من داخله، فنتيجته واحدة من أي صفحة فُتح.)
      function openBlockModal(presetFieldId, presetDate) {
        window.blockSlotModal.open({
          fields,
          fieldId: presetFieldId,
          date: presetDate,
          onBlocked: refetch
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
        locale: 'ar-u-nu-latn',
        // ملف لغة FC العربي لا يعرّف noEventsText، فيرجع للإنجليزي افتراضياً — نضبطه يدوياً
        noEventsText: 'لا مواعيد في هذه الفترة',
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
            const num = new Intl.DateTimeFormat('ar', { numberingSystem: 'latn', day: 'numeric' }).format(arg.date);
            return { html: `<span class="fc-dayhead-wd">${wd}</span><span class="fc-dayhead-num">${num}</span>` };
          }
          return arg.text; // الافتراضي (اسم اليوم) لعرض الشهر والقائمة
        },
        events: fetchEvents,
        datesSet() {
          const view = calendar.view.type;
          if (titleEl) titleEl.textContent = calendar.view.title;
          viewBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
          // حدّ أدنى مريح لأعمدة الأسبوع/الشهر السبعة. البطاقة تُمرَّر أفقياً تلقائياً
          // فقط حين تضيق المساحة دونه (يتكيّف مع حجم النافذة وحالة الشريط الجانبي)،
          // بدل ضغط الأعمدة. اليوم/القائمة يملآن المساحة المتاحة.
          calendarEl.style.minWidth =
            view === 'timeGridWeek' ? '780px' : (view === 'dayGridMonth' ? '700px' : '');
          try { calendar.updateSize(); } catch (_) {}
        },
        eventDidMount(arg) {
          // لون الحالة للشريط الجانبي والأيقونة (يستهلكه CSS عبر var(--ev-accent))
          if (arg.event.extendedProps.accent) {
            arg.el.style.setProperty('--ev-accent', arg.event.extendedProps.accent);
          }
          // أيقونة حالة موحّدة (Lucide) لكل حدث بدل الإيموجي
          const STATUS_ICON = {
            confirmed: 'check', completed: 'check-check',
            pending: 'clock', cancelled: 'x', blocked: 'lock'
          };
          const icon = STATUS_ICON[window.utils.effectiveBookingStatus(arg.event.extendedProps.booking)];
          if (!icon) return;
          const titleEl = arg.el.querySelector('.fc-event-title');
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
