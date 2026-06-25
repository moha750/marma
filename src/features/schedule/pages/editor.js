// أيام وفترات العمل — بطاقات أيام + مفتاح فتح/إغلاق، والتحرير عبر نافذة منبثقة تتحقّق من التداخل قبل الحفظ.
// المبدأ: لا يُحفظ يومٌ فيه فترتان متداخلتان أو وقت ناقص — النافذة لا تُغلق على حالة فاسدة. للمالك فقط (الموظّف: قراءة).

(function () {
  const TEMPLATE = `
    <div class="page-header">
      <div>
        <h2>أيام وفترات العمل</h2>
        <div class="page-subtitle">حدّد أوقات كل أرضية ومدة الموعد وسعره</div>
      </div>
      <div class="actions" id="sch-actions"></div>
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
  const NEW_PERIOD = () => ({ open: '16:00', close: '23:00', duration: 60, price: 0 });

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
  function addMinutes(t, mins) {
    let [h, m] = t.split(':').map(Number);
    let tot = ((h * 60 + m + mins) % 1440 + 1440) % 1440;
    return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
  }
  const openMin = (p) => { const [h, m] = (p.open || '0:0').split(':').map(Number); return h * 60 + m; };
  // ترتيب الفترات حسب تسلسل التشغيل الفعلي (يدعم الامتداد بعد منتصف الليل):
  // نرتّب بوقت البدء ثم نُدوّر القائمة لتبدأ من الفترة التي تلي أطول فجوة — أي بداية جلسة العمل،
  // فلا تقفز فترة ما بعد منتصف الليل إلى المقدمة.
  function sortPeriods(periods) {
    const list = periods.map((p) => ({ ...p }));
    if (list.length <= 1 || list.some((p) => !isValidTimes(p))) {
      return list.sort((a, b) => (a.open || '').localeCompare(b.open || ''));
    }
    list.sort((a, b) => openMin(a) - openMin(b));
    let maxGap = -1, rot = 0;
    for (let i = 0; i < list.length; i++) {
      const nextIdx = (i + 1) % list.length;
      const gap = openMin(list[nextIdx]) + (nextIdx === 0 ? 1440 : 0) - openMin(list[i]);
      if (gap > maxGap) { maxGap = gap; rot = nextIdx; }
    }
    return list.slice(rot).concat(list.slice(0, rot));
  }

  function slotInfo(p) {
    if (!isValidTimes(p)) return { valid: false, count: 0, overnight: false };
    const [start, end] = toMinuteRange(p);
    const overnight = end - start > 0 && (p.close <= p.open);
    const count = Math.floor((end - start) / (Number(p.duration) || 60));
    return { valid: true, count, overnight };
  }

  function periodHint(p) {
    const info = slotInfo(p);
    if (!info.valid)
      return `<span class="sch-hint sch-hint--bad"><i data-lucide="triangle-alert"></i> أدخل وقتين مختلفين</span>`;
    if (info.count <= 0)
      return `<span class="sch-hint sch-hint--bad"><i data-lucide="triangle-alert"></i> الفترة أقصر من مدة الموعد</span>`;
    const word = info.count === 1 ? 'موعد' : info.count === 2 ? 'موعدان' : (info.count <= 10 ? 'مواعيد' : 'موعداً');
    const moon = info.overnight
      ? `<span class="sch-hint sch-hint--moon"><i data-lucide="moon"></i> يمتد لليوم التالي</span>`
      : '';
    return `<span class="sch-hint"><i data-lucide="calendar-check"></i> ${info.count} ${word}</span>${moon}`;
  }

  // السعر ثابت لكل موعد: «سعر ثابت» (رقم ≥ 0، و0 = مجاني) أو «عند التواصل» (null)
  function parseAmount(raw) {
    const n = parseFloat(String(raw == null ? '' : raw).trim());
    return isNaN(n) ? 0 : Math.max(0, n);
  }
  function priceInputVal(v) { return v == null ? '' : v; }
  function priceControlHtml(price) {
    const isContact = price == null;
    return `
      <select class="form-control sch-price-mode" data-f="price-mode">
        <option value="fixed" ${isContact ? '' : 'selected'}>سعر ثابت</option>
        <option value="contact" ${isContact ? 'selected' : ''}>عند التواصل</option>
      </select>
      <div class="input-group sch-price-amt"${isContact ? ' hidden' : ''}>
        <input type="number" min="0" step="0.01" class="form-control" data-f="price" value="${priceInputVal(price)}" placeholder="0 = مجاني">
        <span class="input-addon">ر.س</span>
      </div>`;
  }

  const page = {
    async mount(container, ctx) {
      container.innerHTML = TEMPLATE;
      const isOwner = ctx.profile.role === 'owner';
      const root = container.querySelector('#schedule-container');
      const fieldsHref = window.utils.path('/fields');
      const esc = (v) => window.utils.escapeHtml(v);
      const fmtT = (v) => window.utils.formatTimeOfDay(v);
      const dayName = (dow) => (DAYS.find((d) => d.dow === dow) || {}).name || '';

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
            open: (r.open_time || '').substring(0, 5),
            close: (r.close_time || '').substring(0, 5),
            duration: Number(r.slot_duration_minutes) || 60,
            price: (r.hourly_price === null || r.hourly_price === undefined) ? null : (Number(r.hourly_price) || 0)
          });
        });
        Object.keys(periodsByDay).forEach((dow) => {
          periodsByDay[dow] = sortPeriods(periodsByDay[dow]);
        });
      }

      // حفظ يوم بعد التحقّق — يُعيد {ok} أو {ok:false, error}
      async function saveDay(dow, periods) {
        if (periods.some((p) => !isValidTimes(p))) return { ok: false, error: 'أكمل وقتَي كل فترة (مختلفين)' };
        if (periods.some((p) => slotInfo(p).count <= 0)) return { ok: false, error: 'هناك فترة أقصر من مدة الموعد' };
        if (detectOverlap(periods)) return { ok: false, error: 'فترتان متداخلتان في نفس اليوم — صحّح قبل الحفظ' };
        try {
          const sorted = sortPeriods(periods);
          await window.api.setDayPeriods(selectedFieldId, dow, sorted);
          periodsByDay[dow] = sorted;
          return { ok: true };
        } catch (err) { return { ok: false, error: window.utils.formatError(err) }; }
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
              <p class="text-danger">${esc(window.utils.formatError(err))}</p>
            </div></div>`;
          window.utils.renderIcons(root);
        }
      }

      function render() {
        root.innerHTML = `
          <div class="chip-rail mb-md" id="sch-fields">
            ${fields.map((f) => `
              <button class="chip ${f.id === selectedFieldId ? 'is-active' : ''}" data-field-id="${f.id}">
                <i data-lucide="goal" style="width:12px;height:12px"></i>
                <span>${esc(f.name)}</span>
                ${!f.is_active ? '<span class="text-tertiary text-xs">معطّلة</span>' : ''}
              </button>`).join('')}
          </div>
          <div class="sch-summary" id="sch-summary"></div>
          <div class="sch-week" id="sch-week"></div>
        `;

        const acts = container.querySelector('#sch-actions');
        if (acts) {
          acts.innerHTML = isOwner ? `<button class="btn btn--ghost" id="sch-apply-all"><i data-lucide="copy-check"></i> تطبيق على كل الأيام</button>` : '';
          const ab = acts.querySelector('#sch-apply-all');
          if (ab) ab.addEventListener('click', openApplyAllModal);
          window.utils.renderIcons(acts);
        }

        root.querySelectorAll('#sch-fields [data-field-id]').forEach((chip) => {
          chip.addEventListener('click', async () => {
            if (chip.dataset.fieldId === selectedFieldId) return;
            selectedFieldId = chip.dataset.fieldId;
            root.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
            try { await loadPeriodsForField(); if (alive) render(); }
            catch (err) { window.utils.toast(window.utils.formatError(err), 'error'); }
          });
        });

        bindWeek(root.querySelector('#sch-week'));
        renderWeek();
        updateSummary();
        window.utils.renderIcons(root);
      }

      function updateSummary() {
        const el = root.querySelector('#sch-summary');
        if (!el) return;
        const total = Object.values(periodsByDay).reduce((s, a) => s + a.length, 0);
        const open = Object.values(periodsByDay).filter((a) => a.length).length;
        el.innerHTML = open === 0
          ? `<i data-lucide="info"></i> كل الأيام مغلقة`
          : `<i data-lucide="info"></i> <b>${open}</b> ${open === 1 ? 'يوم مفتوح' : 'أيام مفتوحة'} · <b>${total}</b> ${total === 1 ? 'فترة' : 'فترات'}`;
        window.utils.renderIcons(el);
      }

      function lineHtml(p) {
        return `<span class="sch-line">
          <i data-lucide="clock"></i>
          <span class="sch-line-time"><bdi>${esc(fmtT(p.open))}</bdi> – <bdi>${esc(fmtT(p.close))}</bdi></span>
          <span class="sch-line-sep">·</span>
          <span class="sch-line-dur">${formatDuration(p.duration)}</span>
          <span class="sch-price">${esc(window.utils.formatPrice(p.price))}</span>
        </span>`;
      }

      function buildDayCard(day) {
        const dow = day.dow;
        const periods = periodsByDay[dow] || [];
        const isOpen = periods.length > 0;
        const el = document.createElement('div');
        el.className = ['sch-day', isOpen ? 'is-open' : 'is-closed'].join(' ');
        el.dataset.dow = dow;
        el.innerHTML = `
          <div class="sch-day-head">
            ${isOwner ? `
              <label class="sch-switch" title="${isOpen ? 'مفتوح' : 'مغلق'}">
                <input type="checkbox" data-toggle ${isOpen ? 'checked' : ''}>
                <span class="sch-switch-track"></span>
              </label>` : ''}
            <span class="sch-day-name">${day.name}</span>
            <span class="status-badge ${isOpen ? 'status-badge--active' : 'status-badge--muted'}">${isOpen ? 'مفتوح' : 'مغلق'}</span>
            ${!isOpen ? `<span class="sch-closed-label"><i data-lucide="moon-star"></i> لا مواعيد حجز</span>` : ''}
          </div>
          ${isOpen ? `<div class="sch-day-body">${periods.map(lineHtml).join('')}</div>` : ''}
          ${isOwner && isOpen ? `
            <div class="sch-day-acts">
              <button class="btn btn--ghost btn--sm" data-edit title="تعديل فترات اليوم"><i data-lucide="pencil"></i> تعديل</button>
              <button class="btn btn--ghost btn--sm" data-copy title="نسخ هذا اليوم لأيام"><i data-lucide="copy"></i> نسخ</button>
            </div>` : ''}`;
        return el;
      }

      function renderWeek() {
        const week = root.querySelector('#sch-week');
        if (!week) return;
        week.innerHTML = '';
        DAYS.forEach((d) => week.appendChild(buildDayCard(d)));
        window.utils.renderIcons(week);
      }

      function bindWeek(week) {
        if (!week) return;
        week.addEventListener('change', (e) => {
          const tg = e.target.closest('[data-toggle]');
          if (tg) toggleDay(+tg.closest('.sch-day').dataset.dow, tg.checked);
        });
        week.addEventListener('click', (e) => {
          const ed = e.target.closest('[data-edit]');
          if (ed) { openDayModal(+ed.closest('.sch-day').dataset.dow); return; }
          const cp = e.target.closest('[data-copy]');
          if (cp) { openCopyModal(+cp.closest('.sch-day').dataset.dow); return; }
        });
      }

      // ─── المفتاح: فتح/إغلاق اليوم ───
      function toggleDay(dow, open) {
        if (open) {
          // فتح يوم مغلق عبر نافذة؛ الإلغاء يُعيد المفتاح مغلقاً
          openDayModal(dow, {
            seed: true,
            onCancel: () => { const t = root.querySelector(`.sch-day[data-dow="${dow}"] [data-toggle]`); if (t) t.checked = false; }
          });
        } else {
          closeDay(dow);
        }
      }

      async function closeDay(dow) {
        const revert = () => { const t = root.querySelector(`.sch-day[data-dow="${dow}"] [data-toggle]`); if (t) t.checked = true; };
        if (periodsByDay[dow].length) {
          const ok = await window.utils.confirm({
            title: `إغلاق ${dayName(dow)}`,
            message: `سيُغلق اليوم وتُحذف فتراته (${periodsByDay[dow].length}). متابعة؟`,
            confirmText: 'إغلاق', danger: true
          });
          if (!ok) { revert(); return; }
        }
        const res = await saveDay(dow, []);
        if (!res.ok) { window.utils.toast(res.error, 'error'); revert(); return; }
        window.utils.toast(`تم إغلاق ${dayName(dow)}`, 'success');
        renderWeek();
        updateSummary();
      }

      // ─── نافذة تحرير اليوم (إضافة/تعديل/حذف فترات + تحقّق قبل الحفظ) ───
      function openDayModal(dow, opts) {
        opts = opts || {};
        const day = DAYS.find((d) => d.dow === dow);
        let working = (!opts.seed && periodsByDay[dow].length)
          ? periodsByDay[dow].map((p) => ({ ...p }))
          : [NEW_PERIOD()];
        let submitted = false;

        const winHtml = (p, idx) => `
          <div class="sch-win" data-idx="${idx}">
            <div class="sch-win-top">
              <span class="sch-win-title"><i data-lucide="clock"></i> الفترة ${idx + 1}</span>
              <button type="button" class="sch-win-del" data-del title="حذف الفترة"><i data-lucide="trash-2"></i> حذف</button>
            </div>
            <div class="form-row cols-2">
              <div class="form-group"><label class="form-label">من</label>
                <input type="time" class="form-control" data-f="open" value="${p.open}"></div>
              <div class="form-group"><label class="form-label">إلى</label>
                <input type="time" class="form-control" data-f="close" value="${p.close}"></div>
            </div>
            <div class="form-row cols-2">
              <div class="form-group"><label class="form-label">مدة الموعد</label>
                <select class="form-control" data-f="duration">
                  ${DURATION_OPTS.map((m) => `<option value="${m}" ${m === p.duration ? 'selected' : ''}>${formatDuration(m)}</option>`).join('')}
                </select></div>
              <div class="form-group"><label class="form-label">سعر الموعد</label>${priceControlHtml(p.price)}</div>
            </div>
            <div class="sch-win-hint">${periodHint(p)}</div>
          </div>`;
        const bodyHtml = () => `
          <div id="day-wins">${working.map(winHtml).join('')}</div>
          <button type="button" class="btn btn--ghost btn--sm btn--block" id="day-add"><i data-lucide="plus"></i> إضافة فترة</button>`;

        const ctrl = window.utils.openModal({
          title: opts.seed ? `فتح ${day.name} — حدّد الفترات` : `${day.name} — فترات العمل`,
          body: bodyHtml(),
          footer: `<button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
                   <button type="button" class="btn btn--primary" id="day-save">حفظ اليوم</button>`,
          onClose: () => { if (!submitted && opts.onCancel) opts.onCancel(); }
        });
        const m = ctrl.modal;

        // اقرأ قيم الحقول إلى working (قبل أي إعادة رسم أو حفظ)
        function readDom() {
          m.querySelectorAll('#day-wins .sch-win').forEach((el) => {
            const w = working[+el.dataset.idx];
            if (!w) return;
            w.open = el.querySelector('[data-f="open"]').value;
            w.close = el.querySelector('[data-f="close"]').value;
            w.duration = parseInt(el.querySelector('[data-f="duration"]').value, 10) || 60;
            const mode = el.querySelector('[data-f="price-mode"]').value;
            w.price = mode === 'contact' ? null : parseAmount(el.querySelector('[data-f="price"]').value);
          });
        }
        function rerenderWins() {
          const box = m.querySelector('#day-wins');
          box.innerHTML = working.map(winHtml).join('');
          window.utils.renderIcons(box);
        }

        // تحديث التلميح الحيّ أثناء الكتابة
        m.addEventListener('input', (e) => {
          if (!e.target.closest('[data-f]')) return;
          const el = e.target.closest('.sch-win');
          readDom();
          const hint = el.querySelector('.sch-win-hint');
          if (hint) { hint.innerHTML = periodHint(working[+el.dataset.idx]); window.utils.renderIcons(hint); }
        });
        // تبديل نوع السعر يُظهر/يُخفي حقل المبلغ
        m.addEventListener('change', (e) => {
          const pm = e.target.closest('[data-f="price-mode"]');
          if (!pm) return;
          const amt = pm.closest('.sch-win').querySelector('.sch-price-amt');
          if (amt) amt.hidden = pm.value !== 'fixed';
          readDom();
        });
        m.querySelector('#day-add').addEventListener('click', () => {
          readDom();
          const last = working[working.length - 1];
          working.push(last ? { open: last.close, close: addMinutes(last.close, 120), duration: last.duration, price: last.price } : NEW_PERIOD());
          rerenderWins();
        });
        m.querySelector('#day-wins').addEventListener('click', (e) => {
          const del = e.target.closest('[data-del]');
          if (!del) return;
          readDom();
          working.splice(+del.closest('.sch-win').dataset.idx, 1);
          if (!working.length) working.push(NEW_PERIOD()); // الإغلاق يكون بالمفتاح لا بحذف آخر فترة
          rerenderWins();
        });

        m.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
        m.querySelector('#day-save').addEventListener('click', async () => {
          readDom();
          // التحقّق يمنع الحفظ والإغلاق على حالة فاسدة (تداخل/وقت ناقص)
          if (working.some((p) => !isValidTimes(p))) { window.utils.toast('أكمل وقتَي كل فترة (مختلفين)', 'error'); return; }
          if (working.some((p) => slotInfo(p).count <= 0)) { window.utils.toast('هناك فترة أقصر من مدة الموعد', 'error'); return; }
          if (detectOverlap(working)) { window.utils.toast('فترتان متداخلتان في نفس اليوم — صحّحها قبل الحفظ', 'error'); return; }
          const btn = m.querySelector('#day-save');
          btn.disabled = true;
          const res = await saveDay(dow, working);
          if (!res.ok) { window.utils.toast(res.error, 'error'); btn.disabled = false; return; }
          submitted = true;
          ctrl.close();
          window.utils.toast(`تم حفظ ${day.name}`, 'success');
          renderWeek();
          updateSummary();
        });

        window.utils.renderIcons(m);
      }

      // ─── نافذة: تطبيق فترة على كل الأيام ───
      function openApplyAllModal() {
        const body = `
          <form id="sch-apply-form" autocomplete="off">
            <div class="form-row cols-2">
              <div class="form-group"><label class="form-label">من الساعة <span class="required">*</span></label>
                <input type="time" class="form-control" name="open" value="16:00" required></div>
              <div class="form-group"><label class="form-label">إلى الساعة <span class="required">*</span></label>
                <input type="time" class="form-control" name="close" value="23:00" required></div>
            </div>
            <div class="form-row cols-2">
              <div class="form-group"><label class="form-label">مدة الموعد</label>
                <select class="form-control" name="duration">
                  ${DURATION_OPTS.map((m) => `<option value="${m}" ${m === 60 ? 'selected' : ''}>${formatDuration(m)}</option>`).join('')}
                </select></div>
              <div class="form-group"><label class="form-label">سعر الموعد</label>${priceControlHtml(0)}</div>
            </div>
            <p class="form-help">سيُستبدل جدول كل أيام الأسبوع بهذه الفترة الواحدة.</p>
          </form>`;
        const footer = `
          <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
          <button type="submit" class="btn btn--primary" form="sch-apply-form">تطبيق على كل الأيام</button>`;
        const ctrl = window.utils.openModal({ title: 'تطبيق فترة على كل الأيام', body, footer });
        const form = ctrl.modal.querySelector('#sch-apply-form');
        ctrl.modal.addEventListener('change', (e) => {
          const pm = e.target.closest('[data-f="price-mode"]');
          if (pm) { const amt = ctrl.modal.querySelector('.sch-price-amt'); if (amt) amt.hidden = pm.value !== 'fixed'; }
        });
        ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const open = form.open.value, close = form.close.value;
          const duration = parseInt(form.duration.value, 10) || 60;
          const mode = form.querySelector('[data-f="price-mode"]').value;
          const price = mode === 'contact' ? null : parseAmount(form.querySelector('[data-f="price"]').value);
          if (!isValidTimes({ open, close })) { window.utils.toast('أدخل وقتين مختلفين', 'error'); return; }
          if (slotInfo({ open, close, duration }).count <= 0) { window.utils.toast('الفترة أقصر من مدة الموعد', 'error'); return; }
          ctrl.close();
          const ok = await window.utils.confirm({
            title: 'تطبيق على كل الأيام',
            message: 'سيُستبدل جدول كل أيام الأسبوع بهذه الفترة الواحدة. متابعة؟',
            confirmText: 'تطبيق'
          });
          if (!ok) return;
          const period = { open, close, duration, price };
          try {
            for (const d of DAYS) {
              await window.api.setDayPeriods(selectedFieldId, d.dow, [period]);
              periodsByDay[d.dow] = [{ ...period }];
            }
            window.utils.toast('تم تطبيق الفترة على كل الأيام', 'success');
            renderWeek();
            updateSummary();
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
            await loadPeriodsForField(); renderWeek(); updateSummary();
          }
        });
        window.utils.renderIcons(ctrl.modal);
      }

      // ─── نافذة: نسخ يوم إلى أيام ───
      function openCopyModal(sourceDow) {
        const source = DAYS.find((d) => d.dow === sourceDow);
        const sourcePeriods = periodsByDay[sourceDow] || [];
        if (!sourcePeriods.length) return;
        const body = `
          <p class="text-muted text-sm mb-md">انسخ فترات <strong class="text-accent">${source.name}</strong>
            (${sourcePeriods.length} ${sourcePeriods.length === 1 ? 'فترة' : 'فترات'}) إلى:</p>
          <div class="sch-copy-days">
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
          const targets = [...ctrl.modal.querySelectorAll('.sch-copy-days input:checked')].map((i) => +i.value);
          if (!targets.length) { window.utils.toast('اختر يوماً واحداً على الأقل', 'error'); return; }
          ctrl.close();
          try {
            for (const dow of targets) {
              const copy = sourcePeriods.map((p) => ({ ...p }));
              await window.api.setDayPeriods(selectedFieldId, dow, copy);
              periodsByDay[dow] = copy;
            }
            window.utils.toast(
              targets.length === 1 ? `تم النسخ إلى يوم ${dayName(targets[0])}` : `تم النسخ إلى ${targets.length} أيام`,
              'success');
            renderWeek();
            updateSummary();
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
            await loadPeriodsForField(); renderWeek(); updateSummary();
          }
        });
        window.utils.renderIcons(ctrl.modal);
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
