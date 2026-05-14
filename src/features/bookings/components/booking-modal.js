// مكون مودال الحجز - مشترك بين صفحة الحجوزات وصفحة التقويم
// الاستخدام: window.bookingModal.open({ booking, defaultStart, defaultEnd, onSaved })

window.bookingModal = (function () {
  // تحويل تاريخ/قيمة إلى YYYY-MM-DD بالتوقيت المحلي
  function toLocalDateString(value) {
    const d = value instanceof Date ? value : new Date(value);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // مفتاح مساعد لجلب الأرضيات النشطة والعملاء عند الفتح
  // يستخدم store إن وُجد (cache + dedup) وإلا fallback مباشر إلى api
  async function loadDependencies() {
    if (window.store) {
      const [fields, customers] = await Promise.all([
        window.store.get('fields:active'),
        window.store.get('customers:all')
      ]);
      return { fields, customers };
    }
    const [fields, customers] = await Promise.all([
      window.api.listFields(false),
      window.api.listCustomers('')
    ]);
    return { fields, customers };
  }

  async function open({ booking = null, defaultStart = null, defaultEnd = null, defaultFieldId = null, onSaved } = {}) {
    let deps;
    try {
      deps = await loadDependencies();
    } catch (err) {
      window.utils.toast(window.utils.formatError(err), 'error');
      return;
    }

    const { fields, customers } = deps;
    if (!fields.length) {
      window.utils.toast('يجب إضافة أرضية واحدة على الأقل قبل إنشاء الحجوزات', 'warning');
      return;
    }

    const editing = !!booking;
    const fieldIdValue = booking ? booking.field_id : (defaultFieldId || (fields[0] && fields[0].id));

    // التاريخ المبدئي
    const defaultDateSource = booking ? booking.start_time : (defaultStart || new Date());
    const initialDate = toLocalDateString(defaultDateSource);

    // قيمة start_time/end_time الأولية في الحالة editing
    const initialStart = booking ? new Date(booking.start_time).toISOString() : '';
    const initialEnd = booking ? new Date(booking.end_time).toISOString() : '';

    const isPending = editing && booking.status === 'pending';
    const hasNameMismatch = isPending && booking.customer_input_name &&
      booking.customers && booking.customers.full_name &&
      booking.customer_input_name.trim() !== booking.customers.full_name.trim();

    const pendingBanner = isPending
      ? `<div style="background:var(--color-warning-light);color:var(--color-warning);padding:10px 14px;border-radius:var(--radius);margin-bottom:16px;font-weight:600">
           ⏳ هذا الحجز بانتظار موافقتك
         </div>`
      : '';

    const nameMismatchBanner = hasNameMismatch
      ? `<div style="background:var(--color-info-light);color:var(--color-info);padding:12px 14px;border-radius:var(--radius);margin-bottom:16px;font-size:0.95rem">
           <strong>تنبيه:</strong> هذا الرقم مسجّل سابقاً باسم
           "<strong>${window.utils.escapeHtml(booking.customers.full_name)}</strong>"،
           لكن العميل أدخل في الحجز اسم "<strong>${window.utils.escapeHtml(booking.customer_input_name)}</strong>".
           <br>عند التأكيد، سيُسأل عن الاسم الذي تريد اعتماده.
         </div>`
      : '';

    const body = document.createElement('div');
    body.innerHTML = `
      ${pendingBanner}
      ${nameMismatchBanner}
      <form id="booking-form" autocomplete="off">
        <div class="form-row cols-2">
          <div class="form-group">
            <label class="form-label">الأرضية <span class="required">*</span></label>
            <select class="form-control" name="field_id" required>
              ${fields.map((f) => `<option value="${f.id}" ${f.id === fieldIdValue ? 'selected' : ''}>${window.utils.escapeHtml(f.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">الحالة</label>
            <select class="form-control" name="status">
              ${editing && booking.status === 'pending' ? '<option value="pending" selected>بانتظار الموافقة</option>' : ''}
              <option value="confirmed" ${editing && booking.status === 'confirmed' ? 'selected' : ''}>مؤكد</option>
              <option value="completed" ${editing && booking.status === 'completed' ? 'selected' : ''}>مكتمل</option>
              <option value="cancelled" ${editing && booking.status === 'cancelled' ? 'selected' : ''}>ملغي</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">التاريخ <span class="required">*</span></label>
          <input type="date" class="form-control" name="booking_date" required value="${initialDate}">
        </div>

        <div class="form-group">
          <label class="form-label">الموعد <span class="required">*</span></label>
          <div id="slots-area" class="slot-empty">اختر الأرضية والتاريخ لعرض المواعيد المتاحة...</div>
          <input type="hidden" name="start_time" value="${initialStart}">
          <input type="hidden" name="end_time" value="${initialEnd}">
        </div>

        <div class="form-group">
          <label class="form-label">العميل <span class="required">*</span></label>
          <div class="combobox" id="customer-combobox">
            <input type="text" class="form-control" id="customer-search" placeholder="ابحث عن عميل أو اكتب لإضافة جديد..." autocomplete="off">
            <input type="hidden" name="customer_id" id="customer-id">
            <div class="combobox-list" id="customer-list"></div>
          </div>
          <div id="new-customer-fields" class="hidden mt-md" style="background:var(--color-info-light);padding:12px;border-radius:var(--radius)">
            <div class="form-row cols-2">
              <div class="form-group" style="margin:0">
                <label class="form-label">اسم العميل الجديد <span class="required">*</span></label>
                <input type="text" class="form-control" name="new_customer_name">
              </div>
              <div class="form-group" style="margin:0">
                <label class="form-label">رقم الجوال <span class="required">*</span></label>
                <input type="tel" class="form-control" name="new_customer_phone">
              </div>
            </div>
          </div>
        </div>

        <div class="form-row cols-2">
          <div class="form-group">
            <label class="form-label">السعر الإجمالي (ر.س) <span class="required">*</span></label>
            <input type="number" class="form-control" name="total_price" min="0" step="0.01" required value="${editing ? booking.total_price : ''}">
            <span class="form-help" id="price-help">يُحسب تلقائياً من السعر/ساعة × المدة</span>
          </div>
          <div class="form-group">
            <label class="form-label">المدفوع (ر.س)</label>
            <input type="number" class="form-control" name="paid_amount" min="0" step="0.01" value="${editing ? booking.paid_amount : '0'}">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">ملاحظات</label>
          <textarea class="form-control" name="notes" rows="2">${editing ? window.utils.escapeHtml(booking.notes || '') : ''}</textarea>
        </div>
      </form>
    `;

    const footerEl = document.createElement('div');
    if (isPending) {
      footerEl.innerHTML = `
        <button type="button" class="btn btn--danger" id="reject-booking-btn">رفض الحجز</button>
        <div style="flex:1"></div>
        <button type="button" class="btn btn--ghost" data-action="close">إغلاق</button>
        <button type="button" class="btn btn--primary" id="approve-booking-btn"><i data-lucide="check"></i> تأكيد الحجز</button>
      `;
    } else {
      footerEl.innerHTML = `
        ${editing ? '<button type="button" class="btn btn--danger" id="cancel-booking-btn">إلغاء الحجز</button>' : ''}
        <div style="flex:1"></div>
        <button type="button" class="btn btn--ghost" data-action="close">إغلاق</button>
        <button type="submit" class="btn btn--primary" form="booking-form">${editing ? 'حفظ التعديلات' : 'إنشاء الحجز'}</button>
      `;
    }
    footerEl.style.display = 'flex';
    footerEl.style.gap = '8px';
    footerEl.style.width = '100%';

    const ctrl = window.utils.openModal({
      title: editing ? 'تعديل حجز' : 'حجز جديد',
      body,
      footer: footerEl
    });

    const form = ctrl.modal.querySelector('#booking-form');
    const fieldSelect = form.field_id;
    const dateInput = form.booking_date;
    const startInput = form.start_time;
    const endInput = form.end_time;
    const priceInput = form.total_price;
    const paidInput = form.paid_amount;
    const slotsArea = ctrl.modal.querySelector('#slots-area');
    const customerSearch = ctrl.modal.querySelector('#customer-search');
    const customerIdInput = ctrl.modal.querySelector('#customer-id');
    const customerList = ctrl.modal.querySelector('#customer-list');
    const combobox = ctrl.modal.querySelector('#customer-combobox');
    const newCustomerFields = ctrl.modal.querySelector('#new-customer-fields');

    // تعبئة العميل عند التعديل
    if (editing && booking.customers) {
      customerSearch.value = `${booking.customers.full_name} (${booking.customers.phone})`;
      customerIdInput.value = booking.customers.id;
    }

    // إدارة المواعيد (slots) - السعر يأتي من slot المختار
    let priceManuallyEdited = editing;
    priceInput.addEventListener('input', () => {
      priceManuallyEdited = true;
    });

    function pickSlot(startIso, endIso, slotPrice, btn) {
      startInput.value = startIso;
      endInput.value = endIso;
      slotsArea.querySelectorAll('.slot-btn').forEach((b) => b.classList.remove('selected'));
      if (btn) btn.classList.add('selected');
      if (!priceManuallyEdited && slotPrice !== null && slotPrice !== undefined) {
        priceInput.value = Number(slotPrice).toFixed(2);
      }
    }

    async function refreshSlots() {
      const fieldId = fieldSelect.value;
      const dateStr = dateInput.value;
      if (!fieldId || !dateStr) {
        slotsArea.className = 'slot-empty';
        slotsArea.textContent = 'اختر الأرضية والتاريخ لعرض المواعيد المتاحة...';
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

    function renderSlots(slots) {
      // إذا كنا في وضع تعديل وحجزنا الحالي لا يطابق slot موجود، نضيف خياراً خاصاً
      const currentStartIso = editing ? new Date(booking.start_time).toISOString() : null;
      const currentEndIso = editing ? new Date(booking.end_time).toISOString() : null;
      const hasCurrentSlot = slots.some(
        (s) => new Date(s.slot_start).toISOString() === currentStartIso
      );

      if (!slots.length) {
        slotsArea.className = 'slot-empty';
        slotsArea.textContent = 'لا توجد مواعيد متاحة لهذه الأرضية في هذا التاريخ.';
        return;
      }

      slotsArea.className = '';
      const grid = document.createElement('div');
      grid.className = 'slot-grid';

      if (editing && currentStartIso && !hasCurrentSlot) {
        const customBtn = document.createElement('button');
        customBtn.type = 'button';
        customBtn.className = 'slot-btn selected';
        customBtn.innerHTML = `
          <div class="slot-time">${window.utils.formatTime(booking.start_time)} → ${window.utils.formatTime(booking.end_time)}</div>
          <div class="slot-status">الموعد الحالي</div>
        `;
        customBtn.addEventListener('click', () => pickSlot(currentStartIso, currentEndIso, null, customBtn));
        grid.appendChild(customBtn);
      }

      slots.forEach((s) => {
        const startIso = new Date(s.slot_start).toISOString();
        const endIso = new Date(s.slot_end).toISOString();
        const slotPrice = s.slot_price !== undefined ? Number(s.slot_price) : null;
        const isSelected = editing && startIso === currentStartIso;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'slot-btn';
        if (isSelected) btn.classList.add('selected');
        if (!s.is_available && !isSelected) btn.classList.add('is-busy');
        if (s.is_past) btn.classList.add('is-past');
        btn.disabled = (!s.is_available || s.is_past) && !isSelected;

        let statusLabel = '';
        if (s.is_past) statusLabel = 'انتهى';
        else if (!s.is_available) statusLabel = 'محجوز';
        else statusLabel = slotPrice ? window.utils.formatCurrency(slotPrice) : 'متاح';

        btn.innerHTML = `
          <div class="slot-time">${window.utils.formatTime(s.slot_start)} → ${window.utils.formatTime(s.slot_end)}</div>
          <div class="slot-status">${statusLabel}</div>
        `;
        btn.addEventListener('click', () => pickSlot(startIso, endIso, slotPrice, btn));
        grid.appendChild(btn);
      });

      slotsArea.innerHTML = '';
      slotsArea.appendChild(grid);
    }

    fieldSelect.addEventListener('change', () => {
      if (!editing) {
        startInput.value = '';
        endInput.value = '';
      }
      refreshSlots();
    });
    dateInput.addEventListener('change', () => {
      if (!editing) {
        startInput.value = '';
        endInput.value = '';
      }
      refreshSlots();
    });

    // تحميل أولي
    refreshSlots();

    // combobox العملاء
    let selectedNewCustomer = false;

    function renderCustomerList(query) {
      const q = query.trim().toLowerCase();
      const matches = q
        ? customers.filter(
            (c) =>
              c.full_name.toLowerCase().includes(q) || c.phone.includes(q)
          )
        : customers.slice(0, 50);

      let html = matches
        .map(
          (c) => `
        <div class="combobox-item" data-id="${c.id}" data-name="${window.utils.escapeHtml(c.full_name)}" data-phone="${window.utils.escapeHtml(c.phone)}">
          <div><strong>${window.utils.escapeHtml(c.full_name)}</strong></div>
          <div class="item-sub">${window.utils.escapeHtml(c.phone)}</div>
        </div>
      `
        )
        .join('');

      if (q) {
        html += `
          <div class="combobox-item create-new" data-action="create">
            + إضافة عميل جديد باسم "${window.utils.escapeHtml(query)}"
          </div>
        `;
      }
      customerList.innerHTML = html;

      customerList.querySelectorAll('.combobox-item').forEach((el) => {
        el.addEventListener('click', () => {
          if (el.dataset.action === 'create') {
            selectedNewCustomer = true;
            customerIdInput.value = '';
            customerSearch.value = query;
            newCustomerFields.classList.remove('hidden');
            const nameInput = newCustomerFields.querySelector('[name="new_customer_name"]');
            nameInput.value = query;
            nameInput.required = true;
            newCustomerFields.querySelector('[name="new_customer_phone"]').required = true;
          } else {
            selectedNewCustomer = false;
            customerIdInput.value = el.dataset.id;
            customerSearch.value = `${el.dataset.name} (${el.dataset.phone})`;
            newCustomerFields.classList.add('hidden');
          }
          combobox.classList.remove('open');
        });
      });
    }

    customerSearch.addEventListener('focus', () => {
      combobox.classList.add('open');
      renderCustomerList(customerSearch.value);
    });
    customerSearch.addEventListener('input', () => {
      customerIdInput.value = '';
      selectedNewCustomer = false;
      newCustomerFields.classList.add('hidden');
      combobox.classList.add('open');
      renderCustomerList(customerSearch.value);
    });
    document.addEventListener('click', (e) => {
      if (!combobox.contains(e.target)) combobox.classList.remove('open');
    });

    // تقديم النموذج
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const startTime = fd.get('start_time');
      const endTime = fd.get('end_time');
      const fieldId = fd.get('field_id');
      const totalPrice = parseFloat(fd.get('total_price'));
      const paidAmount = parseFloat(fd.get('paid_amount')) || 0;
      const notes = fd.get('notes').trim() || null;
      const status = fd.get('status') || 'confirmed';

      if (!startTime || !endTime) {
        window.utils.toast('اختر موعداً من القائمة', 'error');
        return;
      }
      if (new Date(endTime) <= new Date(startTime)) {
        window.utils.toast('وقت النهاية يجب أن يكون بعد البداية', 'error');
        return;
      }
      if (paidAmount > totalPrice) {
        window.utils.toast('المبلغ المدفوع لا يمكن أن يتجاوز الإجمالي', 'error');
        return;
      }

      // إنشاء عميل جديد إذا لزم
      let customerId = customerIdInput.value;
      if (!customerId && selectedNewCustomer) {
        const newName = fd.get('new_customer_name').trim();
        const newPhone = fd.get('new_customer_phone').trim();
        if (!newName || !newPhone) {
          window.utils.toast('أكمل بيانات العميل الجديد', 'error');
          return;
        }
        try {
          const newCustomer = await window.api.createCustomer({ full_name: newName, phone: newPhone });
          customerId = newCustomer.id;
          // بطّل cache العملاء بحيث يلتقط العميل الجديد في أي مكان آخر
          if (window.store) window.store.invalidate('customers:all');
        } catch (err) {
          window.utils.toast(window.utils.formatError(err), 'error');
          return;
        }
      }

      if (!customerId) {
        window.utils.toast('اختر عميلاً أو أضف عميلاً جديداً', 'error');
        return;
      }

      const payload = {
        field_id: fieldId,
        customer_id: customerId,
        start_time: new Date(startTime).toISOString(),
        end_time: new Date(endTime).toISOString(),
        total_price: totalPrice,
        paid_amount: paidAmount,
        status,
        notes
      };

      try {
        let saved;
        if (editing) {
          saved = await window.api.updateBooking(booking.id, payload);
          window.utils.toast('تم تحديث الحجز', 'success');
        } else {
          saved = await window.api.createBooking(payload);
          window.utils.toast('تم إنشاء الحجز', 'success');
        }
        ctrl.close();
        if (typeof onSaved === 'function') onSaved(saved);
      } catch (err) {
        window.utils.toast(window.utils.formatError(err), 'error');
      }
    });

    // زر إلغاء الحجز (في وضع التعديل العادي، غير pending)
    if (editing && !isPending) {
      const cancelBtn = ctrl.modal.querySelector('#cancel-booking-btn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', async () => {
          const ok = await window.utils.confirm({
            title: 'إلغاء الحجز',
            message: 'هل أنت متأكد من إلغاء هذا الحجز؟',
            confirmText: 'تأكيد الإلغاء',
            danger: true
          });
          if (!ok) return;
          try {
            const saved = await window.api.cancelBooking(booking.id);
            window.utils.toast('تم إلغاء الحجز', 'success');
            ctrl.close();
            if (typeof onSaved === 'function') onSaved(saved);
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
          }
        });
      }
    }

    // أزرار الموافقة/الرفض للحجوزات المعلقة
    if (isPending) {
      ctrl.modal.querySelector('#approve-booking-btn').addEventListener('click', async () => {
        // لو فيه تباين أسماء، نسأل الموظف أولاً
        if (hasNameMismatch) {
          openNameChoiceDialog(booking, async (useNewName) => {
            try {
              const saved = await window.api.approveBooking(booking.id, { useNewName });
              window.utils.toast('تم تأكيد الحجز', 'success');
              ctrl.close();
              if (typeof onSaved === 'function') onSaved(saved);
            } catch (err) {
              window.utils.toast(window.utils.formatError(err), 'error');
            }
          });
          return;
        }
        // الموافقة المباشرة
        try {
          const saved = await window.api.approveBooking(booking.id, { useNewName: false });
          window.utils.toast('تم تأكيد الحجز', 'success');
          ctrl.close();
          if (typeof onSaved === 'function') onSaved(saved);
        } catch (err) {
          window.utils.toast(window.utils.formatError(err), 'error');
        }
      });

      ctrl.modal.querySelector('#reject-booking-btn').addEventListener('click', async () => {
        const ok = await window.utils.confirm({
          title: 'رفض الحجز',
          message: 'هل أنت متأكد من رفض هذا الحجز؟ سيتحرر الموعد للحجوزات الأخرى.',
          confirmText: 'تأكيد الرفض',
          danger: true
        });
        if (!ok) return;
        try {
          const saved = await window.api.rejectBooking(booking.id);
          window.utils.toast('تم رفض الحجز', 'success');
          ctrl.close();
          if (typeof onSaved === 'function') onSaved(saved);
        } catch (err) {
          window.utils.toast(window.utils.formatError(err), 'error');
        }
      });
    }

    ctrl.modal.querySelector('[data-action="close"]').addEventListener('click', ctrl.close);
  }

  // dialog فرعي لاختيار الاسم عند الموافقة على حجز فيه تباين أسماء
  function openNameChoiceDialog(booking, onChoice) {
    const oldName = window.utils.escapeHtml(booking.customers.full_name);
    const newName = window.utils.escapeHtml(booking.customer_input_name);
    const body = `
      <p style="margin-bottom:16px">هذا الرقم مسجّل سابقاً باسم مختلف. أي اسم تريد اعتماده؟</p>
      <div style="display:flex;flex-direction:column;gap:12px">
        <button type="button" class="btn btn--secondary" data-choice="old" style="text-align:start;justify-content:flex-start;padding:14px">
          <div>
            <div style="font-weight:700;margin-bottom:4px">استخدام الاسم القديم</div>
            <div class="text-muted" style="font-size:0.9rem">${oldName}</div>
          </div>
        </button>
        <button type="button" class="btn btn--primary" data-choice="new" style="text-align:start;justify-content:flex-start;padding:14px">
          <div>
            <div style="font-weight:700;margin-bottom:4px">تحديث الاسم إلى الجديد</div>
            <div style="font-size:0.9rem;opacity:0.9">${newName}</div>
          </div>
        </button>
      </div>
    `;
    const footer = `<button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>`;
    const ctrl = window.utils.openModal({
      title: 'اختيار اسم العميل',
      body,
      footer
    });
    ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
    ctrl.modal.querySelectorAll('[data-choice]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const choice = btn.dataset.choice;
        ctrl.close();
        onChoice(choice === 'new');
      });
    });
  }

  return { open };
})();
