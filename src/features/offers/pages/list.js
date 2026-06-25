// صفحة العروض — خصومات/أسعار خاصّة زمنية فوق السعر الأساسي. للمالك فقط.
// كل عرض يستهدف فترات متعدّدة، وكل فترة تحمل ملعبها — فيمكن خلط مواعيد ملاعب مختلفة.
(function () {
  const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const fmtDate = (v) => v ? window.utils.formatDate(v) : null;
  const t5 = (v) => v ? String(v).substring(0, 5) : null;
  const keyOf = (fid, w, o, c) => `${fid || ''}|${w == null ? '' : w}|${o || ''}|${c || ''}`;

  function effectLabel(o) {
    if (o.fixed_price != null) return `سعر ثابت ${window.utils.formatCurrency(o.fixed_price)}`;
    return `خصم ${Number(o.discount_percent)}%`;
  }

  const page = {
    async mount(container, ctx) {
      ctx = ctx || (window.layout && window.layout.getContext()) || {};
      let alive = true, offers = [], fields = [];
      page._cleanup = [() => { alive = false; }];

      container.innerHTML = `
        <div class="page-header">
          <div>
            <h2>العروض</h2>
            <div class="page-subtitle">خصومات وأسعار خاصّة تُطبَّق تلقائيًّا على المواعيد المطابقة</div>
          </div>
          <div class="actions">
            <button class="btn btn--primary" id="add-offer"><i data-lucide="plus"></i> عرض جديد</button>
          </div>
        </div>
        <div id="offers-body"></div>
      `;
      window.utils.renderIcons(container);
      const body = container.querySelector('#offers-body');

      const fieldName = (id) => {
        if (!id) return 'كل الملاعب';
        const f = fields.find((x) => x.id === id);
        return f ? f.name : '—';
      };

      function targetLabel(t) {
        const day = t.weekday != null ? DAYS[t.weekday] : 'كل الأيام';
        const time = (t.start_time || t.end_time) ? ` ${t5(t.start_time) || '…'}–${t5(t.end_time) || '…'}` : '';
        const whole = (t.weekday == null && !t.start_time && !t.end_time) ? 'كل المواعيد' : (day + time);
        return `${fieldName(t.field_id)} · ${whole}`;
      }

      function whenLabel(o) {
        const tg = o.targets || [];
        const base = tg.length ? tg.map(targetLabel).join('، ') : 'كل المواعيد (كل الملاعب)';
        if (o.start_date || o.end_date) {
          return `${base} · ${fmtDate(o.start_date) || '…'} ← ${fmtDate(o.end_date) || '…'}`;
        }
        return base;
      }

      function render() {
        if (!offers.length) {
          body.innerHTML = `<div class="card"><div class="empty-state">
            <div class="empty-icon"><i data-lucide="badge-percent"></i></div>
            <h3>لا عروض بعد</h3><p>أضف عرضًا ليُطبَّق تلقائيًّا على مواعيد الحجز المطابقة.</p>
          </div></div>`;
          window.utils.renderIcons(body);
          return;
        }
        const rows = offers.map((o) => `
          <tr data-id="${o.id}" style="${o.active ? '' : 'opacity:.55'}">
            <td data-label="العرض" class="fw-semibold">${window.utils.escapeHtml(o.label)}</td>
            <td data-label="التأثير">${window.utils.escapeHtml(effectLabel(o))}</td>
            <td data-label="المواعيد">${window.utils.escapeHtml(whenLabel(o))}</td>
            <td data-label="الحالة" class="card-tag">
              <span class="status-badge status-badge--${o.active ? 'active' : 'expired'}">${o.active ? 'مفعّل' : 'متوقّف'}</span>
            </td>
            <td data-label="" class="actions-cell text-end">
              <div class="actions-inline">
                <button class="btn btn--ghost btn--sm" data-edit="${o.id}"><i data-lucide="pencil"></i></button>
                <button class="btn btn--ghost btn--sm" data-toggle="${o.id}">${o.active ? 'إيقاف' : 'تفعيل'}</button>
                <button class="btn btn--danger btn--sm" data-del="${o.id}"><i data-lucide="trash-2"></i></button>
              </div>
            </td>
          </tr>`).join('');
        body.innerHTML = `
          <div class="table-wrapper"><table class="table table--cards">
            <thead><tr><th>العرض</th><th>التأثير</th><th>المواعيد</th><th>الحالة</th><th class="text-end"></th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>`;
        window.utils.renderIcons(body);
        body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openForm(offers.find((o) => o.id === b.dataset.edit))));
        body.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => toggle(b.dataset.toggle)));
        body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => remove(b.dataset.del)));
      }

      async function load() {
        body.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
        try {
          const [offs, targets, flds] = await Promise.all([
            window.api.listOffers(),
            window.api.listOfferTargets(),
            window.api.listFields(true)
          ]);
          if (!alive) return;
          const byOffer = {};
          targets.forEach((t) => { (byOffer[t.offer_id] = byOffer[t.offer_id] || []).push(t); });
          offs.forEach((o) => { o.targets = byOffer[o.id] || []; });
          offers = offs; fields = flds;
          render();
        } catch (err) {
          if (!alive) return;
          body.innerHTML = `<div class="card"><div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert"></i></div><h3>تعذّر التحميل</h3><p>${window.utils.escapeHtml(window.utils.formatError(err))}</p></div></div>`;
          window.utils.renderIcons(body);
        }
      }

      async function toggle(id) {
        const o = offers.find((x) => x.id === id);
        if (!o) return;
        try { await window.api.setOfferActive(id, !o.active); o.active = !o.active; render(); }
        catch (err) { window.utils.toast(window.utils.formatError(err), 'error'); }
      }

      async function remove(id) {
        const o = offers.find((x) => x.id === id);
        const ok = await window.utils.confirm({ title: 'حذف العرض', message: `حذف "${o ? o.label : ''}"؟`, confirmText: 'حذف', danger: true });
        if (!ok) return;
        try { await window.api.deleteOffer(id); window.utils.toast('تم الحذف', 'success'); await load(); }
        catch (err) { window.utils.toast(window.utils.formatError(err), 'error'); }
      }

      async function fetchPeriods(fieldId) {
        const rows = await window.api.listWorkingPeriods(fieldId);
        const seen = new Set(), list = [];
        rows.forEach((r) => {
          const o = t5(r.open_time), c = t5(r.close_time), w = r.day_of_week;
          const k = `${w}|${o}|${c}`;
          const p = (r.hourly_price == null || r.hourly_price === '') ? null : Number(r.hourly_price);
          if (!seen.has(k)) { seen.add(k); list.push({ w, o, c, p }); }
        });
        list.sort((a, b) => (a.w - b.w) || a.o.localeCompare(b.o));
        return list;
      }

      function openForm(existing) {
        const e = existing || {};
        const isEdit = !!existing;
        const kind = e.fixed_price != null ? 'fixed' : 'percent';
        const selectedKeys = new Set((e.targets || []).map((t) =>
          keyOf(t.field_id, t.weekday, t5(t.start_time), t5(t.end_time))));
        // خرائط الأسعار (ر.س للموعد) لمقارنة السعر الثابت بأسعار المواعيد المستهدفة
        const periodPriceByKey = new Map();   // مفتاح فترة محدّدة → سعر الموعد (أو null)
        const fieldPricesById = new Map();    // معرّف ملعب → [أسعار فتراته المعروفة]
        const fieldHasOpenById = new Map();   // معرّف ملعب → هل فيه فترة مفتوحة السعر؟
        const allPrices = [];                 // كل الأسعار المعروفة عبر الملاعب
        let anyOpenAll = false;               // وجود أي موعد مفتوح السعر عبر كل الملاعب

        const body = `
          <form id="offer-form">
            <div class="form-group">
              <label class="form-label" for="o-label">اسم العرض <span class="required">*</span></label>
              <input class="form-control" id="o-label" maxlength="60" required value="${window.utils.escapeHtml(e.label || '')}" placeholder="مثال: عرض شهر رمضان | خصم يوم الجمعة">
            </div>

            <div class="form-row cols-2">
              <div class="form-group">
                <label class="form-label" for="o-kind">نوع العرض</label>
                <select class="form-control" id="o-kind">
                  <option value="percent" ${kind === 'percent' ? 'selected' : ''}>نسبة خصم %</option>
                  <option value="fixed" ${kind === 'fixed' ? 'selected' : ''}>سعر ثابت للموعد</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" for="o-value">القيمة <span class="required">*</span></label>
                <div class="input-group">
                  <input type="number" class="form-control" id="o-value" min="0" step="0.01" required value="${e.fixed_price != null ? e.fixed_price : (e.discount_percent != null ? e.discount_percent : '')}">
                  <span class="input-addon" id="o-addon">${kind === 'fixed' ? 'ر.س' : '%'}</span>
                </div>
                <span class="form-error" id="o-value-err" style="display:none"></span>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">على أي مواعيد؟</label>
              <div id="o-periods" class="offer-periods"><div class="loader"></div></div>
              <span class="form-help">اختر موعدًا واحدًا على الأقل. يمكنك الاختيار من ملاعب مختلفة، أو اختر «كل المواعيد · كل الملاعب» لتطبيقه دفعةً واحدة.</span>
            </div>

            <div class="form-group">
              <label class="form-label">لفترة محدودة؟ <span class="form-help-inline">اختياري — للعروض الموسمية</span></label>
              <div class="form-row cols-2">
                <input type="date" class="form-control" id="o-from" value="${e.start_date || ''}" aria-label="من تاريخ">
                <input type="date" class="form-control" id="o-to" value="${e.end_date || ''}" aria-label="إلى تاريخ">
              </div>
              <span class="form-help">اتركه فارغًا للعرض الدائم، أو حدِّد تاريخَي البداية والنهاية لعرض موسمي (كرمضان والأعياد).</span>
            </div>
          </form>`;
        const ctrl = window.utils.openModal({
          title: isEdit ? 'تعديل عرض' : 'عرض جديد',
          body,
          footer: `<button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
                   <button type="submit" class="btn btn--primary" form="offer-form" id="o-save">${isEdit ? 'حفظ' : 'إضافة'}</button>`
        });
        const m = ctrl.modal;
        const kindEl = m.querySelector('#o-kind');
        const addonEl = m.querySelector('#o-addon');
        const valEl = m.querySelector('#o-value');
        const valErrEl = m.querySelector('#o-value-err');
        const periodsEl = m.querySelector('#o-periods');
        // حدود الحقل تتبع النوع: النسبة (0، 100]، السعر الثابت ≥ 0 بلا حدّ أعلى
        const applyBounds = () => {
          if (kindEl.value === 'percent') { valEl.min = '0.01'; valEl.max = '100'; }
          else { valEl.min = '0'; valEl.removeAttribute('max'); }
        };
        // إحصاء أسعار المواعيد المختارة: مدى المسعّرة + وجود مواعيد مفتوحة السعر («عند التواصل»)
        const selectedPriceStats = () => {
          let min = Infinity, max = -Infinity, hasKnown = false, hasOpen = false;
          const add = (p) => { hasKnown = true; if (p < min) min = p; if (p > max) max = p; };
          selectedKeys.forEach((key) => {
            if (key === GLOBAL_KEY) { allPrices.forEach(add); if (anyOpenAll) hasOpen = true; return; }
            const [fid, , o] = key.split('|');
            if (o === '') {                                                   // كل مواعيد الملعب
              (fieldPricesById.get(fid) || []).forEach(add);
              if (fieldHasOpenById.get(fid)) hasOpen = true;
            } else {                                                          // فترة محدّدة
              const p = periodPriceByKey.get(key);
              if (p == null) hasOpen = true; else add(p);
            }
          });
          return { min, max, hasKnown, hasOpen };
        };
        const fmtSar = (n) => window.utils.formatCurrency(n);
        // تحقّق حيّ: يُظهر رسالة تحت الحقل دون تغيير ما كتبه المستخدم. يُعيد true إن كان الحفظ مسموحًا (التنبيه/الإرشاد لا يمنع)
        const validateValue = () => {
          const raw = valEl.value.trim();
          let msg = '', level = '';   // '' | 'error' | 'warn' | 'info'
          if (raw !== '') {
            const v = parseFloat(raw);
            const st = selectedPriceStats();
            if (isNaN(v)) { msg = 'أدخل رقمًا صالحًا'; level = 'error'; }
            else if (kindEl.value === 'percent') {
              if (v <= 0) { msg = 'نسبة الخصم يجب أن تكون أكبر من 0'; level = 'error'; }
              else if (v > 100) { msg = 'نسبة الخصم لا تتجاوز 100%'; level = 'error'; }
              else if (st.hasOpen && !st.hasKnown) { level = 'warn'; msg = 'النسبة لا تُطبَّق على مواعيد مفتوحة السعر («عند التواصل»). حدِّد سعرًا للملعب، أو استخدم «سعر ثابت».'; }
              else if (st.hasOpen) { level = 'warn'; msg = 'بعض المواعيد المختارة مفتوحة السعر؛ لن تُطبَّق النسبة عليها — فقط على المسعّرة.'; }
            } else if (v < 0) {
              msg = 'السعر لا يكون سالبًا'; level = 'error';
            } else if (st.hasKnown && v > st.max) {
              level = 'error';
              msg = st.min === st.max
                ? `السعر (${fmtSar(v)}) أعلى من سعر الموعد المختار (${fmtSar(st.max)}) — لن يُطبَّق العرض. اجعله أقلّ من ${fmtSar(st.max)} ليكون خصمًا.`
                : `السعر (${fmtSar(v)}) أعلى من سعر كل المواعيد المختارة (أعلاها ${fmtSar(st.max)}) — لن يُطبَّق العرض على أيّها. اجعله أقلّ ليكون خصمًا.`;
            } else if (st.hasKnown && v > st.min) {
              level = 'warn';
              msg = `تنبيه: السعر أعلى من سعر بعض المواعيد المختارة (أدناها ${fmtSar(st.min)})؛ في تلك المواعيد لن يُطبَّق العرض — لا نرفع السعر أبدًا.`;
            } else if (st.hasOpen) {
              level = 'info';
              msg = st.hasKnown
                ? 'بعض المواعيد المختارة مفتوحة السعر؛ سيُحدِّد لها هذا السعر الثابت.'
                : 'هذه المواعيد مفتوحة السعر («عند التواصل»)؛ سيُحدِّد لها هذا السعر الثابت.';
            }
          }
          valErrEl.textContent = msg;
          valErrEl.style.display = msg ? 'block' : 'none';
          valErrEl.classList.toggle('form-error', level === 'error');
          valErrEl.classList.toggle('form-warn', level === 'warn');
          valErrEl.classList.toggle('form-help', level === 'info');
          valEl.setAttribute('aria-invalid', level === 'error' ? 'true' : 'false');
          return level !== 'error';
        };
        applyBounds();
        kindEl.addEventListener('change', () => {
          addonEl.textContent = kindEl.value === 'fixed' ? 'ر.س' : '%';
          applyBounds();
          validateValue();
        });
        valEl.addEventListener('input', validateValue);

        const GLOBAL_KEY = '|||'; // كل المواعيد · كل الملاعب
        // يعكس حالة «الكل»: يُعطّل بصريًّا بقية الصفوف ويُظهر تنبيهًا
        const syncAllLock = () => periodsEl.classList.toggle('offer-periods--all', selectedKeys.has(GLOBAL_KEY));
        periodsEl.addEventListener('click', (ev) => {
          const row = ev.target.closest('.offer-prow');
          if (!row) return;
          const key = row.dataset.key;
          // ما دام «الكل» مفعّلًا، لا يُسمح باختيار موعد فردي حتى يُلغى «الكل»
          if (key !== GLOBAL_KEY && selectedKeys.has(GLOBAL_KEY)) return;
          const on = row.getAttribute('aria-pressed') === 'true';
          if (on) { row.setAttribute('aria-pressed', 'false'); selectedKeys.delete(key); syncAllLock(); validateValue(); return; }
          // عند تفعيل «الكل»: يُلغي أي تحديد آخر
          if (key === GLOBAL_KEY) {
            selectedKeys.clear();
            periodsEl.querySelectorAll('.offer-prow[aria-pressed="true"]').forEach((r) => r.setAttribute('aria-pressed', 'false'));
          }
          row.setAttribute('aria-pressed', 'true');
          selectedKeys.add(key);
          syncAllLock();
          validateValue();
        });

        const fmtT = (v) => window.utils.formatTimeOfDay(v);
        const esc = (v) => window.utils.escapeHtml(v);
        // نطاق الوقت: كل وقت داخل <bdi> ليُعزل اتجاهه (أرقام لاتينية + ص/م عربية)
        const rangeHtml = (o, c) => `<bdi>${esc(o)}</bdi> – <bdi>${esc(c)}</bdi>`;
        // timeHtml: HTML موثوق (مبنيّ داخليًّا)
        const rowHtml = (key, dayLabel, timeHtml, isAll) =>
          `<div class="offer-prow${isAll ? ' offer-prow--all' : ''}${key === GLOBAL_KEY ? ' offer-prow--global' : ''}" role="button" data-key="${key}" aria-pressed="${selectedKeys.has(key) ? 'true' : 'false'}">
            <span class="offer-ck"><i class="offer-ck-ic" data-lucide="check"></i></span>
            <span class="offer-day">${esc(dayLabel)}</span>
            <span class="offer-tm">${timeHtml}</span>
          </div>`;

        // ابنِ منتقي الفترات لكل الملاعب (صفوف منظّمة مجمّعة حسب الملعب)
        (async () => {
          if (!fields.length) {
            periodsEl.innerHTML = `<div class="offer-periods-note text-tertiary text-sm">لا ملاعب بعد.</div>`;
            return;
          }
          const built = new Set([GLOBAL_KEY]);
          // زرّ صريح: كل المواعيد · كل الملاعب
          let html = `<div class="offer-field-group"><div class="offer-rows">`
            + rowHtml(GLOBAL_KEY, 'الكل', esc('كل المواعيد · كل الملاعب'), true)
            + `</div><div class="offer-all-note"><i data-lucide="info"></i> «الكل» مُحدَّد، وسيُطبَّق العرض على جميع المواعيد تلقائيًا. لاختيار مواعيد بعينها، ألغِ تحديد «الكل» أولاً.</div></div>`;
          for (const f of fields) {
            let periods = [];
            try { periods = await fetchPeriods(f.id); } catch (_) {}
            const wholeKey = keyOf(f.id, null, '', '');
            built.add(wholeKey);
            html += `<div class="offer-field-group"><div class="offer-field-name"><span class="offer-field-tag"><i data-lucide="goal"></i> ملعب ${window.utils.escapeHtml(f.name)}</span></div><div class="offer-rows">`;
            html += rowHtml(wholeKey, 'الكل', esc('كل مواعيد الملعب'), true);
            const fPrices = [];
            let fOpen = false;
            periods.forEach((p) => {
              const k = keyOf(f.id, p.w, p.o, p.c);
              built.add(k);
              periodPriceByKey.set(k, p.p);
              if (p.p != null) { fPrices.push(p.p); allPrices.push(p.p); }
              else { fOpen = true; anyOpenAll = true; }
              html += rowHtml(k, DAYS[p.w], rangeHtml(fmtT(p.o), fmtT(p.c)), false);
            });
            fieldPricesById.set(f.id, fPrices);
            fieldHasOpenById.set(f.id, fOpen);
            html += `</div></div>`;
          }
          // أهداف محفوظة لا تطابق فترات حالية (مخصّصة)
          const custom = [...selectedKeys].filter((k) => !built.has(k));
          if (custom.length) {
            html += `<div class="offer-field-group"><div class="offer-field-name">أخرى (مخصّص)</div><div class="offer-rows">`;
            custom.forEach((k) => {
              const [fid, w, o, c] = k.split('|');
              const day = w === '' ? 'كل الأيام' : DAYS[Number(w)];
              const tHtml = o ? `${esc(fieldName(fid))} · ${rangeHtml(o, c)}` : esc(fieldName(fid));
              html += rowHtml(k, day, tHtml, !o);
            });
            html += `</div></div>`;
          }
          periodsEl.innerHTML = html;
          syncAllLock();
          validateValue();
          window.utils.renderIcons(periodsEl);
        })();

        m.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
        m.querySelector('#offer-form').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const label = m.querySelector('#o-label').value.trim();
          const val = parseFloat(valEl.value);
          if (!label) { window.utils.toast('اسم العرض مطلوب', 'error'); return; }
          if (valEl.value.trim() === '') {
            valErrEl.textContent = 'القيمة مطلوبة'; valErrEl.style.display = 'block';
            valErrEl.classList.add('form-error'); valErrEl.classList.remove('form-warn');
            valEl.setAttribute('aria-invalid', 'true'); valEl.focus(); return;
          }
          if (!validateValue()) { valEl.focus(); return; }
          const targets = Array.from(periodsEl.querySelectorAll('.offer-prow[aria-pressed="true"]')).map((el) => {
            const [fid, w, o, c] = el.dataset.key.split('|');
            return { field_id: fid || null, weekday: w === '' ? null : Number(w), start_time: o || null, end_time: c || null };
          });
          if (!targets.length) { window.utils.toast('اختر موعدًا واحدًا على الأقل (أو «كل المواعيد · كل الملاعب»)', 'error'); return; }
          const payload = {
            id: isEdit ? existing.id : null,
            label,
            discount_percent: kindEl.value === 'percent' ? val : null,
            fixed_price: kindEl.value === 'fixed' ? val : null,
            start_date: m.querySelector('#o-from').value || null,
            end_date: m.querySelector('#o-to').value || null,
            targets
          };
          const btn = m.querySelector('#o-save');
          btn.disabled = true;
          try {
            await window.api.saveOffer(payload);
            ctrl.close();
            window.utils.toast(isEdit ? 'تم حفظ العرض' : 'تمت إضافة العرض', 'success');
            await load();
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
            btn.disabled = false;
          }
        });
      }

      container.querySelector('#add-offer').addEventListener('click', () => openForm(null));
      load();
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages['offers'] = page;
})();
