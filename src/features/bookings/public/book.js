// صفحة الحجز العامة — متاحة بدون تسجيل دخول.
// واجهة العميل النهائي — الأكثر ظهوراً.
// تحديث 2026: hero strip، بطاقات أرضية مع أيقونة، شريط ملخص سفلي ثابت، شاشة نجاح بـ ICS.

(async function () {
  const root = document.getElementById('root');
  const tenantId = window.utils.getQueryParam('t');

  if (!tenantId) {
    showError('الرابط غير صالح', 'لم يتم تحديد ملعب. تأكد من فتح الرابط الصحيح.');
    return;
  }

  let tenantInfo;
  try {
    const { data, error } = await window.sb.rpc('get_public_tenant_info', { p_tenant_id: tenantId });
    if (error) throw error;
    tenantInfo = data;
  } catch (err) {
    console.error(err);
    showError('تعذّر تحميل بيانات الملعب', window.utils.formatError(err));
    return;
  }

  if (!tenantInfo) {
    showError('الملعب غير موجود', 'يبدو أن الرابط غير صحيح. تواصل مع إدارة الملعب.');
    return;
  }
  if (tenantInfo.is_active === false) {
    showError('الملعب غير متاح حالياً', 'هذا الملعب معطل مؤقتاً. يرجى التواصل مع إدارة الملعب لاحقاً.');
    return;
  }
  if (!tenantInfo.fields || tenantInfo.fields.length === 0) {
    showError('لا توجد أرضيات متاحة', 'لا توجد أرضيات نشطة في هذا الملعب حالياً. تواصل مع إدارة الملعب.');
    return;
  }

  let selectedField = null;
  let selectedSlot = null;

  function todayISO() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  renderForm();

  function renderForm() {
    root.innerHTML = `
      <div class="public-hero-strip" aria-hidden="true"></div>

      <header class="public-header">
        <div class="public-brand">
          <div class="public-brand-logo"><img src="${window.utils.path('/assets/logo-mark.svg')}" alt="" aria-hidden="true"></div>
          <div class="public-brand-text">
            <h1>${window.utils.escapeHtml(tenantInfo.name)}</h1>
            ${tenantInfo.city ? `<div class="public-meta"><i data-lucide="map-pin"></i> ${window.utils.escapeHtml(tenantInfo.city)}</div>` : ''}
          </div>
        </div>
        <p class="public-tagline">احجز موعدك بسهولة — سيتواصل معك الملعب لتأكيد الحجز.</p>
      </header>

      <form id="book-form" autocomplete="on">
        <!-- الخطوة 1: الأرضية -->
        <section class="step">
          <div class="step-title">
            <span class="step-num">1</span>
            <span>اختر الأرضية</span>
          </div>
          <div class="field-tiles" id="field-tiles">
            ${tenantInfo.fields.map((f) => `
              <button type="button" class="action-card field-tile" data-id="${f.id}">
                <div class="field-tile-icon"><i data-lucide="goal"></i></div>
                <div class="field-tile-name">${window.utils.escapeHtml(f.name)}</div>
              </button>
            `).join('')}
          </div>
        </section>

        <!-- الخطوة 2: التاريخ -->
        <section class="step">
          <div class="step-title">
            <span class="step-num">2</span>
            <span>اختر التاريخ</span>
          </div>
          <div class="form-group" style="margin:0">
            <input type="date" class="form-control" name="date" min="${todayISO()}" value="${todayISO()}" required>
          </div>
        </section>

        <!-- الخطوة 3: الموعد -->
        <section class="step">
          <div class="step-title">
            <span class="step-num">3</span>
            <span>اختر الموعد</span>
          </div>
          <div id="slots-area" class="slot-empty">
            <i data-lucide="arrow-up"></i>
            <span>اختر الأرضية أولاً لعرض المواعيد المتاحة</span>
          </div>
        </section>

        <!-- الخطوة 4: البيانات -->
        <section class="step">
          <div class="step-title">
            <span class="step-num">4</span>
            <span>بياناتك</span>
          </div>
          <div class="form-group">
            <label class="form-label">الاسم الكامل <span class="required">*</span></label>
            <input type="text" class="form-control" name="customer_name" required>
          </div>
          <div class="form-group">
            <label class="form-label">رقم الجوال <span class="required">*</span></label>
            <input type="tel" class="form-control" name="customer_phone" required placeholder="05XXXXXXXX">
          </div>
          <div class="form-group">
            <label class="form-label">ملاحظات <span class="optional">اختياري</span></label>
            <textarea class="form-control" name="notes" rows="2" placeholder="مثلاً: عدد اللاعبين، طلبات خاصة…"></textarea>
          </div>
        </section>
      </form>

      <!-- شريط الفعل السفلي الثابت — يحمل ملخص السعر + زر التأكيد -->
      <div class="public-action-bar" id="action-bar">
        <div class="public-action-summary" id="price-summary-slot">
          <span class="text-muted text-xs">السعر سيظهر هنا</span>
        </div>
        <button type="submit" class="btn btn--primary btn--lg" id="submit-btn" form="book-form">
          إرسال طلب الحجز
        </button>
      </div>
    `;
    window.utils.renderIcons(root);

    const form = document.getElementById('book-form');
    const tilesContainer = document.getElementById('field-tiles');
    const dateInput = form.date;
    const slotsArea = document.getElementById('slots-area');
    const priceSlot = document.getElementById('price-summary-slot');
    const submitBtn = document.getElementById('submit-btn');

    tilesContainer.querySelectorAll('.field-tile').forEach((tile) => {
      tile.addEventListener('click', () => {
        tilesContainer.querySelectorAll('.field-tile').forEach((t) => t.classList.remove('is-selected'));
        tile.classList.add('is-selected');
        selectedField = tenantInfo.fields.find((f) => f.id === tile.dataset.id);
        selectedSlot = null;
        refreshSlots();
        refreshPriceSummary();
      });
    });

    dateInput.addEventListener('change', () => {
      selectedSlot = null;
      refreshSlots();
      refreshPriceSummary();
    });

    async function refreshSlots() {
      if (!selectedField || !dateInput.value) {
        slotsArea.className = 'slot-empty';
        slotsArea.innerHTML = `<i data-lucide="arrow-up"></i><span>اختر الأرضية أولاً لعرض المواعيد المتاحة</span>`;
        window.utils.renderIcons(slotsArea);
        return;
      }
      slotsArea.className = 'slot-loading';
      slotsArea.innerHTML = '<div class="loader"></div>';
      try {
        const { data, error } = await window.sb.rpc('get_available_slots', {
          p_tenant_id: tenantId,
          p_field_id: selectedField.id,
          p_date: dateInput.value
        });
        if (error) throw error;
        renderSlots(data || []);
      } catch (err) {
        slotsArea.className = 'slot-empty';
        slotsArea.innerHTML = `<i data-lucide="triangle-alert"></i><span class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</span>`;
        window.utils.renderIcons(slotsArea);
      }
    }

    function renderSlots(slots) {
      const visible = slots.filter((s) => !s.is_past);
      if (!visible.length) {
        slotsArea.className = 'slot-empty';
        slotsArea.innerHTML = `<i data-lucide="calendar-x"></i><span>لا توجد مواعيد متاحة لهذا التاريخ. جرّب تاريخاً آخر.</span>`;
        window.utils.renderIcons(slotsArea);
        return;
      }

      slotsArea.className = '';
      const grid = document.createElement('div');
      grid.className = 'slot-grid';

      visible.forEach((s) => {
        const startIso = new Date(s.slot_start).toISOString();
        const endIso   = new Date(s.slot_end).toISOString();
        const slotPrice = s.slot_price !== undefined ? Number(s.slot_price) : null;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'slot-btn';
        if (!s.is_available) {
          btn.classList.add('is-busy');
          btn.disabled = true;
        }
        const statusLabel = !s.is_available
          ? 'محجوز'
          : (slotPrice ? window.utils.formatCurrency(slotPrice) : 'متاح');
        btn.innerHTML = `
          <div class="slot-time">${window.utils.formatTime(s.slot_start)} → ${window.utils.formatTime(s.slot_end)}</div>
          <div class="slot-status">${statusLabel}</div>
        `;
        btn.addEventListener('click', () => {
          if (!s.is_available) return;
          selectedSlot = { startIso, endIso, price: slotPrice };
          grid.querySelectorAll('.slot-btn').forEach((b) => b.classList.remove('is-selected'));
          btn.classList.add('is-selected');
          refreshPriceSummary();
        });
        grid.appendChild(btn);
      });

      slotsArea.innerHTML = '';
      slotsArea.appendChild(grid);
    }

    function refreshPriceSummary() {
      if (!selectedField || !selectedSlot) {
        priceSlot.innerHTML = `<span class="text-muted text-xs">السعر سيظهر هنا</span>`;
        return;
      }
      const start = new Date(selectedSlot.startIso);
      const end   = new Date(selectedSlot.endIso);
      const minutes = (end - start) / (1000 * 60);
      const price = Number(selectedSlot.price) || 0;
      priceSlot.innerHTML = `
        <div class="public-action-summary-row">
          <span class="public-action-summary-amount">${window.utils.formatCurrency(price)}</span>
          <span class="public-action-summary-meta">${minutes} دقيقة · ${window.utils.formatDate(start)}</span>
        </div>
      `;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!selectedField) {
        window.utils.toast('اختر الأرضية أولاً', 'error');
        return;
      }
      if (!selectedSlot) {
        window.utils.toast('اختر الموعد من القائمة', 'error');
        return;
      }
      const fd = new FormData(form);
      const customerName  = fd.get('customer_name').trim();
      const customerPhone = fd.get('customer_phone').trim();
      const notes = (fd.get('notes') || '').trim() || null;

      submitBtn.disabled = true;
      submitBtn.dataset.loading = 'true';

      try {
        const { data, error } = await window.sb.rpc('create_pending_booking', {
          p_tenant_id: tenantId,
          p_field_id: selectedField.id,
          p_start_time: selectedSlot.startIso,
          p_customer_name: customerName,
          p_customer_phone: customerPhone,
          p_notes: notes
        });
        if (error) throw error;
        showSuccess({
          bookingId: data.booking_id,
          totalPrice: data.total_price,
          fieldName: selectedField.name,
          start: new Date(selectedSlot.startIso),
          end:   new Date(data.end_time || selectedSlot.endIso),
          customerName
        });
      } catch (err) {
        window.utils.toast(window.utils.formatError(err), 'error');
        submitBtn.disabled = false;
        delete submitBtn.dataset.loading;
      }
    });
  }

  function showSuccess({ bookingId, totalPrice, fieldName, start, end, customerName }) {
    root.innerHTML = `
      <div class="success-screen">
        <div class="success-check"><i data-lucide="check-circle-2"></i></div>
        <h2>تم استلام طلبك!</h2>
        <p>شكراً ${window.utils.escapeHtml(customerName)}، سيتواصل معك الملعب قريباً لتأكيد الحجز.</p>
        <div class="booking-id">رقم الطلب: ${window.utils.escapeHtml(String(bookingId).slice(0, 8))}</div>

        <div class="card" style="margin: var(--space-6) auto 0; max-width: 480px; text-align: start">
          <div class="card-body" style="display:flex;flex-direction:column;gap:var(--space-3)">
            <div class="success-row">
              <span class="text-muted">الملعب</span>
              <strong>${window.utils.escapeHtml(tenantInfo.name)}</strong>
            </div>
            <div class="success-row">
              <span class="text-muted">الأرضية</span>
              <strong>${window.utils.escapeHtml(fieldName)}</strong>
            </div>
            <div class="success-row">
              <span class="text-muted">التاريخ</span>
              <strong>${window.utils.formatDate(start)}</strong>
            </div>
            <div class="success-row">
              <span class="text-muted">الوقت</span>
              <strong class="tabular-nums">${window.utils.formatTime(start)} → ${window.utils.formatTime(end)}</strong>
            </div>
            <div class="success-row" style="padding-top:var(--space-3);border-top:1px solid var(--border-subtle)">
              <span class="text-muted">السعر</span>
              <strong style="color:var(--accent-700);font-size:var(--text-lg)">${window.utils.formatCurrency(totalPrice)}</strong>
            </div>
          </div>
        </div>

        <div class="success-actions">
          <button class="btn btn--secondary" id="download-ics-btn">
            <i data-lucide="calendar-plus"></i> أضف للتقويم (ICS)
          </button>
          <button class="btn btn--ghost" onclick="window.location.reload()">
            <i data-lucide="rotate-cw"></i> حجز موعد آخر
          </button>
        </div>
      </div>
    `;
    window.utils.renderIcons(root);

    document.getElementById('download-ics-btn').addEventListener('click', () => {
      downloadICS({
        title: `حجز ${tenantInfo.name} — ${fieldName}`,
        description: `حجز رقم ${String(bookingId).slice(0, 8)} لـ ${customerName}`,
        location: tenantInfo.city || tenantInfo.name,
        start, end
      });
    });
  }

  function downloadICS({ title, description, location, start, end }) {
    const fmt = (d) => {
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
    };
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Marma//Booking//AR',
      'BEGIN:VEVENT',
      `UID:${Date.now()}@marma`,
      `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${fmt(start)}`,
      `DTEND:${fmt(end)}`,
      `SUMMARY:${title}`,
      `DESCRIPTION:${description}`,
      `LOCATION:${location || ''}`,
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'marma-booking.ics';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function showError(title, message) {
    root.innerHTML = `
      <div class="success-screen success-screen--error">
        <div class="success-check error"><i data-lucide="triangle-alert"></i></div>
        <h2 class="text-danger">${window.utils.escapeHtml(title)}</h2>
        <p>${window.utils.escapeHtml(message)}</p>
      </div>
    `;
    window.utils.renderIcons(root);
  }
})();
