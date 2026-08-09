// نافذة «حجب موعد» — تُخفي مواعيد من صفحة الحجز العامة.
//
// كانت تسكن داخل صفحة التقويم، وهي لا تحتاج منها شيئاً: لا شبكة ولا كائن
// FullCalendar ولا حالة عرض. تطلب الأرضية والتاريخ والمواعيد من داخلها،
// فنتيجتها واحدة سواء فُتحت من تقويم أو من قائمة. وحَجب موعدٍ فعلٌ إداريّ
// على البيانات لا فعل مشاهدة، فموضعه حيث تُدار الحجوزات.
//
//   window.blockSlotModal.open({
//     fields,                    // مصفوفة الأرضيات (مطلوبة)
//     fieldId, date,             // اختياري — قيم مبدئية
//     onBlocked: () => refresh() // بعد نجاح الحجب
//   });

window.blockSlotModal = (function () {
  // تاريخ محلي YYYY-MM-DD (لا UTC — الحجب يقع بتوقيت الملعب)
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

  function open(opts) {
    const { fields = [], fieldId: presetFieldId, date: presetDate, onBlocked } = opts || {};

    const active = fields.filter((f) => f.is_active !== false);
    const choices = active.length ? active : fields;
    if (!choices.length) {
      window.utils.toast('أضف أرضية واحدة على الأقل أولاً', 'warning');
      return null;
    }

    const today = toLocalDate(new Date());
    const body = `
      <form id="block-form" autocomplete="off">
        <div class="form-row cols-2">
          <div class="form-group">
            <label class="form-label">الأرضية <span class="required">*</span></label>
            <select class="form-control" name="field_id" required>
              ${choices.map((f) => `<option value="${f.id}">${window.utils.escapeHtml(f.name)}</option>`).join('')}
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
            if (window.native) window.native.haptic('LIGHT');
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
      const fid = fieldSel.value;
      const dateStr = dateInput.value;
      if (!fid || !dateStr) {
        slotsArea.className = 'slot-empty';
        slotsArea.textContent = 'اختر الأرضية والتاريخ لعرض المواعيد…';
        return;
      }
      slotsArea.className = 'slot-empty';
      slotsArea.innerHTML = '<div class="loader"></div>';
      try {
        const slots = await window.api.getAvailableSlots(fid, dateStr);
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
      const fid = fieldSel.value;
      const notes = notesInput.value.trim() || null;
      const ranges = mergeContiguous([...selected.values()]);
      const n = selected.size;
      confirmBtn.disabled = true;
      try {
        for (const r of ranges) {
          await window.api.createBlock({ field_id: fid, start_time: r.start, end_time: r.end, notes });
        }
        window.utils.toast(n > 1 ? `تم حجب ${n} مواعيد` : 'تم حجب الموعد', 'success');
        ctrl.close();
        if (typeof onBlocked === 'function') onBlocked();
      } catch (err) {
        confirmBtn.disabled = false;
        // 23P01 = exclusion constraint — تقاطع مع حجز أو حجب قائم
        const msg = (err && err.code === '23P01')
          ? 'أحد المواعيد يتقاطع مع حجز أو حجب موجود — حدّث القائمة'
          : window.utils.formatError(err);
        window.utils.toast(msg, 'error');
      }
    });

    return ctrl;
  }

  return { open };
})();
