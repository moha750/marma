// صفحة التقويم - module pattern (SPA + legacy)
(function () {
  const TEMPLATE = `
    <style>
      #calendar { background: var(--color-card); border: 1px solid var(--color-border); border-radius: var(--radius); padding: 16px; }
      .field-legend { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
      .field-legend .item { display: flex; align-items: center; gap: 6px; font-size: 0.9rem; }
    </style>
    <div class="page-header">
      <h2>التقويم</h2>
      <div class="actions">
        <button class="btn btn--primary" id="add-booking-btn">+ حجز جديد</button>
      </div>
    </div>
    <div id="field-legend" class="field-legend"></div>
    <div id="calendar"></div>
  `;

  const FIELD_COLORS = ['#16a34a', '#2563eb', '#dc2626', '#ca8a04', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

  const page = {
    async mount(container, ctx) {
      if (typeof window.FullCalendar === 'undefined') {
        container.innerHTML = `<div class="card"><div class="empty-state"><p class="text-danger">مكتبة التقويم لم تُحمَّل. أعد تحميل الصفحة.</p></div></div>`;
        return;
      }

      container.innerHTML = TEMPLATE;

      const legendEl = container.querySelector('#field-legend');
      const calendarEl = container.querySelector('#calendar');
      const addBtn = container.querySelector('#add-booking-btn');

      let fields = [];
      const fieldColorMap = {};
      let calendar = null;
      let alive = true;
      const cleanup = [];
      page._cleanup = cleanup;

      function colorForField(fieldId) {
        return fieldColorMap[fieldId] || '#6b7280';
      }

      function renderLegend() {
        legendEl.innerHTML = fields
          .map((f) => `
            <div class="item">
              <span class="color-dot" style="background:${colorForField(f.id)}"></span>
              <span>${window.utils.escapeHtml(f.name)}</span>
            </div>
          `)
          .join('');
      }

      async function fetchEvents(info, success, failure) {
        if (!alive) { success([]); return; }
        try {
          const bookings = await window.api.listBookings({
            from: info.startStr,
            to: info.endStr
          });
          if (!alive) { success([]); return; }
          const events = bookings.map((b) => {
            const customerName = b.customers ? b.customers.full_name : '—';
            const fieldName = b.fields ? b.fields.name : '—';
            const color = colorForField(b.field_id);
            let bg, border, classes = [];
            if (b.status === 'cancelled') {
              bg = '#9ca3af'; border = '#6b7280';
              classes.push('status-cancelled');
            } else if (b.status === 'pending') {
              bg = '#ca8a04'; border = '#854d0e';
              classes.push('status-pending');
            } else {
              bg = color; border = color;
            }
            return {
              id: b.id,
              title: `${b.status === 'pending' ? '⏳ ' : ''}${fieldName} — ${customerName}`,
              start: b.start_time,
              end: b.end_time,
              backgroundColor: bg,
              borderColor: border,
              classNames: classes,
              extendedProps: { booking: b }
            };
          });
          success(events);
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
        fields.forEach((f, i) => {
          fieldColorMap[f.id] = FIELD_COLORS[i % FIELD_COLORS.length];
        });
        renderLegend();
      } catch (err) {
        window.utils.toast(window.utils.formatError(err), 'error');
      }

      calendar = new window.FullCalendar.Calendar(calendarEl, {
        initialView: 'timeGridWeek',
        locale: 'ar',
        direction: 'rtl',
        height: 'auto',
        nowIndicator: true,
        selectable: true,
        selectMirror: true,
        slotMinTime: '06:00:00',
        slotMaxTime: '26:00:00',
        eventTimeFormat: { hour: 'numeric', minute: '2-digit', hour12: true, meridiem: 'short' },
        slotLabelFormat: { hour: 'numeric', minute: '2-digit', hour12: true, meridiem: 'short' },
        headerToolbar: {
          start: 'prev,next today',
          center: 'title',
          end: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
        },
        buttonText: {
          today: 'اليوم',
          month: 'شهر',
          week: 'أسبوع',
          day: 'يوم',
          list: 'قائمة'
        },
        events: fetchEvents,
        select(info) {
          window.bookingModal.open({
            defaultStart: info.start,
            defaultEnd: info.end,
            onSaved: () => calendar && calendar.refetchEvents()
          });
          calendar.unselect();
        },
        eventClick(info) {
          const booking = info.event.extendedProps.booking;
          window.bookingModal.open({
            booking,
            onSaved: () => calendar && calendar.refetchEvents()
          });
        }
      });
      calendar.render();

      const onAdd = () => {
        window.bookingModal.open({
          onSaved: () => calendar && calendar.refetchEvents()
        });
      };
      addBtn.addEventListener('click', onAdd);

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
