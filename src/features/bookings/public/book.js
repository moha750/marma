// صفحة الحجز العامة - متاحة بدون تسجيل دخول
(async function () {
  const root = document.getElementById('root');
  const tenantId = window.utils.getQueryParam('t');

  if (!tenantId) {
    showError('الرابط غير صالح', 'لم يتم تحديد ملعب. تأكد من فتح الرابط الصحيح.');
    return;
  }

  // جلب معلومات الملعب
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
      <header class="public-header">
        <div class="pitch-icon"><i data-lucide="goal"></i></div>
        <h1>${window.utils.escapeHtml(tenantInfo.name)}</h1>
        ${tenantInfo.city ? `<div class="pitch-meta">${window.utils.escapeHtml(tenantInfo.city)}</div>` : ''}
        <p class="text-muted" style="margin-top:8px">احجز موعدك بسهولة - سيتواصل معك الملعب لتأكيد الحجز</p>
      </header>

      <form id="book-form" autocomplete="on">
        <div class="step">
          <div class="step-title"><span class="step-num">1</span> اختر الأرضية</div>
          <div class="field-tiles" id="field-tiles">
            ${tenantInfo.fields
              .map(
                (f) => `
              <button type="button" class="field-tile" data-id="${f.id}">
                <div class="name">${window.utils.escapeHtml(f.name)}</div>
              </button>
            `
              )
              .join('')}
          </div>
        </div>

        <div class="step">
          <div class="step-title"><span class="step-num">2</span> اختر التاريخ</div>
          <div class="form-group">
            <input type="date" class="form-control" name="date" min="${todayISO()}" value="${todayISO()}" required>
          </div>
        </div>

        <div class="step">
          <div class="step-title"><span class="step-num">3</span> اختر الموعد</div>
          <div id="slots-area" class="slot-empty">اختر الأرضية أولاً لعرض المواعيد المتاحة...</div>
        </div>

        <div class="step">
          <div class="step-title"><span class="step-num">4</span> بياناتك</div>
          <div class="form-group">
            <label class="form-label">اسمك الكامل <span class="required">*</span></label>
            <input type="text" class="form-control" name="customer_name" required>
          </div>
          <div class="form-group">
            <label class="form-label">رقم الجوال <span class="required">*</span></label>
            <input type="tel" class="form-control" name="customer_phone" required placeholder="05XXXXXXXX">
          </div>
          <div class="form-group">
            <label class="form-label">ملاحظات (اختياري)</label>
            <textarea class="form-control" name="notes" rows="2" placeholder="مثلاً: عدد اللاعبين، طلبات خاصة..."></textarea>
          </div>
        </div>

        <div id="price-summary-container"></div>

        <button type="submit" class="btn btn--primary btn--block" id="submit-btn" style="padding:14px;font-size:1.05rem">
          إرسال طلب الحجز
        </button>

        <p class="text-muted text-center mt-md" style="font-size:0.85rem">
          سيراجع الملعب طلبك ويتواصل معك للتأكيد.
        </p>
      </form>
    `;
    window.utils.renderIcons(root);

    const form = document.getElementById('book-form');
    const tilesContainer = document.getElementById('field-tiles');
    const dateInput = form.date;
    const slotsArea = document.getElementById('slots-area');
    const priceContainer = document.getElementById('price-summary-container');
    const submitBtn = document.getElementById('submit-btn');

    // اختيار أرضية
    tilesContainer.querySelectorAll('.field-tile').forEach((tile) => {
      tile.addEventListener('click', () => {
        tilesContainer.querySelectorAll('.field-tile').forEach((t) => t.classList.remove('selected'));
        tile.classList.add('selected');
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
        slotsArea.textContent = 'اختر الأرضية أولاً لعرض المواعيد المتاحة...';
        return;
      }
      slotsArea.className = 'slot-empty';
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
        slotsArea.innerHTML = `<span class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</span>`;
      }
    }

    function renderSlots(slots) {
      // نخفي الـ slots الماضية تماماً للعميل
      const visible = slots.filter((s) => !s.is_past);
      if (!visible.length) {
        slotsArea.className = 'slot-empty';
        slotsArea.textContent = 'لا توجد مواعيد متاحة لهذا التاريخ. جرّب تاريخاً آخر.';
        return;
      }

      slotsArea.className = '';
      const grid = document.createElement('div');
      grid.className = 'slot-grid';

      visible.forEach((s) => {
        const startIso = new Date(s.slot_start).toISOString();
        const endIso = new Date(s.slot_end).toISOString();
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
          grid.querySelectorAll('.slot-btn').forEach((b) => b.classList.remove('selected'));
          btn.classList.add('selected');
          refreshPriceSummary();
        });
        grid.appendChild(btn);
      });

      slotsArea.innerHTML = '';
      slotsArea.appendChild(grid);
    }

    function refreshPriceSummary() {
      if (!selectedField || !selectedSlot) {
        priceContainer.innerHTML = '';
        return;
      }
      const start = new Date(selectedSlot.startIso);
      const end = new Date(selectedSlot.endIso);
      const minutes = (end - start) / (1000 * 60);
      const price = Number(selectedSlot.price) || 0;
      priceContainer.innerHTML = `
        <div class="price-summary">
          <div>
            <div>السعر الإجمالي</div>
            <div class="text-muted" style="font-size:0.9rem">${minutes} دقيقة · ${window.utils.formatDate(start)}</div>
          </div>
          <div class="amount">${window.utils.formatCurrency(price)}</div>
        </div>
      `;
    }

    // الإرسال
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
      const customerName = fd.get('customer_name').trim();
      const customerPhone = fd.get('customer_phone').trim();
      const notes = (fd.get('notes') || '').trim() || null;

      submitBtn.disabled = true;
      submitBtn.textContent = 'جارٍ إرسال الطلب...';

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
          end: new Date(data.end_time || selectedSlot.endIso),
          customerName
        });
      } catch (err) {
        window.utils.toast(window.utils.formatError(err), 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'إرسال طلب الحجز';
      }
    });
  }

  function showSuccess({ bookingId, totalPrice, fieldName, start, end, customerName }) {
    root.innerHTML = `
      <div class="success-screen">
        <div class="check-icon"><i data-lucide="check-circle-2"></i></div>
        <h2>تم استلام طلبك!</h2>
        <p>شكراً ${window.utils.escapeHtml(customerName)}، سيتواصل معك الملعب قريباً لتأكيد الحجز.</p>
        <div class="booking-id">رقم الطلب: ${window.utils.escapeHtml(String(bookingId).slice(0, 8))}</div>
        <div class="card" style="text-align:start;margin:24px auto;max-width:480px">
          <div class="card-body">
            <div style="margin-bottom:8px"><strong>الملعب:</strong> ${window.utils.escapeHtml(tenantInfo.name)}</div>
            <div style="margin-bottom:8px"><strong>الأرضية:</strong> ${window.utils.escapeHtml(fieldName)}</div>
            <div style="margin-bottom:8px"><strong>التاريخ:</strong> ${window.utils.formatDate(start)}</div>
            <div style="margin-bottom:8px"><strong>الوقت:</strong> ${window.utils.formatTime(start)} → ${window.utils.formatTime(end)}</div>
            <div><strong>السعر:</strong> ${window.utils.formatCurrency(totalPrice)}</div>
          </div>
        </div>
        <button class="btn btn--secondary" onclick="window.location.reload()">حجز موعد آخر</button>
      </div>
    `;
    window.utils.renderIcons(root);
  }

  function showError(title, message) {
    root.innerHTML = `
      <div class="success-screen" style="border-color:var(--color-danger)">
        <div class="check-icon" style="color:var(--color-danger)"><i data-lucide="triangle-alert"></i></div>
        <h2 style="color:var(--color-danger)">${window.utils.escapeHtml(title)}</h2>
        <p>${window.utils.escapeHtml(message)}</p>
      </div>
    `;
    window.utils.renderIcons(root);
  }
})();
