// قائمة الحجوزات — KPI + filters bar + chip rail للفلاتر النشطة + جدول مع status بحدود + hover actions
(function () {
  const TEMPLATE = `
    <div class="page-header">
      <div>
        <h2>الحجوزات</h2>
        <div class="page-subtitle">جميع الحجوزات مع فلاتر متقدّمة</div>
      </div>
      <div class="actions">
        <button class="btn btn--secondary" id="block-slot-btn">
          <i data-lucide="lock"></i> حجب موعد
        </button>
        <button class="btn btn--primary" id="add-booking-btn">
          <i data-lucide="plus"></i> حجز جديد
        </button>
      </div>
    </div>
    ${window.layout.pageTabs(window.layout.BOOKING_TABS, '/bookings')}

    <div class="filters-bar">
      <div class="form-group">
        <label class="form-label">من تاريخ</label>
        <input type="date" id="filter-from" class="form-control">
      </div>
      <div class="form-group">
        <label class="form-label">إلى تاريخ</label>
        <input type="date" id="filter-to" class="form-control">
      </div>
      <div class="form-group">
        <label class="form-label">الأرضية</label>
        <select id="filter-field" class="form-control">
          <option value="">كل الأرضيات</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">الحالة</label>
        <select id="filter-status" class="form-control">
          <option value="">كل الحالات</option>
          <option value="pending">معلّق</option>
          <option value="confirmed">مؤكد</option>
          <option value="completed">مكتمل</option>
          <option value="cancelled">ملغي</option>
          <option value="no_show">لم يحضر</option>
          <option value="blocked">محجوب</option>
        </select>
      </div>
      <button class="btn btn--ghost" id="reset-filters-btn" title="إعادة تعيين">
        <i data-lucide="x"></i>
      </button>
    </div>

    <div id="chip-rail" class="chip-rail" style="margin-bottom: var(--space-3); display: none"></div>

    <div id="bookings-container">
      <div class="loader-center"><div class="loader loader--lg"></div></div>
    </div>
  `;

  function statusChip(status, b) {
    if (status === 'pending')   return '<span class="chip-status chip-status--pending">بانتظار تأكيدك</span>';
    if (status === 'confirmed') return '<span class="chip-status chip-status--confirmed">حجز مؤكد</span>';
    if (status === 'completed') return '<span class="chip-status chip-status--completed">حجز مكتمل</span>';
    if (status === 'cancelled') {
      // تمييز إلغاء العميل (عبر صفحة «حجوزاتي») عن إلغاء الإدارة
      return b && b.cancelled_by === 'customer'
        ? '<span class="chip-status chip-status--cancelled">ألغى العميل حجزه</span>'
        : '<span class="chip-status chip-status--cancelled">حجز ملغي</span>';
    }
    if (status === 'no_show') return '<span class="chip-status chip-status--noshow">لم يحضر</span>';
    // موعد محجوب — إشغال بلا عميل (صيانة/لعب خاص)، والسبب في notes
    if (status === 'blocked') return '<span class="chip-status chip-status--muted">موعد محجوب</span>';
    return `<span class="chip-status chip-status--muted">${window.utils.escapeHtml(status)}</span>`;
  }

  function statusLabel(s) {
    return { pending:'معلّق', confirmed:'مؤكد', completed:'مكتمل', cancelled:'ملغي', no_show:'لم يحضر' }[s] || s;
  }

  function fmtMoney(v) { return window.utils.formatCurrency(v || 0); }

  // حالة الحجز المقبولة (مؤكد/مكتمل) — هي وحدها التي يُتتبّع لها دفع
  function isAccepted(b) { return b.status === 'confirmed' || b.status === 'completed'; }

  // حالة الدفع — مستقلّة عن حالة الحجز. null = لا تتبّع (سعر «عند التواصل» أو مجاني)
  function paymentInfo(b) {
    if (b.total_price == null) return null;          // عند التواصل
    const total = Number(b.total_price);
    if (total <= 0) return null;                     // مجاني
    const paid = Number(b.paid_amount || 0);
    const owed = Math.round((total - paid) * 100) / 100;
    if (paid <= 0) return { key: 'unpaid',  label: 'غير مدفوع',   owed };
    if (owed > 0)  return { key: 'partial', label: 'مدفوع جزئياً', owed };
    return { key: 'paid', label: 'مدفوع', owed: 0 };
  }

  // شريط حالة الدفع الموحّد — نفس التصميم لكل الحالات، بلونٍ وأيقونةٍ لكل حالة
  function payBand(p) {
    const meta = {
      paid:    { cls: 'is-paid',    icon: 'check-check',   label: 'مدفوع' },
      partial: { cls: 'is-partial', icon: 'circle-dashed', label: `مدفوع جزئياً · يتبقّى ${fmtMoney(p.owed)}` },
      unpaid:  { cls: 'is-unpaid',  icon: 'circle-alert',  label: `غير مدفوع · يتبقّى ${fmtMoney(p.owed)}` }
    }[p.key];
    return `<span class="pay-band ${meta.cls}"><i data-lucide="${meta.icon}"></i> ${meta.label}</span>`;
  }

  // تأكيد الحجز عبر واتساب — المنطق مشترك في window.bookingWhatsApp
  const buildWhatsAppUrl = (b, venueName) => window.bookingWhatsApp.buildUrl(b, venueName);

  // نافذة تسجيل دفعة — مسار سريع: «تحصيل كامل المبلغ» أو مبلغ جزئي
  function openPaymentDialog(booking, onSaved) {
    const total = Number(booking.total_price || 0);
    const paid  = Number(booking.paid_amount || 0);
    const owed  = Math.round((total - paid) * 100) / 100;

    const row = (label, value, strong) =>
      `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0">
         <span class="text-muted">${label}</span>
         <span class="tabular-nums" style="${strong ? 'font-weight:700' : ''}">${value}</span>
       </div>`;

    const body = document.createElement('div');
    body.innerHTML = `
      <div style="background:var(--surface-2);padding:var(--space-3);border-radius:var(--radius-md);margin-bottom:var(--space-4)">
        ${row('الإجمالي', fmtMoney(total))}
        ${row('المدفوع سابقاً', fmtMoney(paid))}
        <div style="border-top:1px solid var(--border-subtle);margin:4px 0"></div>
        ${row('المتبقّي', fmtMoney(owed), true)}
      </div>
      <button type="button" class="btn btn--primary btn--block" id="pay-full">
        <i data-lucide="check-check"></i> تحصيل كامل المبلغ (${fmtMoney(owed)})
      </button>
      <div class="text-muted text-sm" style="text-align:center;margin:var(--space-3) 0 var(--space-2)">أو سجّل مبلغاً جزئياً</div>
      <div class="form-group" style="margin:0">
        <label class="form-label">المبلغ المُحصّل الآن (ر.س)</label>
        <input type="number" class="form-control" id="pay-amount" min="0" max="${owed}" step="0.01" value="${owed}">
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:8px;width:100%';
    footer.innerHTML = `
      <div style="flex:1"></div>
      <button type="button" class="btn btn--ghost" data-action="close">إغلاق</button>
      <button type="button" class="btn btn--primary" id="pay-submit">تسجيل الدفعة</button>
    `;

    const ctrl = window.utils.openModal({ title: 'تسجيل دفعة', body, footer });

    async function submit(newPaidTotal) {
      const clamped = Math.min(total, Math.max(0, Math.round(newPaidTotal * 100) / 100));
      try {
        const saved = await window.api.updateBooking(booking.id, { paid_amount: clamped });
        window.utils.toast('تم تسجيل الدفعة', 'success');
        ctrl.close();
        if (typeof onSaved === 'function') onSaved(saved);
      } catch (err) {
        window.utils.toast(window.utils.formatError(err), 'error');
      }
    }

    ctrl.modal.querySelector('#pay-full').addEventListener('click', () => submit(total));
    ctrl.modal.querySelector('#pay-submit').addEventListener('click', () => {
      const amt = parseFloat(ctrl.modal.querySelector('#pay-amount').value);
      if (!(amt > 0)) { window.utils.toast('أدخل مبلغاً صحيحاً', 'error'); return; }
      if (amt > owed + 0.001) { window.utils.toast('المبلغ يتجاوز المتبقّي', 'error'); return; }
      submit(paid + amt);
    });
    ctrl.modal.querySelector('[data-action="close"]').addEventListener('click', ctrl.close);
  }

  // نافذة تحديد سعر حجز «عند التواصل» — حقل واحد، وبعد الحفظ يدخل خط التحصيل الطبيعي
  function openPriceDialog(booking, onSaved) {
    const body = document.createElement('div');
    body.innerHTML = `
      <p class="text-muted text-sm" style="margin:0 0 var(--space-3)">
        سعر هذا الحجز «عند التواصل» — سجّل السعر المتفق عليه مع العميل ليدخل حساب التحصيل والإيرادات.
      </p>
      <div class="form-group" style="margin:0">
        <label class="form-label">السعر المتفق عليه (ر.س)</label>
        <input type="number" class="form-control" id="price-amount" min="0" step="0.01" inputmode="decimal">
        <span class="form-help">0 = مجاني</span>
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:8px;width:100%';
    footer.innerHTML = `
      <div style="flex:1"></div>
      <button type="button" class="btn btn--ghost" data-action="close">إغلاق</button>
      <button type="button" class="btn btn--primary" id="price-submit">حفظ السعر</button>
    `;

    const ctrl = window.utils.openModal({ title: 'تحديد سعر الحجز', body, footer });
    const input = ctrl.modal.querySelector('#price-amount');
    input.focus();

    const submit = async () => {
      const raw = (input.value || '').trim();
      const val = parseFloat(raw);
      if (raw === '' || isNaN(val) || val < 0) {
        window.utils.toast('أدخل سعراً صحيحاً', 'error');
        input.focus();
        return;
      }
      try {
        const saved = await window.api.updateBooking(booking.id, { total_price: Math.round(val * 100) / 100 });
        window.utils.toast('تم تحديد السعر', 'success');
        ctrl.close();
        if (typeof onSaved === 'function') onSaved(saved);
      } catch (err) {
        window.utils.toast(window.utils.formatError(err), 'error');
      }
    };
    ctrl.modal.querySelector('#price-submit').addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    ctrl.modal.querySelector('[data-action="close"]').addEventListener('click', ctrl.close);
  }

  const page = {
    async mount(container, ctx) {
      container.innerHTML = TEMPLATE;
      window.utils.renderIcons(container);

      const venueName = (ctx && ctx.tenant && ctx.tenant.name) || '';

      const tableContainer = container.querySelector('#bookings-container');
      const addBtn         = container.querySelector('#add-booking-btn');
      const filterFrom     = container.querySelector('#filter-from');
      const filterTo       = container.querySelector('#filter-to');
      const filterField    = container.querySelector('#filter-field');
      const filterStatus   = container.querySelector('#filter-status');
      const resetBtn       = container.querySelector('#reset-filters-btn');
      const chipRail       = container.querySelector('#chip-rail');

      let alive = true;
      const cleanup = [];
      page._cleanup = cleanup;

      // اقرأ ?status=pending من URL إن وُجد (من dashboard "X طلب آخر")
      const urlStatus = window.utils.getQueryParam('status');
      if (urlStatus) filterStatus.value = urlStatus;

      // املأ قائمة الأرضيات — وتخدم «حجب موعد» كذلك
      let fieldsMap = {};
      let allFields = [];
      try {
        const fields = window.store ? await window.store.get('fields:all') : await window.api.listFields(true);
        if (!alive) return;
        allFields = fields;
        fields.forEach((f) => {
          fieldsMap[f.id] = f.name;
          const opt = document.createElement('option');
          opt.value = f.id;
          opt.textContent = f.name;
          filterField.appendChild(opt);
        });
      } catch (err) { console.error(err); }

      function buildChipRail(filters) {
        const chips = [];
        if (filters.from) chips.push({ key: 'from', label: `من ${filters.from.slice(0,10)}` });
        if (filters.to)   chips.push({ key: 'to',   label: `إلى ${filters.to.slice(0,10)}` });
        if (filters.fieldId) chips.push({ key: 'fieldId', label: fieldsMap[filters.fieldId] || 'أرضية' });
        if (filters.status)  chips.push({ key: 'status',  label: statusLabel(filters.status) });

        if (chips.length === 0) {
          chipRail.style.display = 'none';
          return;
        }
        chipRail.style.display = '';
        chipRail.innerHTML = chips.map((c) => `
          <span class="chip is-active">
            ${window.utils.escapeHtml(c.label)}
            <button class="chip-close" data-clear="${c.key}" aria-label="إزالة">×</button>
          </span>
        `).join('') + `<button class="chip" id="clear-all-chips">مسح الكل</button>`;

        chipRail.querySelectorAll('[data-clear]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const k = btn.dataset.clear;
            if (k === 'from')    filterFrom.value = '';
            if (k === 'to')      filterTo.value = '';
            if (k === 'fieldId') filterField.value = '';
            if (k === 'status')  filterStatus.value = '';
            refresh();
          });
        });
        chipRail.querySelector('#clear-all-chips').addEventListener('click', resetFilters);
      }

      async function refresh() {
        if (!alive) return;
        tableContainer.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';

        const wantStatus = filterStatus.value;
        const filters = {};
        if (filterFrom.value) filters.from = filterFrom.value + 'T00:00:00';
        if (filterTo.value)   filters.to   = filterTo.value + 'T23:59:59';
        if (filterField.value) filters.fieldId = filterField.value;
        // مؤكد/مكتمل/لم يحضر حالات مشتقّة تُحسب في الواجهة — لا تُمرَّر لقاعدة البيانات
        if (wantStatus === 'pending' || wantStatus === 'cancelled') filters.status = wantStatus;
        // المحجوب صفّ إشغال بلا عميل، تستبعده الاستعلامات افتراضاً — فيُطلب صراحةً.
        // كان يُرى في عرض «قائمة» داخل التقويم وحده، وقد أُلغي ذلك العرض.
        if (wantStatus === 'blocked') { filters.status = 'blocked'; filters.includeBlocks = true; }

        const hasFilters = Object.keys(filters).length > 0 || !!wantStatus;
        buildChipRail({ from: filters.from, to: filters.to, fieldId: filters.fieldId, status: wantStatus });

        try {
          let bookings = await window.api.listBookings(filters);
          if (!alive) return;
          if (wantStatus === 'confirmed' || wantStatus === 'completed' || wantStatus === 'no_show') {
            bookings = bookings.filter((b) => window.utils.effectiveBookingStatus(b) === wantStatus);
          }

          // أولوية العرض: معلّق (يحتاج قرارك) ← مؤكد لم يُؤكَّد للعميل بعد
          // ← مؤكد يحتاج تحصيل ← مؤكد محصَّل ← ملغي ← مكتمل.
          // داخل المجموعات النشطة الأقرب موعدًا أولًا (والمتأخر عن موعده في القمة)،
          // وداخل الأرشيف الأحدث أولًا.
          const rank = (b) => {
            const eff = window.utils.effectiveBookingStatus(b);
            if (eff === 'pending') return 0;
            if (eff === 'confirmed') {
              if (!b.whatsapp_confirmed_at) return 1;
              // «عند التواصل» بلا سعر بعد = مالية معلّقة، يزاحم مجموعة التحصيل
              const p = paymentInfo(b);
              return (p && p.owed > 0) || b.total_price == null ? 2 : 3;
            }
            if (eff === 'cancelled') return 4;
            if (eff === 'no_show') return 5;
            return 6; // completed
          };
          bookings.sort((a, b) => {
            const ra = rank(a), rb = rank(b);
            if (ra !== rb) return ra - rb;
            const diff = new Date(a.start_time) - new Date(b.start_time);
            return ra <= 3 ? diff : -diff;
          });

          if (!bookings.length) {
            tableContainer.innerHTML = `
              <div class="card">
                <div class="empty-state">
                  <div class="empty-icon"><i data-lucide="clipboard-list"></i></div>
                  <h3>لا توجد حجوزات</h3>
                  <p>${hasFilters ? 'لا حجوزات تطابق الفلاتر — جرّب مسحها.' : 'لم يتم إنشاء أي حجز بعد.'}</p>
                  ${hasFilters ? '<button class="btn btn--secondary" id="empty-reset">مسح الفلاتر</button>' : ''}
                </div>
              </div>
            `;
            window.utils.renderIcons(tableContainer);
            const er = tableContainer.querySelector('#empty-reset');
            if (er) er.addEventListener('click', resetFilters);
            return;
          }

          // المحجوب ليس حجزاً: بلا عميل وبلا سعر. عدُّه يضخّم «عدد الحجوزات»
          // ويُدخل صفراً في متوسّطات الإيراد — فيُستبعد من المؤشرات لا من الجدول.
          const countable = bookings.filter((b) => b.status !== 'blocked');
          const active = countable.filter((b) => b.status !== 'cancelled');
          const totals = active.reduce((acc, b) => {
            // الغائب: قيمته المتحققة هي المحصَّل منه فقط (العربون) — سعره الكامل لن يأتي
            acc.revenue += b.no_show_at ? Number(b.paid_amount || 0) : Number(b.total_price || 0);
            acc.paid    += Number(b.paid_amount || 0);
            return acc;
          }, { revenue: 0, paid: 0 });

          tableContainer.innerHTML = `
            <div class="stats-grid mb-md">
              <div class="stat-card">
                <div class="stat-card-head">
                  <span class="stat-icon-chip"><i data-lucide="clipboard-list"></i></span>
                  <span class="stat-label">عدد الحجوزات</span>
                </div>
                <div class="stat-value">${active.length}</div>
                <div class="stat-sub">${countable.length} إجمالاً (شامل الملغية)${
                  bookings.length > countable.length
                    ? ` · ${bookings.length - countable.length} محجوب` : ''}</div>
              </div>
              <div class="stat-card">
                <div class="stat-card-head">
                  <span class="stat-icon-chip stat-icon-chip--accent"><i data-lucide="banknote"></i></span>
                  <span class="stat-label">إجمالي الإيرادات</span>
                </div>
                <div class="stat-value">${fmtMoney(totals.revenue)}</div>
              </div>
              <div class="stat-card">
                <div class="stat-card-head">
                  <span class="stat-icon-chip stat-icon-chip--accent"><i data-lucide="circle-check"></i></span>
                  <span class="stat-label">المدفوع</span>
                </div>
                <div class="stat-value text-success">${fmtMoney(totals.paid)}</div>
                <div class="stat-sub">المتبقي ${fmtMoney(totals.revenue - totals.paid)}</div>
              </div>
            </div>

            <div class="table-wrapper cards-only as-cards">
              <table class="table table--cards">
                <thead>
                  <tr>
                    <th>التاريخ والوقت</th>
                    <th>الأرضية</th>
                    <th>العميل</th>
                    <th>الجوال</th>
                    <th>المدة</th>
                    <th>السعر</th>
                    <th>المدفوع</th>
                    <th>الحالة</th>
                    <th class="actions-cell"></th>
                  </tr>
                </thead>
                <tbody>
                  ${bookings.map((b) => {
                    const hours = window.utils.hoursBetween(b.start_time, b.end_time);
                    // الغائب خارج دورة المال والتواصل: لا تحصيل ولا واتساب ولا مطالبة
                    const accepted = isAccepted(b) && !b.no_show_at;
                    const pay = accepted ? paymentInfo(b) : null;
                    const effStatus = window.utils.effectiveBookingStatus(b);
                    // حجز مؤكد لم يُبلَّغ به العميل بعد عبر واتساب → نُنبّه الموظف للتأكيد
                    const needsConfirm = effStatus === 'confirmed' && !b.whatsapp_confirmed_at;
                    return `
                      <tr data-id="${b.id}" data-status="${window.utils.escapeHtml(effStatus)}">
                        <td data-label="التاريخ والوقت">${window.utils.formatDateTime(b.start_time)}</td>
                        <td class="card-note">${
                          b.whatsapp_confirmed_at
                            ? `<span class="wa-confirmed" title="تم التواصل عبر واتساب: ${window.utils.escapeHtml(window.utils.formatDateTime(b.whatsapp_confirmed_at))}"><i data-lucide="badge-check"></i> تم التواصل وتأكيد الحجز · ${window.utils.escapeHtml(window.utils.timeAgo(b.whatsapp_confirmed_at))}</span>`
                            : (needsConfirm
                                ? `<span class="wa-pending"><i data-lucide="alert-circle"></i> لم يُؤكَّد الحجز للعميل بعد</span>`
                                : '')
                        }</td>
                        <td data-label="الأرضية">${window.utils.escapeHtml(b.fields ? b.fields.name : '—')}</td>
                        <td data-label="العميل">${
                          b.status === 'blocked'
                            ? `<span class="text-tertiary">${window.utils.escapeHtml(b.notes || 'محجوب')}</span>`
                            : window.utils.escapeHtml(b.customers ? b.customers.full_name : '—')
                        }</td>
                        <td data-label="الجوال" class="tabular-nums">${b.customers && b.customers.phone ? window.utils.escapeHtml(b.customers.phone) : '—'}</td>
                        <td data-label="المدة" class="tabular-nums">${window.utils.formatDuration(hours)}</td>
                        <td data-label="السعر" class="tabular-nums">${window.utils.formatPrice(b.total_price)}</td>
                        <td data-label="المدفوع" class="tabular-nums cell-paid">
                          ${fmtMoney(b.paid_amount)}
                          ${pay ? payBand(pay) : (accepted && b.total_price == null ? `
                            <span class="pay-band is-unpaid"><i data-lucide="tag"></i> حدّد السعر بعد التواصل</span>
                          ` : '')}
                        </td>
                        <td data-label="الحالة" class="card-tag">${statusChip(effStatus, b)}</td>
                        <td class="actions-cell">
                          <div class="actions-inline">
                            ${b.status === 'pending' ? `
                              <button class="btn btn--xs btn--accent-quiet" data-action="approve" data-id="${b.id}" title="موافقة">
                                <i data-lucide="check"></i><span class="btn-label">قبول الحجز</span>
                              </button>
                              <button class="btn btn--xs btn--danger-quiet" data-action="reject" data-id="${b.id}" title="رفض">
                                <i data-lucide="x"></i><span class="btn-label">رفض الحجز</span>
                              </button>
                            ` : ''}
                            ${pay && pay.owed > 0 ? `
                              <button class="btn btn--xs btn--accent-quiet" data-action="pay" data-id="${b.id}" title="تسجيل دفعة">
                                <i data-lucide="banknote"></i><span class="btn-label">تحصيل</span>
                              </button>
                            ` : ''}
                            ${accepted && b.total_price == null ? `
                              <button class="btn btn--xs btn--accent-quiet" data-action="set-price" data-id="${b.id}" title="تحديد السعر">
                                <i data-lucide="tag"></i><span class="btn-label">حدّد السعر</span>
                              </button>
                            ` : ''}
                            ${accepted && b.customers && b.customers.phone ? `
                              <a class="btn btn--xs ${needsConfirm ? 'btn--wa' : 'btn--wa-quiet'}" data-action="whatsapp" data-id="${b.id}" href="${window.utils.escapeHtml(buildWhatsAppUrl(b, venueName))}" target="_blank" rel="noopener" title="${needsConfirm ? 'أكّد الموعد للعميل عبر واتساب' : 'تواصل عبر واتساب (تم التأكيد سابقاً)'}">
                                <i data-lucide="message-circle"></i><span class="btn-label">${needsConfirm ? 'أكّد الموعد للعميل' : 'تواصل واتساب'}</span>
                              </a>
                            ` : ''}
                            ${effStatus === 'cancelled' ? `
                              <button class="btn btn--xs btn--secondary" data-action="restore" data-id="${b.id}" title="استعادة">
                                <i data-lucide="rotate-ccw"></i><span class="btn-label">استعادة الحجز</span>
                              </button>
                            ` : ''}
                            ${effStatus === 'confirmed' && window.utils.isBookingPast(b) ? `
                              <button class="btn btn--xs btn--danger-quiet" data-action="no-show" data-id="${b.id}" title="لم يحضر">
                                <i data-lucide="user-x"></i><span class="btn-label">لم يحضر</span>
                              </button>
                            ` : ''}
                            ${effStatus === 'no_show' ? `
                              <button class="btn btn--xs btn--secondary" data-action="undo-no-show" data-id="${b.id}" title="تراجع">
                                <i data-lucide="undo-2"></i><span class="btn-label">تراجع عن الوسم</span>
                              </button>
                            ` : ''}
                            ${effStatus === 'confirmed' ? `
                              <button class="btn btn--xs btn--ghost" data-action="edit" data-id="${b.id}" title="تعديل">
                                <i data-lucide="pencil"></i><span class="btn-label">تعديل الحجز</span>
                              </button>
                            ` : `
                              <button class="btn btn--xs btn--ghost" data-action="edit" data-id="${b.id}" title="التفاصيل">
                                <i data-lucide="eye"></i><span class="btn-label">التفاصيل</span>
                              </button>
                            `}
                          </div>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `;

          // الفتح عبر زر التعديل الصريح فقط (لا نقر على الصف/الكرت)
          tableContainer.querySelectorAll('[data-action="approve"]').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
              e.stopPropagation();
              btn.disabled = true;
              try {
                const approved = await window.api.approveBooking(btn.dataset.id);
                window.utils.toast('تم تأكيد الحجز', 'success');
                window.bookingWhatsApp.offerConfirmation(approved, venueName, refresh);
                refresh();
              } catch (err) {
                btn.disabled = false;
                window.utils.toast(window.utils.formatError(err), 'error');
              }
            });
          });

          tableContainer.querySelectorAll('[data-action="reject"]').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
              e.stopPropagation();
              const ok = await window.utils.confirm({
                title: 'رفض الحجز',
                message: 'هل أنت متأكد من رفض هذا الحجز؟ سيتحرر الموعد للحجوزات الأخرى.',
                confirmText: 'تأكيد الرفض',
                danger: true
              });
              if (!ok) return;
              btn.disabled = true;
              try {
                await window.api.rejectBooking(btn.dataset.id);
                window.utils.toast('تم رفض الحجز', 'success');
                refresh();
              } catch (err) {
                btn.disabled = false;
                window.utils.toast(window.utils.formatError(err), 'error');
              }
            });
          });

          tableContainer.querySelectorAll('[data-action="restore"]').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
              e.stopPropagation();
              const ok = await window.utils.confirm({
                title: 'استعادة الحجز',
                message: 'سيعود الحجز مؤكدًا ويحتاج تأكيدًا جديدًا للعميل عبر واتساب. استعادته؟',
                confirmText: 'استعادة'
              });
              if (!ok) return;
              btn.disabled = true;
              try {
                await window.api.restoreBooking(btn.dataset.id);
                window.utils.toast('تمت استعادة الحجز — أكّد الموعد للعميل', 'success');
                refresh();
              } catch (err) {
                btn.disabled = false;
                // 23P01: قيد منع التعارض — حُجز الموعد لغير هذا العميل بعد الإلغاء
                if (err && err.code === '23P01') {
                  window.utils.toast('تعذّرت الاستعادة — الموعد لم يعد متاحًا، يوجد حجز يتعارض معه', 'error');
                } else {
                  window.utils.toast(window.utils.formatError(err), 'error');
                }
              }
            });
          });

          tableContainer.querySelectorAll('[data-action="pay"]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const booking = bookings.find((b) => b.id === btn.dataset.id);
              openPaymentDialog(booking, refresh);
            });
          });

          tableContainer.querySelectorAll('[data-action="set-price"]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const booking = bookings.find((b) => b.id === btn.dataset.id);
              openPriceDialog(booking, refresh);
            });
          });

          tableContainer.querySelectorAll('[data-action="no-show"]').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
              e.stopPropagation();
              const booking = bookings.find((x) => x.id === btn.dataset.id);
              const owed = booking ? window.utils.bookingOwed(booking) : null;
              const ok = await window.utils.confirm({
                title: 'تسجيل عدم حضور',
                message: `سيُؤرشف الحجز ويُسجَّل الغياب في سجل العميل${owed > 0 ? '، وتسقط المطالبة بالمتبقي (' + fmtMoney(owed) + ')' : ''}${Number(booking && booking.paid_amount || 0) > 0 ? '. المبلغ المحصَّل يبقى مسجلًا لك' : ''}. تسجيل؟`,
                confirmText: 'لم يحضر',
                danger: true
              });
              if (!ok) return;
              btn.disabled = true;
              try {
                await window.api.markNoShow(btn.dataset.id);
                window.utils.toast('سُجّل عدم الحضور', 'success');
                refresh();
              } catch (err) {
                btn.disabled = false;
                window.utils.toast(window.utils.formatError(err), 'error');
              }
            });
          });

          tableContainer.querySelectorAll('[data-action="undo-no-show"]').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
              e.stopPropagation();
              btn.disabled = true;
              try {
                await window.api.unmarkNoShow(btn.dataset.id);
                window.utils.toast('تم التراجع عن وسم الغياب', 'success');
                refresh();
              } catch (err) {
                btn.disabled = false;
                window.utils.toast(window.utils.formatError(err), 'error');
              }
            });
          });

          tableContainer.querySelectorAll('[data-action="edit"]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const booking = bookings.find((b) => b.id === btn.dataset.id);
              window.bookingModal.open({ booking, onSaved: refresh });
            });
          });

          // زر واتساب: نترك الرابط يفتح المحادثة، ونسجّل أن التأكيد أُرسل ثم نُحدّث الصف
          tableContainer.querySelectorAll('[data-action="whatsapp"]').forEach((a) => {
            a.addEventListener('click', () => {
              const booking = bookings.find((b) => b.id === a.dataset.id);
              if (booking) window.bookingWhatsApp.markSent(booking).then(refresh);
            });
          });

          window.utils.renderIcons(container);
        } catch (err) {
          if (!alive) return;
          tableContainer.innerHTML = `
            <div class="card">
              <div class="empty-state">
                <div class="empty-icon"><i data-lucide="triangle-alert"></i></div>
                <p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p>
              </div>
            </div>
          `;
          window.utils.renderIcons(container);
        }
      }

      function resetFilters() {
        filterFrom.value = '';
        filterTo.value = '';
        filterField.value = '';
        filterStatus.value = '';
        refresh();
      }

      const filterEls = [filterFrom, filterTo, filterField, filterStatus];
      filterEls.forEach((el) => el.addEventListener('change', refresh));
      resetBtn.addEventListener('click', resetFilters);
      addBtn.addEventListener('click', () => window.bookingModal.open({ onSaved: refresh }));

      // حجب موعد — كان في التقويم وحده، وهو فعلٌ على البيانات لا على العرض
      const blockBtn = container.querySelector('#block-slot-btn');
      if (blockBtn) blockBtn.addEventListener('click', () => {
        window.blockSlotModal.open({ fields: allFields, onBlocked: refresh });
      });

      cleanup.push(() => {
        alive = false;
        filterEls.forEach((el) => el.removeEventListener('change', refresh));
      });

      if (window.realtime) {
        const debounced = window.utils.debounce(refresh, 400);
        cleanup.push(window.realtime.on('bookings:change', debounced));
      }

      refresh();
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages.bookings = page;
})();
