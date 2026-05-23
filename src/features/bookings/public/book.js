// صفحة الحجز العامة — متاحة بدون تسجيل دخول.
// واجهة العميل النهائي — الأكثر ظهوراً.
// تصميم 2026: hero غني + sticky stepper + custom calendar + Google Maps embed
//                + slot filter + summary modal + cinematic success.

(async function () {
  const root = document.getElementById('root');
  const tenantId = window.utils.getQueryParam('t');

  if (!tenantId) {
    renderErrorView('الرابط غير صالح', 'لم يتم تحديد ملعب. تأكد من فتح الرابط الصحيح.');
    return;
  }

  // ─── State مركزي ────────────────────────────────────────────────
  const state = {
    tenantInfo: null,
    selectedField: null,
    selectedDate: null,        // 'YYYY-MM-DD'
    selectedSlot: null,        // { startIso, endIso, price }
    slotFilter: 'all',         // all|morning|afternoon|evening
    cachedSlots: new Map(),    // key: `${fieldId}|${date}` → slots
    currentSlots: []           // الذي يُعرض حالياً (بعد filter)
  };

  // ─── Init ───────────────────────────────────────────────────────
  try {
    const { data, error } = await window.sb.rpc('get_public_tenant_info', { p_tenant_id: tenantId });
    if (error) throw error;
    state.tenantInfo = data;
  } catch (err) {
    console.error(err);
    renderErrorView('تعذّر تحميل بيانات الملعب', window.utils.formatError(err));
    return;
  }

  if (!state.tenantInfo) {
    renderErrorView('الملعب غير موجود', 'يبدو أن الرابط غير صحيح. تواصل مع إدارة الملعب.');
    return;
  }
  if (state.tenantInfo.is_active === false) {
    renderErrorView('الملعب غير متاح حالياً', 'هذا الملعب معطل مؤقتاً. يرجى التواصل مع إدارة الملعب لاحقاً.');
    return;
  }
  if (!state.tenantInfo.fields || state.tenantInfo.fields.length === 0) {
    renderErrorView('لا توجد أرضيات متاحة', 'لا توجد أرضيات نشطة في هذا الملعب حالياً. تواصل مع إدارة الملعب.');
    return;
  }

  renderBookView();

  // ═══════════════════════════════════════════════════════════════
  // RENDERERS (shells)
  // ═══════════════════════════════════════════════════════════════

  function renderBookView() {
    root.innerHTML = `
      <header class="bp-hero" id="bp-hero"></header>
      <nav class="bp-stepper" id="bp-stepper" aria-label="مراحل الحجز"></nav>

      <section class="bp-section" id="bp-section-field" data-step="field">
        <div class="bp-section-head">
          <h2 class="bp-section-title">
            <span class="bp-section-title-num">١</span>
            <span>اختر الأرضية</span>
          </h2>
        </div>
        <div id="bp-fields-host"></div>
      </section>

      <section class="bp-section" id="bp-section-map" data-step="map" hidden>
        <div class="bp-section-head">
          <h2 class="bp-section-title">
            <span class="bp-section-title-num"><i data-lucide="map-pin"></i></span>
            <span>موقع الملعب</span>
          </h2>
        </div>
        <div id="bp-map-host"></div>
      </section>

      <section class="bp-section" id="bp-section-date" data-step="date">
        <div class="bp-section-head">
          <h2 class="bp-section-title">
            <span class="bp-section-title-num">٢</span>
            <span>اختر التاريخ</span>
          </h2>
        </div>
        <div id="bp-calendar-host"></div>
      </section>

      <section class="bp-section" id="bp-section-slot" data-step="slot">
        <div class="bp-section-head">
          <h2 class="bp-section-title">
            <span class="bp-section-title-num">٣</span>
            <span>اختر الموعد</span>
          </h2>
        </div>
        <div id="bp-slots-host"></div>
      </section>

      <section class="bp-section" id="bp-section-form" data-step="form">
        <div class="bp-section-head">
          <h2 class="bp-section-title">
            <span class="bp-section-title-num">٤</span>
            <span>بياناتك</span>
          </h2>
        </div>
        <div id="bp-form-host"></div>
      </section>

      <div id="bp-action-bar-host"></div>
    `;

    mountHero(document.getElementById('bp-hero'));
    mountStepper(document.getElementById('bp-stepper'));
    mountFields(document.getElementById('bp-fields-host'));
    mountCalendar(document.getElementById('bp-calendar-host'));
    mountSlots(document.getElementById('bp-slots-host'));
    mountCustomerForm(document.getElementById('bp-form-host'));
    mountActionBar(document.getElementById('bp-action-bar-host'));

    window.utils.renderIcons(root);
  }

  function renderErrorView(title, message) {
    root.innerHTML = `
      <div class="bp-empty" style="margin-top:var(--space-12)">
        <div class="bp-empty-icon"><i data-lucide="triangle-alert"></i></div>
        <h3>${window.utils.escapeHtml(title)}</h3>
        <p>${window.utils.escapeHtml(message)}</p>
      </div>
    `;
    window.utils.renderIcons(root);
  }

  // ═══════════════════════════════════════════════════════════════
  // HERO
  // ═══════════════════════════════════════════════════════════════

  function mountHero(host) {
    const t = state.tenantInfo;
    const cities = Array.from(new Set(t.fields.map((f) => f.city).filter(Boolean)));
    const primaryCity = cities[0];
    const primaryPhone = t.fields.find((f) => f.phone)?.phone;

    host.innerHTML = `
      <div class="bp-hero-top">
        <a class="bp-hero-brand" href="${window.utils.path('/index.html')}">
          <img class="bp-hero-mark" src="${window.utils.path('/assets/logo-mark.svg')}" alt="" aria-hidden="true">
          <span class="bp-hero-brand-name">مَرمى</span>
        </a>
        <div class="bp-hero-tools">
          <button type="button" class="btn btn--ghost btn--sm" id="bp-manage-btn">
            <i data-lucide="ticket"></i>
            <span>حجوزاتي</span>
          </button>
        </div>
      </div>

      <span class="bp-hero-tag">
        <span class="bp-hero-tag-dot"></span>
        احجز موعدك في 30 ثانية
      </span>

      <h1 class="bp-hero-title">${window.utils.escapeHtml(t.name)}</h1>
      <p class="bp-hero-lead">سيتواصل معك الملعب لتأكيد الحجز.</p>

      <ul class="bp-hero-meta">
        ${primaryCity ? `<li><i data-lucide="map-pin"></i>${window.utils.escapeHtml(primaryCity)}</li>` : ''}
        ${primaryPhone ? `<li><a href="tel:${window.utils.escapeHtml(primaryPhone)}"><i data-lucide="phone"></i>${window.utils.escapeHtml(primaryPhone)}</a></li>` : ''}
        <li><i data-lucide="goal"></i>${t.fields.length} ${t.fields.length === 1 ? 'أرضية' : 'أرضيات'}</li>
      </ul>
    `;

    document.getElementById('bp-manage-btn').addEventListener('click', () => {
      renderManageEntryView();
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // STEPPER (sticky + IntersectionObserver)
  // ═══════════════════════════════════════════════════════════════

  function mountStepper(host) {
    const steps = [
      { key: 'field', label: 'الأرضية', num: '١' },
      { key: 'date',  label: 'التاريخ', num: '٢' },
      { key: 'slot',  label: 'الموعد',  num: '٣' },
      { key: 'form',  label: 'بياناتك', num: '٤' }
    ];
    host.innerHTML = `
      <ol class="bp-stepper-list">
        ${steps.map((s) => `
          <li>
            <button type="button" class="bp-stepper-step" data-step="${s.key}">
              <span class="bp-stepper-dot"><span class="bp-stepper-dot-num">${s.num}</span></span>
              <span class="bp-stepper-label">${s.label}</span>
            </button>
          </li>
        `).join('')}
      </ol>
    `;

    host.querySelectorAll('[data-step]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const section = document.querySelector(`section[data-step="${btn.dataset.step}"]`);
        if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // IntersectionObserver لتفعيل الـ step تلقائياً حسب scroll
    const sections = document.querySelectorAll('section[data-step]');
    const stepperBtns = host.querySelectorAll('[data-step]');
    const observer = new IntersectionObserver((entries) => {
      let topMost = null;
      let topMostY = Infinity;
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const y = entry.boundingClientRect.top;
          if (y < topMostY) { topMostY = y; topMost = entry.target; }
        }
      });
      if (topMost) {
        const stepKey = topMost.dataset.step;
        stepperBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.step === stepKey));
      }
    }, { rootMargin: '-80px 0px -50% 0px', threshold: 0 });
    sections.forEach((s) => observer.observe(s));
  }

  // ═══════════════════════════════════════════════════════════════
  // FIELDS
  // ═══════════════════════════════════════════════════════════════

  function mountFields(host) {
    const fields = state.tenantInfo.fields;
    host.innerHTML = `
      <div class="bp-fields-grid" id="bp-fields-grid">
        ${fields.map((f) => `
          <button type="button" class="bp-field-card" data-id="${f.id}">
            <div class="bp-field-card-icon"><i data-lucide="goal"></i></div>
            <div class="bp-field-card-body">
              <h3 class="bp-field-card-name">${window.utils.escapeHtml(f.name)}</h3>
              <div class="bp-field-card-meta">
                ${f.city ? `<span><i data-lucide="map-pin"></i>${window.utils.escapeHtml(f.city)}</span>` : ''}
                ${f.phone ? `<span><i data-lucide="phone"></i>${window.utils.escapeHtml(f.phone)}</span>` : ''}
              </div>
            </div>
            <span class="bp-field-card-check" aria-hidden="true"><i data-lucide="check"></i></span>
          </button>
        `).join('')}
      </div>
    `;

    host.querySelectorAll('.bp-field-card').forEach((card) => {
      card.addEventListener('click', () => selectField(card.dataset.id));
    });

    // اختر تلقائياً لو فيه أرضية واحدة فقط
    if (fields.length === 1) selectField(fields[0].id);
  }

  function selectField(fieldId) {
    const field = state.tenantInfo.fields.find((f) => f.id === fieldId);
    if (!field) return;
    state.selectedField = field;
    state.selectedSlot = null;

    document.querySelectorAll('.bp-field-card').forEach((c) => {
      c.classList.toggle('is-selected', c.dataset.id === fieldId);
    });

    // أظهر قسم الخريطة بعد اختيار أرضية
    const mapSection = document.getElementById('bp-section-map');
    mapSection.hidden = false;
    mountMap(document.getElementById('bp-map-host'));

    // اجلب slots لو في تاريخ مختار
    if (state.selectedDate) refreshSlots();
    refreshActionBar();
  }

  // ═══════════════════════════════════════════════════════════════
  // MAP CARD
  // ═══════════════════════════════════════════════════════════════

  function buildMapEmbedUrl(field, tenant) {
    if (field.location_url) {
      return `https://www.google.com/maps?q=${encodeURIComponent(field.location_url)}&output=embed`;
    }
    const parts = [tenant.name, field.name, field.city].filter(Boolean);
    return `https://www.google.com/maps?q=${encodeURIComponent(parts.join(' '))}&output=embed`;
  }
  function buildMapOpenUrl(field, tenant) {
    if (field.location_url) return field.location_url;
    const parts = [tenant.name, field.name, field.city].filter(Boolean);
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.join(' '))}`;
  }
  function buildWhatsAppUrl(phone) {
    if (!phone) return null;
    const digits = String(phone).replace(/\D/g, '');
    const intl = digits.startsWith('966') ? digits : (digits.startsWith('0') ? '966' + digits.slice(1) : '966' + digits);
    return `https://wa.me/${intl}?text=${encodeURIComponent('السلام عليكم، لدي استفسار عن الحجز')}`;
  }

  function mountMap(host) {
    const f = state.selectedField;
    if (!f) { host.innerHTML = ''; return; }
    const t = state.tenantInfo;
    const embedUrl = buildMapEmbedUrl(f, t);
    const openUrl = buildMapOpenUrl(f, t);
    const waUrl = buildWhatsAppUrl(f.phone);

    host.innerHTML = `
      <aside class="bp-map-card" data-state="loading">
        <header class="bp-map-card-head">
          <div>
            <strong class="bp-map-card-title">${window.utils.escapeHtml(f.name)}</strong>
            ${f.city ? `<span class="bp-map-card-sub"><i data-lucide="map-pin"></i>${window.utils.escapeHtml(f.city)}</span>` : ''}
          </div>
          <a class="btn btn--ghost btn--sm" href="${window.utils.escapeHtml(openUrl)}" target="_blank" rel="noopener">
            <i data-lucide="navigation"></i>
            <span>افتح في الخرائط</span>
          </a>
        </header>
        <div class="bp-map-frame">
          <div class="bp-map-loading"><div class="loader"></div><span>جاري تحميل الخريطة...</span></div>
          <iframe class="bp-map-iframe" loading="lazy" referrerpolicy="no-referrer-when-downgrade"
                  allow="fullscreen" title="موقع الملعب على الخريطة"></iframe>
          <div class="bp-map-fallback">
            <i data-lucide="map-pinned"></i>
            <strong>تعذّر عرض الخريطة</strong>
            <p style="margin:0;font-size:var(--text-sm)">يمكنك فتح الموقع مباشرة في تطبيق الخرائط.</p>
            <a class="btn btn--secondary btn--sm" href="${window.utils.escapeHtml(openUrl)}" target="_blank" rel="noopener">
              <i data-lucide="external-link"></i>
              افتح موقع الملعب
            </a>
          </div>
        </div>
        <footer class="bp-map-card-foot">
          ${f.phone ? `
            <a class="bp-map-action" href="tel:${window.utils.escapeHtml(f.phone)}">
              <i data-lucide="phone"></i>
              <span>اتصال</span>
            </a>
          ` : `
            <span class="bp-map-action" style="opacity:0.4;cursor:not-allowed">
              <i data-lucide="phone"></i><span>اتصال</span>
            </span>
          `}
          ${waUrl ? `
            <a class="bp-map-action" href="${window.utils.escapeHtml(waUrl)}" target="_blank" rel="noopener">
              <i data-lucide="message-circle"></i>
              <span>واتساب</span>
            </a>
          ` : `
            <span class="bp-map-action" style="opacity:0.4;cursor:not-allowed">
              <i data-lucide="message-circle"></i><span>واتساب</span>
            </span>
          `}
          <a class="bp-map-action" href="${window.utils.escapeHtml(openUrl)}" target="_blank" rel="noopener">
            <i data-lucide="navigation"></i>
            <span>اتجاهات</span>
          </a>
        </footer>
      </aside>
    `;
    window.utils.renderIcons(host);

    const card = host.querySelector('.bp-map-card');
    const iframe = card.querySelector('.bp-map-iframe');
    const failTimer = setTimeout(() => { card.dataset.state = 'error'; }, 8000);
    iframe.addEventListener('load', () => {
      clearTimeout(failTimer);
      card.dataset.state = 'ok';
    }, { once: true });
    iframe.src = embedUrl;
  }

  // ═══════════════════════════════════════════════════════════════
  // CALENDAR (custom, RTL-aware)
  // ═══════════════════════════════════════════════════════════════

  function mountCalendar(host) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = toIsoDate(today);
    state.selectedDate = todayIso;

    const cal = createCalendar({
      container: host,
      initialDate: today,
      minDate: today,
      onSelect: (date) => {
        state.selectedDate = toIsoDate(date);
        state.selectedSlot = null;
        refreshSlots();
        refreshActionBar();
      }
    });
  }

  function createCalendar({ container, initialDate, onSelect, minDate }) {
    let cursorMonth = new Date(initialDate.getFullYear(), initialDate.getMonth(), 1);
    let selected = new Date(initialDate);

    const arNum = new Intl.NumberFormat('ar-EG');
    const arMonth = new Intl.DateTimeFormat('ar-EG', { month: 'long', year: 'numeric' });
    const arWeekday = new Intl.DateTimeFormat('ar-EG', { weekday: 'short' });

    function build() {
      const weekdaysHtml = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(2024, 11, 1 + i); // 2024-12-01 was Sunday
        return `<span>${arWeekday.format(d)}</span>`;
      }).join('');

      container.innerHTML = `
        <div class="bp-calendar">
          <div class="bp-calendar-bar">
            <button type="button" class="bp-calendar-nav" data-dir="prev" aria-label="الشهر السابق">
              <i data-lucide="chevron-right"></i>
            </button>
            <h3 class="bp-calendar-title">${arMonth.format(cursorMonth)}</h3>
            <button type="button" class="bp-calendar-nav" data-dir="next" aria-label="الشهر التالي">
              <i data-lucide="chevron-left"></i>
            </button>
          </div>
          <div class="bp-calendar-weekdays">${weekdaysHtml}</div>
          <div class="bp-calendar-grid"></div>
          <div class="bp-calendar-jump">
            <button type="button" class="btn btn--ghost btn--sm" data-jump="today">اليوم</button>
            <button type="button" class="btn btn--ghost btn--sm" data-jump="tomorrow">غدًا</button>
            <button type="button" class="btn btn--ghost btn--sm" data-jump="weekend">الجمعة</button>
          </div>
        </div>
      `;

      renderGrid();
      window.utils.renderIcons(container);

      container.querySelector('[data-dir="prev"]').addEventListener('click', () => navigate(-1));
      container.querySelector('[data-dir="next"]').addEventListener('click', () => navigate(1));
      container.querySelectorAll('[data-jump]').forEach((btn) => {
        btn.addEventListener('click', () => jumpTo(btn.dataset.jump));
      });

      // disable prev لو cursorMonth = شهر minDate
      if (minDate && cursorMonth.getFullYear() === minDate.getFullYear() && cursorMonth.getMonth() === minDate.getMonth()) {
        container.querySelector('[data-dir="prev"]').disabled = true;
      }
    }

    function renderGrid() {
      const grid = container.querySelector('.bp-calendar-grid');
      const year = cursorMonth.getFullYear();
      const month = cursorMonth.getMonth();
      const firstDay = new Date(year, month, 1).getDay();        // 0=Sunday
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const today = new Date(); today.setHours(0, 0, 0, 0);

      let html = '';
      for (let i = 0; i < firstDay; i++) {
        html += `<button type="button" class="bp-calendar-day is-empty" aria-hidden="true"></button>`;
      }
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month, d);
        const isPast = minDate ? date < minDate : false;
        const isToday = date.getTime() === today.getTime();
        const isSelected = selected && date.getTime() === new Date(selected).setHours(0, 0, 0, 0);
        const cls = ['bp-calendar-day'];
        if (isPast) cls.push('is-past');
        if (isToday) cls.push('is-today');
        if (isSelected) cls.push('is-selected');
        html += `
          <button type="button" class="${cls.join(' ')}" ${isPast ? 'disabled' : ''} data-date="${toIsoDate(date)}">
            <span>${arNum.format(d)}</span>
            ${isToday ? '<span class="bp-calendar-day-dot"></span>' : ''}
          </button>
        `;
      }
      grid.innerHTML = html;
      grid.querySelectorAll('.bp-calendar-day:not(.is-empty):not(:disabled)').forEach((btn) => {
        btn.addEventListener('click', () => {
          const [y, m, d] = btn.dataset.date.split('-').map(Number);
          selectDay(new Date(y, m - 1, d));
        });
      });
    }

    function selectDay(date) {
      selected = date;
      renderGrid();
      onSelect && onSelect(date);
    }

    function navigate(dir) {
      cursorMonth = new Date(cursorMonth.getFullYear(), cursorMonth.getMonth() + dir, 1);
      build();
    }

    function jumpTo(target) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      let target_date;
      if (target === 'today') target_date = today;
      else if (target === 'tomorrow') target_date = new Date(today.getTime() + 86400000);
      else if (target === 'weekend') {
        // اقفز للجمعة القادمة (day 5)
        const d = new Date(today);
        const diff = (5 - d.getDay() + 7) % 7 || 7;
        d.setDate(d.getDate() + diff);
        target_date = d;
      }
      cursorMonth = new Date(target_date.getFullYear(), target_date.getMonth(), 1);
      selected = target_date;
      build();
      onSelect && onSelect(target_date);
    }

    build();
    return { setSelected: (d) => { selected = d; renderGrid(); } };
  }

  function toIsoDate(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // ═══════════════════════════════════════════════════════════════
  // SLOTS
  // ═══════════════════════════════════════════════════════════════

  function mountSlots(host) {
    host.innerHTML = `
      <div class="bp-slots-filter" id="bp-slots-filter" role="tablist">
        <button type="button" class="bp-slots-filter-btn is-active" data-period="all">الكل</button>
        <button type="button" class="bp-slots-filter-btn" data-period="morning">صباحًا</button>
        <button type="button" class="bp-slots-filter-btn" data-period="afternoon">ظهرًا</button>
        <button type="button" class="bp-slots-filter-btn" data-period="evening">مساءً</button>
      </div>
      <div id="bp-slots-info"></div>
      <div id="bp-slots-body">
        <div class="bp-empty">
          <div class="bp-empty-icon"><i data-lucide="hand-pointing"></i></div>
          <h3>اختر الأرضية والتاريخ أولاً</h3>
          <p>ستظهر هنا المواعيد المتاحة.</p>
        </div>
      </div>
    `;
    window.utils.renderIcons(host);

    host.querySelectorAll('[data-period]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.slotFilter = btn.dataset.period;
        host.querySelectorAll('[data-period]').forEach((b) => b.classList.toggle('is-active', b === btn));
        renderSlotsBody();
      });
    });

    refreshSlots();
  }

  async function refreshSlots() {
    if (!state.selectedField || !state.selectedDate) return;
    const body = document.getElementById('bp-slots-body');
    const info = document.getElementById('bp-slots-info');
    if (!body) return;

    const cacheKey = `${state.selectedField.id}|${state.selectedDate}`;
    if (state.cachedSlots.has(cacheKey)) {
      state.currentSlots = state.cachedSlots.get(cacheKey);
      renderSlotsBody();
      return;
    }

    body.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
    info.innerHTML = '';

    try {
      const { data, error } = await window.sb.rpc('get_available_slots', {
        p_tenant_id: tenantId,
        p_field_id: state.selectedField.id,
        p_date: state.selectedDate
      });
      if (error) throw error;
      const slots = (data || []).filter((s) => !s.is_past);
      state.cachedSlots.set(cacheKey, slots);
      state.currentSlots = slots;
      renderSlotsBody();
    } catch (err) {
      body.innerHTML = `<div class="bp-empty"><p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p></div>`;
    }
  }

  function bucketSlots(slots, period) {
    if (period === 'all') return slots;
    return slots.filter((s) => {
      const h = new Date(s.slot_start).getHours();
      if (period === 'morning')   return h >= 5 && h < 12;
      if (period === 'afternoon') return h >= 12 && h < 17;
      if (period === 'evening')   return h >= 17 || h < 5;
      return true;
    });
  }

  function renderSlotsBody() {
    const body = document.getElementById('bp-slots-body');
    const info = document.getElementById('bp-slots-info');
    if (!body) return;

    const filtered = bucketSlots(state.currentSlots, state.slotFilter);
    const availableInFiltered = filtered.filter((s) => s.is_available).length;
    const totalAvailable = state.currentSlots.filter((s) => s.is_available).length;

    if (state.currentSlots.length === 0) {
      info.innerHTML = '';
      body.innerHTML = `
        <div class="bp-empty">
          <div class="bp-empty-icon"><i data-lucide="calendar-x"></i></div>
          <h3>لا توجد مواعيد لهذا التاريخ</h3>
          <p>جرّب تاريخاً آخر أو تواصل مع الملعب.</p>
        </div>
      `;
      window.utils.renderIcons(body);
      return;
    }

    info.innerHTML = totalAvailable > 0
      ? `<div class="bp-slots-info"><i data-lucide="info"></i><span><strong>${availableInFiltered}</strong> من <strong>${totalAvailable}</strong> موعد متاح</span></div>`
      : `<div class="bp-slots-info" style="background:var(--warning-tint);color:var(--warning)"><i data-lucide="alert-circle"></i><span>لا مواعيد متاحة في هذا اليوم</span></div>`;

    if (filtered.length === 0) {
      body.innerHTML = `
        <div class="bp-empty">
          <div class="bp-empty-icon"><i data-lucide="filter-x"></i></div>
          <h3>لا مواعيد في هذه الفترة</h3>
          <p>جرّب فترة أخرى أو "الكل".</p>
        </div>
      `;
      window.utils.renderIcons(body);
      window.utils.renderIcons(info);
      return;
    }

    const html = filtered.map((s) => {
      const startIso = new Date(s.slot_start).toISOString();
      const endIso   = new Date(s.slot_end).toISOString();
      const price = s.slot_price !== undefined ? Number(s.slot_price) : null;
      const isSelected = state.selectedSlot && state.selectedSlot.startIso === startIso;
      const cls = ['bp-slot'];
      if (!s.is_available) cls.push('is-busy');
      if (isSelected) cls.push('is-selected');
      const priceLabel = !s.is_available ? 'محجوز' : (price ? window.utils.formatCurrency(price) : 'متاح');
      return `
        <button type="button" class="${cls.join(' ')}" ${!s.is_available ? 'disabled' : ''}
                data-start="${startIso}" data-end="${endIso}" data-price="${price || ''}">
          <span class="bp-slot-time">${window.utils.formatTime(s.slot_start)}</span>
          <span class="bp-slot-price">${priceLabel}</span>
        </button>
      `;
    }).join('');

    body.innerHTML = `<div class="bp-slots-grid">${html}</div>`;
    window.utils.renderIcons(info);

    body.querySelectorAll('.bp-slot:not(:disabled)').forEach((btn) => {
      btn.addEventListener('click', () => selectSlot(btn));
    });
  }

  function selectSlot(btn) {
    state.selectedSlot = {
      startIso: btn.dataset.start,
      endIso: btn.dataset.end,
      price: btn.dataset.price ? Number(btn.dataset.price) : 0
    };
    document.querySelectorAll('.bp-slot').forEach((b) => b.classList.toggle('is-selected', b === btn));
    refreshActionBar();
  }

  // ═══════════════════════════════════════════════════════════════
  // CUSTOMER FORM
  // ═══════════════════════════════════════════════════════════════

  function mountCustomerForm(host) {
    host.innerHTML = `
      <form id="bp-customer-form" class="bp-customer-form" autocomplete="on">
        <div class="form-group" style="margin:0">
          <label class="form-label" for="bp-cf-name">الاسم الكامل <span class="required">*</span></label>
          <input type="text" class="form-control" id="bp-cf-name" name="customer_name" required>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label" for="bp-cf-phone">رقم الجوال <span class="required">*</span></label>
          <input type="tel" class="form-control" id="bp-cf-phone" name="customer_phone" required placeholder="05XXXXXXXX" dir="ltr" style="text-align:start">
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label" for="bp-cf-notes">ملاحظات <span class="optional">اختياري</span></label>
          <textarea class="form-control" id="bp-cf-notes" name="notes" rows="2" placeholder="مثلاً: عدد اللاعبين، طلبات خاصة…"></textarea>
        </div>
      </form>
    `;
    const form = document.getElementById('bp-customer-form');
    window.utils.bindPhoneInput(form.customer_phone);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      openSummaryAndSubmit();
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // ACTION BAR
  // ═══════════════════════════════════════════════════════════════

  function mountActionBar(host) {
    host.innerHTML = `
      <div class="bp-action-bar" id="bp-action-bar" data-state="empty">
        <div class="bp-action-empty">
          <i data-lucide="arrow-up"></i>
          <span>اختر موعدك من الأعلى</span>
        </div>
        <div class="bp-action-summary">
          <div class="bp-action-price">
            <span class="bp-action-price-amt" id="bp-action-amt">0</span>
            <small>ر.س</small>
          </div>
          <div class="bp-action-meta">
            <span class="bp-action-meta-row" id="bp-action-date"><i data-lucide="calendar"></i></span>
            <span class="bp-action-meta-row" id="bp-action-time"><i data-lucide="clock"></i></span>
          </div>
        </div>
        <button type="button" class="btn btn--primary btn--lg bp-action-cta" id="bp-action-cta" disabled>
          <span>متابعة</span>
          <i data-lucide="arrow-left"></i>
        </button>
      </div>
    `;
    window.utils.renderIcons(host);
    document.getElementById('bp-action-cta').addEventListener('click', () => {
      handleContinue();
    });
  }

  function refreshActionBar() {
    const bar = document.getElementById('bp-action-bar');
    const cta = document.getElementById('bp-action-cta');
    if (!bar) return;
    if (!state.selectedSlot) {
      bar.dataset.state = 'empty';
      cta.disabled = true;
      return;
    }
    bar.dataset.state = 'ready';
    cta.disabled = false;
    const start = new Date(state.selectedSlot.startIso);
    const end = new Date(state.selectedSlot.endIso);
    document.getElementById('bp-action-amt').textContent = window.utils.formatCurrency(state.selectedSlot.price || 0).replace(' ر.س', '');
    document.getElementById('bp-action-date').innerHTML = `<i data-lucide="calendar"></i>${window.utils.formatDate(start)}`;
    document.getElementById('bp-action-time').innerHTML = `<i data-lucide="clock"></i>${window.utils.formatTime(start)} → ${window.utils.formatTime(end)}`;
    window.utils.renderIcons(bar);
  }

  function handleContinue() {
    // قفز ذكي للقسم التالي غير المكتمل
    const form = document.getElementById('bp-customer-form');
    const name = form && form.customer_name.value.trim();
    const phone = form && form.customer_phone.value.trim();

    if (!name || !phone) {
      document.getElementById('bp-section-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => { (name ? form.customer_phone : form.customer_name).focus(); }, 400);
      return;
    }
    if (!window.utils.isValidSaudiPhone(phone)) {
      window.utils.toast('رقم الجوال يجب أن يبدأ بـ 05 ويتكون من 10 أرقام', 'error');
      form.customer_phone.focus();
      return;
    }
    openSummaryAndSubmit();
  }

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY MODAL + SUBMIT
  // ═══════════════════════════════════════════════════════════════

  async function openSummaryAndSubmit() {
    const form = document.getElementById('bp-customer-form');
    const customerName = form.customer_name.value.trim();
    const customerPhone = form.customer_phone.value.trim();
    const notes = (form.notes.value || '').trim() || null;

    if (!state.selectedField || !state.selectedSlot) {
      window.utils.toast('اختر الأرضية والموعد أولاً', 'error');
      return;
    }
    if (!customerName) { window.utils.toast('اكتب اسمك', 'error'); form.customer_name.focus(); return; }
    if (!window.utils.isValidSaudiPhone(customerPhone)) {
      window.utils.toast('رقم الجوال يجب أن يبدأ بـ 05 ويتكون من 10 أرقام', 'error');
      form.customer_phone.focus();
      return;
    }

    const start = new Date(state.selectedSlot.startIso);
    const end = new Date(state.selectedSlot.endIso);

    const body = document.createElement('div');
    body.innerHTML = `
      <div class="bp-summary">
        <div class="bp-summary-block">
          <div class="bp-summary-row">
            <span class="bp-summary-label"><i data-lucide="map-pin"></i>الملعب</span>
            <strong>${window.utils.escapeHtml(state.tenantInfo.name)}</strong>
          </div>
          <div class="bp-summary-row">
            <span class="bp-summary-label"><i data-lucide="goal"></i>الأرضية</span>
            <strong>${window.utils.escapeHtml(state.selectedField.name)}</strong>
          </div>
          <div class="bp-summary-row">
            <span class="bp-summary-label"><i data-lucide="calendar"></i>التاريخ</span>
            <strong>${window.utils.formatDate(start)}</strong>
          </div>
          <div class="bp-summary-row">
            <span class="bp-summary-label"><i data-lucide="clock"></i>الوقت</span>
            <strong class="tabular-nums">${window.utils.formatTime(start)} → ${window.utils.formatTime(end)}</strong>
          </div>
        </div>
        <div class="bp-summary-block">
          <div class="bp-summary-row">
            <span class="bp-summary-label"><i data-lucide="user"></i>الاسم</span>
            <strong>${window.utils.escapeHtml(customerName)}</strong>
          </div>
          <div class="bp-summary-row">
            <span class="bp-summary-label"><i data-lucide="phone"></i>الجوال</span>
            <strong dir="ltr">${window.utils.escapeHtml(customerPhone)}</strong>
          </div>
        </div>
        <div class="bp-summary-total">
          <span>الإجمالي</span>
          <strong>${window.utils.formatCurrency(state.selectedSlot.price || 0)}</strong>
        </div>
        <p class="bp-summary-note">سيتواصل معك الملعب لتأكيد الحجز.</p>
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:8px;width:100%';
    footer.innerHTML = `
      <button type="button" class="btn btn--ghost" data-action="cancel">تراجع</button>
      <div style="flex:1"></div>
      <button type="button" class="btn btn--primary" data-action="confirm" id="bp-confirm-btn">
        <i data-lucide="check"></i>
        <span>تأكيد الحجز</span>
      </button>
    `;

    const ctrl = window.utils.openModal({
      title: 'مراجعة الحجز',
      body, footer
    });

    let settled = false;
    const close = () => { if (!settled) { settled = true; ctrl.close(); } };
    ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', close);

    const confirmBtn = ctrl.modal.querySelector('#bp-confirm-btn');
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      confirmBtn.dataset.loading = 'true';
      try {
        const { data, error } = await window.sb.rpc('create_pending_booking', {
          p_tenant_id: tenantId,
          p_field_id: state.selectedField.id,
          p_start_time: state.selectedSlot.startIso,
          p_customer_name: customerName,
          p_customer_phone: customerPhone,
          p_notes: notes
        });
        if (error) throw error;
        settled = true;
        ctrl.close();
        renderSuccessView({
          bookingId: data.booking_id,
          totalPrice: data.total_price,
          fieldName: state.selectedField.name,
          start, end: new Date(data.end_time || state.selectedSlot.endIso),
          customerName
        });
      } catch (err) {
        window.utils.toast(window.utils.formatError(err), 'error');
        confirmBtn.disabled = false;
        delete confirmBtn.dataset.loading;
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // SUCCESS VIEW
  // ═══════════════════════════════════════════════════════════════

  function renderSuccessView({ bookingId, totalPrice, fieldName, start, end, customerName }) {
    const shortId = String(bookingId).slice(0, 8);
    const shareText = `حجزت في ${state.tenantInfo.name} - ${fieldName}\nالتاريخ: ${window.utils.formatDate(start)}\nالوقت: ${window.utils.formatTime(start)} → ${window.utils.formatTime(end)}`;
    const shareUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

    root.innerHTML = `
      <div class="bp-success">
        <div class="bp-success-confetti" aria-hidden="true">
          <span></span><span></span><span></span><span></span><span></span><span></span>
        </div>
        <span class="bp-success-check">
          <svg class="bp-success-check-svg" viewBox="0 0 60 60" aria-hidden="true">
            <circle class="bp-success-check-bg" cx="30" cy="30" r="26"/>
            <path class="bp-success-check-mark" d="M 19 31 L 27 39 L 43 22"/>
          </svg>
        </span>
        <h2 class="bp-success-title">تم استلام طلبك!</h2>
        <p class="bp-success-sub">شكراً ${window.utils.escapeHtml(customerName)}، سنتواصل معك قريباً.</p>

        <button type="button" class="bp-success-id" id="bp-copy-id" title="انسخ الرقم">
          <span>رقم الطلب</span>
          <code>${shortId}</code>
          <i data-lucide="copy"></i>
        </button>

        <div class="card bp-success-card">
          <div class="card-body" style="display:flex;flex-direction:column;gap:var(--space-3)">
            <div class="bp-summary-row">
              <span class="bp-summary-label"><i data-lucide="map-pin"></i>الملعب</span>
              <strong>${window.utils.escapeHtml(state.tenantInfo.name)}</strong>
            </div>
            <div class="bp-summary-row">
              <span class="bp-summary-label"><i data-lucide="goal"></i>الأرضية</span>
              <strong>${window.utils.escapeHtml(fieldName)}</strong>
            </div>
            <div class="bp-summary-row">
              <span class="bp-summary-label"><i data-lucide="calendar"></i>التاريخ</span>
              <strong>${window.utils.formatDate(start)}</strong>
            </div>
            <div class="bp-summary-row">
              <span class="bp-summary-label"><i data-lucide="clock"></i>الوقت</span>
              <strong class="tabular-nums">${window.utils.formatTime(start)} → ${window.utils.formatTime(end)}</strong>
            </div>
            <div class="bp-summary-total" style="margin-top:var(--space-2)">
              <span>الإجمالي</span>
              <strong>${window.utils.formatCurrency(totalPrice)}</strong>
            </div>
          </div>
        </div>

        <div class="bp-success-actions">
          <button type="button" class="btn btn--secondary" id="bp-ics-btn">
            <i data-lucide="calendar-plus"></i>
            أضف للتقويم
          </button>
          <a class="btn btn--secondary" href="${window.utils.escapeHtml(shareUrl)}" target="_blank" rel="noopener">
            <i data-lucide="share-2"></i>
            شارك في واتساب
          </a>
          <button type="button" class="btn btn--ghost" onclick="window.location.reload()">
            <i data-lucide="rotate-cw"></i>
            حجز آخر
          </button>
        </div>
      </div>
    `;
    window.utils.renderIcons(root);

    document.getElementById('bp-copy-id').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(String(bookingId));
        window.utils.toast('تم نسخ رقم الطلب', 'success');
      } catch (_) {
        window.prompt('انسخ الرقم:', String(bookingId));
      }
    });

    document.getElementById('bp-ics-btn').addEventListener('click', () => {
      const f = state.selectedField;
      const location = (f && f.location_url) || (f && f.city ? `${state.tenantInfo.name} - ${f.city}` : state.tenantInfo.name);
      downloadICS({
        title: `حجز ${state.tenantInfo.name} — ${fieldName}`,
        description: `حجز رقم ${shortId} لـ ${customerName}`,
        location, start, end
      });
    });
  }

  function downloadICS({ title, description, location, start, end }) {
    const fmt = (d) => {
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
    };
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Marma//Booking//AR',
      'BEGIN:VEVENT', `UID:${Date.now()}@marma`,
      `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
      `SUMMARY:${title}`, `DESCRIPTION:${description}`, `LOCATION:${location || ''}`,
      'END:VEVENT', 'END:VCALENDAR'
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

  // ═══════════════════════════════════════════════════════════════
  // MANAGE VIEWS
  // ═══════════════════════════════════════════════════════════════

  function renderManageEntryView() {
    root.innerHTML = `
      <header class="bp-hero">
        <div class="bp-hero-top">
          <a class="bp-hero-brand" href="${window.utils.path('/index.html')}">
            <img class="bp-hero-mark" src="${window.utils.path('/assets/logo-mark.svg')}" alt="" aria-hidden="true">
            <span class="bp-hero-brand-name">مَرمى</span>
          </a>
        </div>
        <span class="bp-hero-tag">
          <span class="bp-hero-tag-dot"></span>
          إدارة حجوزاتي
        </span>
        <h1 class="bp-hero-title">${window.utils.escapeHtml(state.tenantInfo.name)}</h1>
      </header>

      <section class="bp-manage-entry">
        <div class="bp-manage-entry-card">
          <h2>أدخل رقم جوالك</h2>
          <p>سنعرض حجوزاتك القادمة في هذا الملعب.</p>
          <input type="tel" class="form-control" id="bp-manage-phone" placeholder="05XXXXXXXX" dir="ltr" style="text-align:start" autocomplete="tel">
          <button type="button" class="btn btn--primary btn--lg" id="bp-manage-lookup">
            <i data-lucide="search"></i>
            <span>عرض حجوزاتي</span>
          </button>
          <button type="button" class="btn btn--ghost" id="bp-manage-back">
            <i data-lucide="arrow-right"></i>
            <span>رجوع لصفحة الحجز</span>
          </button>
        </div>
      </section>
    `;
    window.utils.renderIcons(root);

    const phoneInput = document.getElementById('bp-manage-phone');
    const lookupBtn = document.getElementById('bp-manage-lookup');
    window.utils.bindPhoneInput(phoneInput);

    document.getElementById('bp-manage-back').addEventListener('click', () => renderBookView());

    const doLookup = async () => {
      const phone = phoneInput.value.trim();
      if (!window.utils.isValidSaudiPhone(phone)) {
        window.utils.toast('رقم الجوال يجب أن يبدأ بـ 05 ويتكون من 10 أرقام', 'error');
        phoneInput.focus();
        return;
      }
      lookupBtn.disabled = true;
      lookupBtn.dataset.loading = 'true';
      try {
        const { data, error } = await window.sb.rpc('list_customer_bookings', {
          p_tenant_id: tenantId, p_phone: phone
        });
        if (error) throw error;
        renderManageListView(phone, data);
      } catch (err) {
        window.utils.toast(window.utils.formatError(err), 'error');
        lookupBtn.disabled = false;
        delete lookupBtn.dataset.loading;
      }
    };
    lookupBtn.addEventListener('click', doLookup);
    phoneInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doLookup(); }
    });
  }

  function renderManageListView(phone, data) {
    const bookings = (data && data.bookings) || [];

    const statusLabels = {
      pending:   { text: 'بانتظار الموافقة', cls: 'badge--warning', card: 'is-pending' },
      confirmed: { text: 'مؤكد',             cls: 'badge--success', card: 'is-confirmed' }
    };

    const listHtml = bookings.length ? `
      <ul class="bp-bookings-list">
        ${bookings.map((b) => {
          const start = new Date(b.start_time);
          const end = new Date(b.end_time);
          const s = statusLabels[b.status] || { text: b.status, cls: '', card: '' };
          return `
            <li class="bp-booking-item ${s.card}">
              <div class="bp-booking-item-head">
                <span class="badge ${s.cls}">${s.text}</span>
                <span class="bp-booking-item-id">#${window.utils.escapeHtml(String(b.id).slice(0, 8))}</span>
              </div>
              <h4 class="bp-booking-item-field">${window.utils.escapeHtml(b.field_name || '')}</h4>
              <div class="bp-booking-item-meta">
                <span><i data-lucide="calendar"></i>${window.utils.formatDate(start)}</span>
                <span><i data-lucide="clock"></i>${window.utils.formatTime(start)} → ${window.utils.formatTime(end)}</span>
                ${b.field_city ? `<span><i data-lucide="map-pin"></i>${window.utils.escapeHtml(b.field_city)}</span>` : ''}
              </div>
              <div class="bp-booking-item-foot">
                <span class="bp-booking-item-price">${window.utils.formatCurrency(b.total_price)}</span>
                ${b.is_cancellable ? `
                  <button type="button" class="btn btn--danger btn--sm" data-cancel-id="${b.id}">
                    <i data-lucide="x-circle"></i>
                    <span>إلغاء</span>
                  </button>
                ` : ''}
              </div>
            </li>
          `;
        }).join('')}
      </ul>
    ` : `
      <div class="bp-empty">
        <div class="bp-empty-icon"><i data-lucide="calendar-x"></i></div>
        <h3>لا توجد حجوزات قادمة</h3>
        <p>لم نجد حجوزات لهذا الرقم في هذا الملعب.</p>
      </div>
    `;

    root.innerHTML = `
      <header class="bp-hero">
        <div class="bp-hero-top">
          <a class="bp-hero-brand" href="${window.utils.path('/index.html')}">
            <img class="bp-hero-mark" src="${window.utils.path('/assets/logo-mark.svg')}" alt="" aria-hidden="true">
            <span class="bp-hero-brand-name">مَرمى</span>
          </a>
        </div>
        <span class="bp-hero-tag">
          <span class="bp-hero-tag-dot"></span>
          حجوزاتي · ${window.utils.escapeHtml(phone)}
        </span>
        <h1 class="bp-hero-title">${window.utils.escapeHtml((data && data.tenant_name) || state.tenantInfo.name)}</h1>
      </header>

      ${listHtml}

      <div style="text-align:center;margin-top:var(--space-5);display:flex;justify-content:center;gap:var(--space-2);flex-wrap:wrap">
        <button type="button" class="btn btn--ghost" id="bp-manage-other">
          <i data-lucide="user"></i>
          <span>رقم آخر</span>
        </button>
        <button type="button" class="btn btn--ghost" id="bp-manage-tobook">
          <i data-lucide="plus"></i>
          <span>حجز موعد آخر</span>
        </button>
      </div>
    `;
    window.utils.renderIcons(root);

    document.getElementById('bp-manage-other').addEventListener('click', () => renderManageEntryView());
    document.getElementById('bp-manage-tobook').addEventListener('click', () => renderBookView());

    root.querySelectorAll('[data-cancel-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ok = await window.utils.confirm({
          title: 'تأكيد الإلغاء',
          message: 'هل أنت متأكد من إلغاء هذا الحجز؟',
          confirmText: 'نعم، ألغِ الحجز',
          cancelText: 'تراجع',
          danger: true
        });
        if (!ok) return;
        btn.disabled = true;
        btn.dataset.loading = 'true';
        try {
          const { error } = await window.sb.rpc('cancel_booking_by_phone', {
            p_tenant_id: tenantId,
            p_booking_id: btn.dataset.cancelId,
            p_phone: phone
          });
          if (error) throw error;
          window.utils.toast('تم إلغاء الحجز', 'success');
          const { data: refreshed, error: refErr } = await window.sb.rpc('list_customer_bookings', {
            p_tenant_id: tenantId, p_phone: phone
          });
          if (refErr) throw refErr;
          renderManageListView(phone, refreshed);
        } catch (err) {
          const msg = err && err.message ? err.message : String(err);
          if (msg.includes('PHONE_MISMATCH')) {
            window.utils.toast('الرقم لا يطابق صاحب الحجز', 'error');
          } else if (msg.includes('NOT_CANCELLABLE_STATUS')) {
            window.utils.toast('لا يمكن إلغاء هذا الحجز في وضعه الحالي', 'error');
          } else if (msg.includes('BOOKING_ALREADY_STARTED')) {
            window.utils.toast('بدأ موعد الحجز — لا يمكن إلغاؤه', 'error');
          } else {
            window.utils.toast(window.utils.formatError(err), 'error');
          }
          btn.disabled = false;
          delete btn.dataset.loading;
        }
      });
    });
  }
})();
