// صفحة العروض — خصومات/أسعار خاصّة زمنية فوق السعر الأساسي. للمالك فقط.
// كل عرض يستهدف فترات متعدّدة، وكل فترة تحمل ملعبها — فيمكن خلط مواعيد ملاعب مختلفة.
(function () {
  const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const fmtDate = (v) => v ? window.utils.formatDate(v) : null;
  const t5 = (v) => v ? String(v).substring(0, 5) : null;
  const keyOf = (fid, w, o, c) => `${fid || ''}|${w == null ? '' : w}|${o || ''}|${c || ''}`;

  function effectLabel(o) {
    if (o.fixed_price != null) return `سعر ثابت ${window.utils.formatCurrency(o.fixed_price)}/س`;
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
          if (!seen.has(k)) { seen.add(k); list.push({ w, o, c }); }
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
                  <option value="fixed" ${kind === 'fixed' ? 'selected' : ''}>سعر ثابت/ساعة</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" for="o-value">القيمة <span class="required">*</span></label>
                <div class="input-group">
                  <input type="number" class="form-control" id="o-value" min="0" step="0.01" required value="${e.fixed_price != null ? e.fixed_price : (e.discount_percent != null ? e.discount_percent : '')}">
                  <span class="input-addon" id="o-addon">${kind === 'fixed' ? 'ر.س' : '%'}</span>
                </div>
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
        const periodsEl = m.querySelector('#o-periods');
        kindEl.addEventListener('change', () => { addonEl.textContent = kindEl.value === 'fixed' ? 'ر.س' : '%'; });

        const GLOBAL_KEY = '|||'; // كل المواعيد · كل الملاعب
        periodsEl.addEventListener('click', (ev) => {
          const row = ev.target.closest('.offer-prow');
          if (!row) return;
          const key = row.dataset.key;
          const on = row.getAttribute('aria-pressed') === 'true';
          if (on) { row.setAttribute('aria-pressed', 'false'); selectedKeys.delete(key); return; }
          // عند الاختيار: «الكل» يُلغي الباقي، وأي تحديد آخر يُلغي «الكل» (تنافٍ)
          if (key === GLOBAL_KEY) {
            selectedKeys.clear();
            periodsEl.querySelectorAll('.offer-prow[aria-pressed="true"]').forEach((r) => r.setAttribute('aria-pressed', 'false'));
          } else if (selectedKeys.has(GLOBAL_KEY)) {
            selectedKeys.delete(GLOBAL_KEY);
            const g = periodsEl.querySelector(`.offer-prow[data-key="${GLOBAL_KEY}"]`);
            if (g) g.setAttribute('aria-pressed', 'false');
          }
          row.setAttribute('aria-pressed', 'true');
          selectedKeys.add(key);
        });

        const fmtT = (v) => window.utils.formatTimeOfDay(v);
        const esc = (v) => window.utils.escapeHtml(v);
        // نطاق الوقت: كل وقت داخل <bdi> ليُعزل اتجاهه (أرقام لاتينية + ص/م عربية)
        const rangeHtml = (o, c) => `<bdi>${esc(o)}</bdi> – <bdi>${esc(c)}</bdi>`;
        // timeHtml: HTML موثوق (مبنيّ داخليًّا)
        const rowHtml = (key, dayLabel, timeHtml, isAll) =>
          `<div class="offer-prow${isAll ? ' offer-prow--all' : ''}" role="button" data-key="${key}" aria-pressed="${selectedKeys.has(key) ? 'true' : 'false'}">
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
            + `</div></div>`;
          for (const f of fields) {
            let periods = [];
            try { periods = await fetchPeriods(f.id); } catch (_) {}
            const wholeKey = keyOf(f.id, null, '', '');
            built.add(wholeKey);
            html += `<div class="offer-field-group"><div class="offer-field-name"><span class="offer-field-tag"><i data-lucide="goal"></i> ملعب ${window.utils.escapeHtml(f.name)}</span></div><div class="offer-rows">`;
            html += rowHtml(wholeKey, 'الكل', esc('كل مواعيد الملعب'), true);
            periods.forEach((p) => {
              const k = keyOf(f.id, p.w, p.o, p.c);
              built.add(k);
              html += rowHtml(k, DAYS[p.w], rangeHtml(fmtT(p.o), fmtT(p.c)), false);
            });
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
          window.utils.renderIcons(periodsEl);
        })();

        m.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
        m.querySelector('#offer-form').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const label = m.querySelector('#o-label').value.trim();
          const val = parseFloat(m.querySelector('#o-value').value);
          if (!label) { window.utils.toast('اسم العرض مطلوب', 'error'); return; }
          if (isNaN(val) || val < 0) { window.utils.toast('قيمة غير صالحة', 'error'); return; }
          if (kindEl.value === 'percent' && (val <= 0 || val > 100)) { window.utils.toast('النسبة بين 1 و 100', 'error'); return; }
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
