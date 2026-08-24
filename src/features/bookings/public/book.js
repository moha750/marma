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

  window.addEventListener('hashchange', dispatchRoute);
  dispatchRoute();

  // ═══════════════════════════════════════════════════════════════
  // ROUTER (hash-based: '' = landing, '#/field/<id>' = field detail)
  // ═══════════════════════════════════════════════════════════════

  function parseHash() {
    const h = (location.hash || '').replace(/^#\/?/, '');
    if (!h) return { view: 'landing' };
    const segs = h.split('/').filter(Boolean);
    if (segs[0] === 'field' && segs[1]) {
      return { view: 'field', fieldId: decodeURIComponent(segs[1]) };
    }
    return { view: 'landing' };
  }

  function navigateTo(hash, replace) {
    const url = `${location.pathname}${location.search}${hash}`;
    if (replace) location.replace(url);
    else         location.hash = hash;
  }

  function dispatchRoute() {
    const route = parseHash();
    // ابدأ كل شاشة من الأعلى — لا تَرِث موضع تمرير الشاشة السابقة
    window.scrollTo(0, 0);
    if (route.view === 'field') {
      const field = state.tenantInfo.fields.find((f) => f.id === route.fieldId);
      if (!field) { navigateTo('#/', true); return; }
      state.selectedField = field;
      state.selectedSlot = null;
      state.selectedDate = null;
      renderFieldDetailView();
      return;
    }
    // landing — صفحة المستأجر (واجهته) تظهر دائماً، حتى مع أرضية واحدة
    state.selectedField = null;
    state.selectedSlot = null;
    renderTenantLandingView();
  }

  // ═══════════════════════════════════════════════════════════════
  // RENDERERS (shells)
  // ═══════════════════════════════════════════════════════════════

  // فوتر الإسناد — مشترك في كل شاشات العميل (الإسناد الوحيد لمَرمى)
  function renderFooter() {
    return `
      <footer class="bp-landing-foot">
        <small>مدعوم بـ <a href="${window.utils.path('/index.html')}">مَرمى</a></small>
      </footer>
    `;
  }

  function renderTenantLandingView() {
    const t = state.tenantInfo;
    const hasCover = !!t.cover_image_url;
    const hasAbout = !!(t.description && t.description.trim());

    root.innerHTML = `
      <header class="bp-hero bp-hero--tenant" id="bp-hero"></header>
      ${renderCardBanner()}
      ${hasAbout ? `
        <section class="bp-section">
          <h2 class="bp-section-title"><i data-lucide="info"></i><span>عن الملعب</span></h2>
          <p class="bp-about-text">${window.utils.escapeHtml(t.description)}</p>
        </section>
      ` : ''}
      <section class="bp-section">
        <h2 class="bp-section-title">
          <i data-lucide="goal"></i>
          <span>الأرضيات المتاحة</span>
        </h2>
        <div class="bp-landing-fields" id="bp-landing-fields"></div>
      </section>
      ${renderManageBanner()}
      ${renderFooter()}
    `;

    mountTenantHero(document.getElementById('bp-hero'), { hasCover });
    mountLandingFields(document.getElementById('bp-landing-fields'));
    window.utils.renderIcons(root);
  }

  function renderFieldDetailView() {
    root.innerHTML = `
      <header class="bp-hero bp-hero--field" id="bp-hero"></header>
      <nav class="bp-stepper" id="bp-stepper" aria-label="مراحل الحجز"></nav>

      <section class="bp-section" id="bp-section-info" data-step="info">
        <div id="bp-field-info-host"></div>
      </section>

      <section class="bp-section" id="bp-section-date" data-step="date">
        <div class="bp-section-head">
          <h2 class="bp-section-title">
            <span class="bp-section-title-num">1</span>
            <span>اختر التاريخ</span>
          </h2>
        </div>
        <div id="bp-calendar-host"></div>
      </section>

      <section class="bp-section" id="bp-section-slot" data-step="slot">
        <div class="bp-section-head">
          <h2 class="bp-section-title">
            <span class="bp-section-title-num">2</span>
            <span>اختر الموعد</span>
          </h2>
        </div>
        <div id="bp-slots-host"></div>
      </section>

      <section class="bp-section" id="bp-section-form" data-step="form">
        <div class="bp-section-head">
          <h2 class="bp-section-title">
            <span class="bp-section-title-num">3</span>
            <span>بياناتك</span>
          </h2>
        </div>
        <div id="bp-form-host"></div>
      </section>

      ${renderFooter()}

      <div id="bp-action-bar-host"></div>
    `;

    mountFieldHero(document.getElementById('bp-hero'), { showBreadcrumb: true });
    mountStepper(document.getElementById('bp-stepper'), [
      { key: 'date', label: 'التاريخ', num: '1' },
      { key: 'slot', label: 'الموعد',  num: '2' },
      { key: 'form', label: 'بياناتك', num: '3' }
    ]);
    mountFieldInfo(document.getElementById('bp-field-info-host'));
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
  // HERO (نسختان: tenant landing + field detail)
  // ═══════════════════════════════════════════════════════════════

  // بانر واضح للعملاء العائدين — بديل زر الزاوية القديم.
  // يُحقن في عرض الـ landing وعرض تفاصيل الأرضية (لتغطية مستأجري الأرضية الواحدة).
  // المالك يتحكم بإظهاره من الإعدادات (show_manage_banner) — الافتراضي ظاهر.
  function renderManageBanner() {
    if (state.tenantInfo.show_manage_banner === false) return '';
    return `
      <section class="bp-manage-banner">
        <span class="bp-manage-banner-icon"><i data-lucide="ticket"></i></span>
        <div class="bp-manage-banner-body">
          <h3 class="bp-manage-banner-title">هل لديك حجز سابق؟</h3>
          <p class="bp-manage-banner-text">تابع تفاصيل حجوزاتك، أو عدّلها وألغِها بسهولة عبر رقم جوّالك.</p>
        </div>
        <button type="button" class="btn btn--primary bp-manage-banner-btn" id="bp-manage-btn">
          <i data-lucide="ticket"></i>
          <span>عرض حجوزاتي</span>
        </button>
      </section>
    `;
  }

  // بابُ البطاقة مستقلٌّ عن بانر الحجوزات عمداً. ذاك يخفيه المالك ليمنع العميل
  // من إلغاء حجوزاته — سلطةٌ على تقويمه؛ وهذا توزيعٌ مجاني يريده. غرضان
  // متعاكسان لا يجوز أن يحكمهما مفتاح واحد. فشرطه واحد: أن يكون له برنامج.
  // وموضعه تحت اسم الملعب مباشرةً — عرضٌ يريده المالك أن يُرى، لا ذيلَ صفحة.
  function renderCardBanner() {
    if (!state.tenantInfo.loyalty_active) return '';
    return `
      <section class="bp-manage-banner bp-card-banner">
        <span class="bp-manage-banner-icon"><i data-lucide="wallet"></i></span>
        <div class="bp-manage-banner-body">
          <h3 class="bp-manage-banner-title">بطاقة الولاء</h3>
          <p class="bp-manage-banner-text">كل حجز يقرّبك من مكافأتك — أصدر بطاقتك برقم جوّالك.</p>
        </div>
        <button type="button" class="btn btn--primary bp-manage-banner-btn" id="bp-card-btn">
          <i data-lucide="wallet"></i>
          <span>بطاقتي</span>
        </button>
      </section>
    `;
  }

  function bindManageBtn() {
    const btn = document.getElementById('bp-manage-btn');
    if (btn) btn.addEventListener('click', () => renderManageEntryView());
    const card = document.getElementById('bp-card-btn');
    if (card) card.addEventListener('click', () => renderManageEntryView());
  }

  function mountTenantHero(host, { hasCover }) {
    const t = state.tenantInfo;
    // الغلاف اختياري — يظهر فقط عند رفع صورة فعلية؛ بلا placeholder يوحي بـ "ناقص".
    const coverHtml = hasCover
      ? `<div class="bp-hero-cover"><img src="${window.utils.escapeHtml(t.cover_image_url)}" alt="غلاف ${window.utils.escapeHtml(t.name)}"></div>`
      : '';

    // شعار المالك (اختياري) — دائرة بجانب الاسم تعزز هوية النشاط أمام عملائه
    const logoHtml = t.logo_url
      ? `<img class="bp-hero-logo" src="${window.utils.escapeHtml(t.logo_url)}" alt="شعار ${window.utils.escapeHtml(t.name)}">`
      : '';

    host.innerHTML = `
      ${coverHtml}
      <span class="bp-hero-tag">
        <span class="bp-hero-tag-dot"></span>
        احجز موعدك في 30 ثانية
      </span>
      <div class="bp-hero-brand">
        ${logoHtml}
        <h1 class="bp-hero-title">${window.utils.escapeHtml(t.name)}</h1>
      </div>
    `;
    bindManageBtn();
  }

  function mountFieldHero(host, { showBreadcrumb }) {
    const t = state.tenantInfo;
    const f = state.selectedField;
    const surfaceLabel = f.surface_type ? (window.utils.SURFACE_LABELS[f.surface_type] || f.surface_type) : null;

    host.innerHTML = `
      ${showBreadcrumb ? `
        <nav class="bp-breadcrumb">
          <a data-back href="#/">
            <i data-lucide="arrow-right"></i>
            <span>رجوع لـ ${window.utils.escapeHtml(t.name)}</span>
          </a>
        </nav>
      ` : ''}
      <h1 class="bp-hero-title">${window.utils.escapeHtml(f.name)}</h1>
      <ul class="bp-hero-meta">
        ${f.city ? `<li><i data-lucide="map-pin"></i>${window.utils.escapeHtml(f.city)}</li>` : ''}
        ${f.phone ? `<li><a href="tel:${window.utils.escapeHtml(f.phone)}"><i data-lucide="phone"></i>${window.utils.escapeHtml(f.phone)}</a></li>` : ''}
        ${surfaceLabel ? `<li><i data-lucide="trees"></i>${window.utils.escapeHtml(surfaceLabel)}</li>` : ''}
      </ul>
    `;
    bindManageBtn();
    const backLink = host.querySelector('a[data-back]');
    if (backLink) {
      backLink.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo('#/');
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // STEPPER (sticky + IntersectionObserver)
  // ═══════════════════════════════════════════════════════════════

  function mountStepper(host, steps) {
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
  // LANDING FIELDS (بطاقات صفحة المنشأة — تنقّل لصفحة الأرضية)
  // ═══════════════════════════════════════════════════════════════

  function renderAmenityStrip(amenities, max) {
    if (!Array.isArray(amenities) || amenities.length === 0) return '';
    const labels = window.utils.AMENITY_LABELS || {};
    const shown = amenities.slice(0, max);
    const rest = amenities.length - shown.length;
    const items = shown.map((k) => `<li>${window.utils.escapeHtml(labels[k] || k)}</li>`).join('');
    const more = rest > 0 ? `<li class="bp-amenity-strip__more">+${rest}</li>` : '';
    return `<ul class="bp-amenity-strip">${items}${more}</ul>`;
  }

  function renderAmenityChips(amenities) {
    if (!Array.isArray(amenities) || amenities.length === 0) return '';
    const labels = window.utils.AMENITY_LABELS || {};
    const items = amenities.map((k) => `<li>${window.utils.escapeHtml(labels[k] || k)}</li>`).join('');
    return `<ul class="bp-amenity-strip" style="margin-top:var(--space-3)">${items}</ul>`;
  }

  function mountLandingFields(host) {
    const fields = state.tenantInfo.fields;
    host.innerHTML = fields.map((f) => {
      const cover = Array.isArray(f.image_urls) && f.image_urls.length ? f.image_urls[0] : null;
      const surfaceLabel = f.surface_type ? (window.utils.SURFACE_LABELS[f.surface_type] || f.surface_type) : null;
      return `
        <button type="button" class="bp-landing-field-card" data-id="${f.id}">
          <div class="bp-landing-field-card__media">
            ${cover
              ? `<img src="${window.utils.escapeHtml(cover)}" alt="" loading="lazy">`
              : `<i data-lucide="goal"></i>`}
            ${surfaceLabel ? `<span class="bp-surface-badge">${window.utils.escapeHtml(surfaceLabel)}</span>` : ''}
          </div>
          <div class="bp-landing-field-card__body">
            <h3>${window.utils.escapeHtml(f.name)}</h3>
            ${f.city ? `<p class="bp-landing-field-card__meta"><i data-lucide="map-pin"></i>${window.utils.escapeHtml(f.city)}</p>` : ''}
            ${renderAmenityStrip(f.amenities, 3)}
            <span class="bp-landing-field-card__cta">
              <span>احجز الآن</span>
              <i data-lucide="arrow-left"></i>
            </span>
          </div>
        </button>
      `;
    }).join('');

    host.querySelectorAll('.bp-landing-field-card').forEach((card) => {
      card.addEventListener('click', () => navigateTo(`#/field/${card.dataset.id}`));
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // FIELD INFO (في صفحة الأرضية: معرض + وصف + مزايا + خريطة)
  // ═══════════════════════════════════════════════════════════════

  function mountFieldInfo(host) {
    const f = state.selectedField;
    host.innerHTML = `
      <div id="bp-field-info-map"></div>
      ${f.description ? `<p class="bp-field-description">${window.utils.escapeHtml(f.description)}</p>` : ''}
      ${renderAmenityChips(f.amenities)}
    `;
    mountMap(host.querySelector('#bp-field-info-map'));
    window.utils.renderIcons(host);
  }

  // ═══════════════════════════════════════════════════════════════
  // MAP CARD
  // ═══════════════════════════════════════════════════════════════

  function buildMapEmbedUrl(field, tenant) {
    // الإحداثيات هي المصدر الوحيد الموثوق للـ embed: ?q=lat,lng يعرض دبوساً دقيقاً
    // بلا مفتاح API. لا نمرّر location_url هنا — Google's embed لا يتبع روابط
    // maps.app.goo.gl المختصرة فيُظهر خريطة العالم بدل الموقع.
    if (field.latitude != null && field.longitude != null) {
      return `https://www.google.com/maps?q=${field.latitude},${field.longitude}&z=17&output=embed`;
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
    const images = Array.isArray(f.image_urls) ? f.image_urls : [];
    // الإحداثيات هي الإشارة الوحيدة لموقع حقيقي (تأتي فقط من رابط مُتحقَّق عند الحفظ).
    // بدونها لا نعرض خريطة تقريبية تضلّل العميل، ولا أزرار موقع بلا وجهة حقيقية.
    const hasLocation = f.latitude != null && f.longitude != null;

    host.innerHTML = `
      <aside class="bp-map-card" data-state="${hasLocation ? 'loading' : 'ok'}">
        ${renderGalleryBlock(images, f.name)}
        <header class="bp-map-card-head">
          <div>
            <strong class="bp-map-card-title">${window.utils.escapeHtml(f.name)}</strong>
            ${f.city ? `<span class="bp-map-card-sub"><i data-lucide="map-pin"></i>${window.utils.escapeHtml(f.city)}</span>` : ''}
          </div>
          ${hasLocation ? `
          <a class="btn btn--ghost btn--sm" href="${window.utils.escapeHtml(openUrl)}" target="_blank" rel="noopener">
            <i data-lucide="navigation"></i>
            <span>افتح في الخرائط</span>
          </a>
          ` : ''}
        </header>
        ${hasLocation ? `
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
        ` : ''}
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
          ${hasLocation ? `
          <a class="bp-map-action" href="${window.utils.escapeHtml(openUrl)}" target="_blank" rel="noopener">
            <i data-lucide="navigation"></i>
            <span>اتجاهات</span>
          </a>
          ` : ''}
        </footer>
      </aside>
    `;
    window.utils.renderIcons(host);

    const card = host.querySelector('.bp-map-card');
    if (hasLocation) {
      const iframe = card.querySelector('.bp-map-iframe');
      const failTimer = setTimeout(() => { card.dataset.state = 'error'; }, 8000);
      iframe.addEventListener('load', () => {
        clearTimeout(failTimer);
        card.dataset.state = 'ok';
      }, { once: true });
      iframe.src = embedUrl;
    }

    // ربط lightbox على banner + thumbnails (إن وجدت)
    if (images.length > 0) {
      const banner = card.querySelector('.bp-map-card-banner');
      if (banner) banner.addEventListener('click', () => openLightbox(images, 0));
      card.querySelectorAll('.bp-gallery-thumb').forEach((thumb) => {
        thumb.addEventListener('click', () => {
          const idx = Number(thumb.dataset.index) || 0;
          openLightbox(images, idx);
        });
      });
    }
  }

  // ── معرض الصور: banner + شريط thumbnails (إن > 1) ─────────────
  function renderGalleryBlock(urls, alt) {
    if (!urls || urls.length === 0) return '';
    const safeAlt = window.utils.escapeHtml(alt || '');
    const cover = window.utils.escapeHtml(urls[0]);
    if (urls.length === 1) {
      return `<img class="bp-map-card-banner" src="${cover}" alt="${safeAlt}" loading="lazy">`;
    }
    const thumbs = urls.map((u, i) => `
      <button type="button" class="bp-gallery-thumb${i === 0 ? ' is-active' : ''}" data-index="${i}" aria-label="صورة ${i + 1}">
        <img src="${window.utils.escapeHtml(u)}" alt="" loading="lazy">
      </button>
    `).join('');
    return `
      <img class="bp-map-card-banner" src="${cover}" alt="${safeAlt}" loading="lazy">
      <div class="bp-gallery-thumbs">${thumbs}</div>
    `;
  }

  // ── Lightbox (vanilla، يدعم لوحة المفاتيح + swipe) ────────────
  function openLightbox(urls, startIndex) {
    if (!Array.isArray(urls) || urls.length === 0) return;
    let index = Math.max(0, Math.min(startIndex | 0, urls.length - 1));

    const overlay = document.createElement('div');
    overlay.className = 'bp-lightbox';
    overlay.innerHTML = `
      <button type="button" class="bp-lightbox__close" aria-label="إغلاق">
        <i data-lucide="x"></i>
      </button>
      <button type="button" class="bp-lightbox__nav bp-lightbox__nav--prev" aria-label="السابق" ${urls.length === 1 ? 'hidden' : ''}>
        <i data-lucide="chevron-right"></i>
      </button>
      <button type="button" class="bp-lightbox__nav bp-lightbox__nav--next" aria-label="التالي" ${urls.length === 1 ? 'hidden' : ''}>
        <i data-lucide="chevron-left"></i>
      </button>
      <img class="bp-lightbox__image" alt="">
      <div class="bp-lightbox__counter" ${urls.length === 1 ? 'hidden' : ''}></div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    window.utils.renderIcons(overlay);

    const imgEl = overlay.querySelector('.bp-lightbox__image');
    const counterEl = overlay.querySelector('.bp-lightbox__counter');

    function show(i) {
      index = (i + urls.length) % urls.length;
      imgEl.src = urls[index];
      if (counterEl) counterEl.textContent = `${index + 1} / ${urls.length}`;
    }
    function next() { show(index + 1); }
    function prev() { show(index - 1); }
    function close() {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      overlay.remove();
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') next();  // RTL: السهم الأيسر = للأمام
      else if (e.key === 'ArrowRight') prev();
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector('.bp-lightbox__close').addEventListener('click', close);
    overlay.querySelector('.bp-lightbox__nav--prev').addEventListener('click', (e) => { e.stopPropagation(); prev(); });
    overlay.querySelector('.bp-lightbox__nav--next').addEventListener('click', (e) => { e.stopPropagation(); next(); });
    document.addEventListener('keydown', onKey);

    // swipe على الموبايل
    let touchStartX = null;
    overlay.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) touchStartX = e.touches[0].clientX;
    }, { passive: true });
    overlay.addEventListener('touchend', (e) => {
      if (touchStartX === null) return;
      const dx = (e.changedTouches[0]?.clientX || 0) - touchStartX;
      touchStartX = null;
      if (Math.abs(dx) < 40 || urls.length === 1) return;
      // RTL: swipe من اليمين لليسار (dx<0) = التالي، العكس = السابق
      if (dx < 0) next(); else prev();
    });

    show(index);
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

    const arNum = new Intl.NumberFormat('ar-EG', { numberingSystem: 'latn' });
    const arMonth = new Intl.DateTimeFormat('ar-EG', { numberingSystem: 'latn', month: 'long', year: 'numeric' });
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
      <div class="bp-slots">
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
      const slots = (data || []);
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
    const availableInFiltered = filtered.filter((s) => s.is_available && !s.is_past).length;
    const totalAvailable = state.currentSlots.filter((s) => s.is_available && !s.is_past).length;

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
      const price = (s.slot_price === null || s.slot_price === undefined) ? null : Number(s.slot_price);
      const original = (s.original_price === null || s.original_price === undefined) ? null : Number(s.original_price);
      const hasOffer = !!s.offer_label && original != null && price != null && price < original;
      const isSelected = state.selectedSlot && state.selectedSlot.startIso === startIso;
      const cls = ['bp-slot'];
      if (s.is_past) cls.push('is-past');
      else if (!s.is_available) cls.push('is-busy');
      if (isSelected) cls.push('is-selected');
      if (hasOffer) cls.push('bp-slot--offer');
      let priceLabel;
      if (s.is_past) priceLabel = 'انتهى';
      else if (!s.is_available) priceLabel = 'محجوز';
      else if (hasOffer) priceLabel = `<span class="bp-slot-old">${window.utils.formatCurrency(original)}</span> ${window.utils.formatPrice(price)}`;
      else priceLabel = window.utils.formatPrice(price);
      return `
        <button type="button" class="${cls.join(' ')}" ${(s.is_past || !s.is_available) ? 'disabled' : ''}
                data-start="${startIso}" data-end="${endIso}" data-price="${price == null ? '' : price}">
          ${hasOffer ? `<span class="bp-slot-offer">${window.utils.escapeHtml(s.offer_label)}</span>` : ''}
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
      price: btn.dataset.price === '' ? null : Number(btn.dataset.price)
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
    const price = state.selectedSlot.price;
    const amtEl = document.getElementById('bp-action-amt');
    const unitEl = bar.querySelector('.bp-action-price small');
    if (price == null) { amtEl.textContent = 'عند التواصل'; if (unitEl) unitEl.style.display = 'none'; }
    else if (Number(price) === 0) { amtEl.textContent = 'مجاني'; if (unitEl) unitEl.style.display = 'none'; }
    else { amtEl.textContent = window.utils.formatCurrency(price).replace(' ر.س', ''); if (unitEl) unitEl.style.display = ''; }
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
  // بوابات الدفع — ما شغّله المالك (تحويل بنكي / محفظة رقمية / نقدًا)
  // ═══════════════════════════════════════════════════════════════

  // تظهر حين للحجز مبلغٌ فعليّ فقط: «عند التواصل» و«مجاني» لا مبلغَ فيهما
  // يُدفع، فعرضُ حسابٍ بنكيّ عندهما إرباكٌ لا خدمة.
  // الصورة نفسها يرسمها المكوّن المشترك — هي عينها التي يعاينها المالك.
  function renderPayBlock(price) {
    if (price == null || !(Number(price) > 0)) return '';
    const t = state.tenantInfo || {};
    // payment الحديث، وإلا payment_iban لخادمٍ لم تصله الهجرة بعد
    const payment = t.payment || (t.payment_iban ? { bank: { iban: t.payment_iban } } : null);
    if (!payment) return '';
    return window.paymentMethodsHtml(payment);
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
          <strong>${window.utils.formatPrice(state.selectedSlot.price)}</strong>
        </div>
        ${renderPayBlock(state.selectedSlot.price)}
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

    // تتبع القُمع: الزائر وصل لمراجعة الحجز (بدء حجز)
    if (window.track) window.track.event('booking_start', { tenant_id: tenantId, field_id: state.selectedField.id });

    const ctrl = window.utils.openModal({
      title: 'مراجعة الحجز',
      body, footer
    });

    let settled = false;
    const close = () => { if (!settled) { settled = true; ctrl.close(); } };
    ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', close);
    window.bindPaymentCopy(ctrl.modal);

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
        // تتبع القُمع: حجز مُنشأ فعلاً (تحويل مكتمل)
        if (window.track) window.track.event('booking_created', { tenant_id: tenantId, field_id: state.selectedField.id, booking_id: data.booking_id });
        settled = true;
        ctrl.close();
        renderSuccessView({
          bookingId: data.booking_id,
          totalPrice: data.total_price,
          fieldName: state.selectedField.name,
          start, end: new Date(data.end_time || state.selectedSlot.endIso),
          customerName, customerPhone
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

  function renderSuccessView({ bookingId, totalPrice, fieldName, start, end, customerName, customerPhone }) {
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
              <strong>${window.utils.formatPrice(totalPrice)}</strong>
            </div>
            ${renderPayBlock(totalPrice)}
          </div>
        </div>

        <div class="bp-success-actions">
          ${state.tenantInfo.loyalty_active ? `
            <button type="button" class="btn btn--secondary" id="bp-card-success">
              <i data-lucide="wallet"></i>
              بطاقتي
            </button>` : ''}
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
    window.bindPaymentCopy(root);

    // البطاقة لا توجد بعد وقت الحجز — تُصدر بعد انتهائه وسداده. فالزرّ يفتح
    // البابَ الدائم بالرقم الذي كتبه للتوّ، لا رابطَ بطاقةٍ لم تُخلق.
    const cardBtn = document.getElementById('bp-card-success');
    if (cardBtn) cardBtn.addEventListener('click', () => renderManageEntryView(customerPhone));

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

  // مفتاح المالك يحكم قسم الحجوزات نفسه لا بانره فقط. من أطفأه أراد منع
  // العميل من إلغاء حجوزاته؛ ولو حكم البانرَ وحده لصار بابُ البطاقة طريقاً
  // خلفياً إلى زرّ الإلغاء ذاته — إذ يُفضي الاثنان إلى الشاشة نفسها.
  function bookingsAllowed() {
    return state.tenantInfo.show_manage_banner !== false;
  }

  function renderManageEntryView(prefillPhone) {
    // بابٌ واحد لشيئين: البطاقة دائمة والحجوزات عابرة — والاسم يذكر الدائم
    // أولاً. ولولا ذلك لاختبأت البطاقة خلف بابٍ فارغٍ أغلبَ أيام السنة:
    // list_customer_bookings لا تُرجع إلا الحجوزات القادمة.
    const loyal = !!state.tenantInfo.loyalty_active;
    const withBookings = bookingsAllowed();
    root.innerHTML = `
      <header class="bp-hero">
        <span class="bp-hero-tag">
          <span class="bp-hero-tag-dot"></span>
          ${loyal && withBookings ? 'بطاقتي وحجوزاتي' : (loyal ? 'بطاقتي' : 'إدارة حجوزاتي')}
        </span>
        <h1 class="bp-hero-title">${window.utils.escapeHtml(state.tenantInfo.name)}</h1>
      </header>

      <section class="bp-manage-entry">
        <div class="bp-manage-entry-card">
          <h2>أدخل رقم جوالك</h2>
          <p>${loyal && withBookings
            ? 'نعرض لك بطاقة ولائك وحجوزاتك القادمة في هذا الملعب.'
            : (loyal ? 'نعرض لك بطاقة ولائك في هذا الملعب.' : 'سنعرض حجوزاتك القادمة في هذا الملعب.')}</p>
          <input type="tel" class="form-control" id="bp-manage-phone" placeholder="05XXXXXXXX" dir="ltr" style="text-align:start" autocomplete="tel"
            value="${window.utils.escapeHtml(prefillPhone || '')}">
          <button type="button" class="btn btn--primary btn--lg" id="bp-manage-lookup">
            <i data-lucide="search"></i>
            <span>${loyal && withBookings ? 'عرض بطاقتي وحجوزاتي' : (loyal ? 'عرض بطاقتي' : 'عرض حجوزاتي')}</span>
          </button>
          <button type="button" class="btn btn--ghost" id="bp-manage-back">
            <i data-lucide="arrow-right"></i>
            <span>رجوع لصفحة الحجز</span>
          </button>
        </div>
      </section>
      ${renderFooter()}
    `;
    window.utils.renderIcons(root);

    const phoneInput = document.getElementById('bp-manage-phone');
    const lookupBtn = document.getElementById('bp-manage-lookup');
    window.utils.bindPhoneInput(phoneInput);

    document.getElementById('bp-manage-back').addEventListener('click', () => dispatchRoute());

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
        // البطاقة لا تُفشل الحجوزات: لو تعثّرت دالّتها (ملعبٌ لم تُطبَّق عليه
        // المهاجرة بعد مثلاً) تُعرض القائمة كما كانت قبل هذه الميزة.
        // Promise.resolve حول نداء البطاقة: sb.rpc() يُرجع PostgrestFilterBuilder
        // — كائنٌ ثنائي القابلية (then) بلا catch، فاستدعاؤها عليه مباشرةً يسقط.
        const [bookingsRes, cardRes] = await Promise.all([
          bookingsAllowed()
            ? window.sb.rpc('list_customer_bookings', { p_tenant_id: tenantId, p_phone: phone })
            : Promise.resolve({ data: null }),
          state.tenantInfo.loyalty_active
            ? Promise.resolve(window.sb.rpc('loyalty_card_by_phone', { p_tenant_id: tenantId, p_phone: phone }))
                .catch(() => ({ data: null }))
            : Promise.resolve({ data: null })
        ]);
        if (bookingsRes.error) throw bookingsRes.error;
        renderManageListView(phone, bookingsRes.data, cardRes && cardRes.data);
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

  // شريط البطاقة: يجيب «هل لي بطاقة وأين وصلت؟» في لمحة، وبابه إلى ‎/card
  // حيث يعيش الكرت كاملاً بزرَّي المحفظتين واكتشاف النظام — جهةٌ واحدة تملكه
  // فلا تفترق نسختان. ولا يُطبع هنا رمز مكافأةٍ ولا رمز استبدال.
  function renderLoyaltyStrip(card) {
    if (!card || !card.serial) return '';
    const p = card.program || {};
    const esc = window.utils.escapeHtml;
    const thr = Number(card.threshold) || 0;
    const bal = Math.max(0, Number(card.balance) || 0);
    const ready = Number(card.rewards_available) || 0;
    const pct = thr > 0 ? Math.min(100, Math.round((bal / thr) * 100)) : 0;

    return `
      <section class="bp-loyalty" style="--wc-bg:${esc(p.brand_bg || '#0F3D2E')};--wc-fg:${esc(p.brand_fg || '#FFFFFF')};--wc-label:${esc(p.brand_label || '#FFFFFF')}">
        <div class="bp-loyalty-head">
          ${p.logo_url ? `<img class="bp-loyalty-logo" src="${esc(p.logo_url)}" alt="">` : ''}
          <div class="bp-loyalty-title">
            <strong>${esc(p.name || 'بطاقة الولاء')}</strong>
            <span>${esc(p.reward || '')}</span>
          </div>
          <div class="bp-loyalty-count"><bdi dir="ltr">${bal} / ${thr}</bdi></div>
        </div>
        <div class="bp-loyalty-bar"><span style="inline-size:${pct}%"></span></div>
        ${ready > 0
          ? `<p class="bp-loyalty-ready"><i data-lucide="gift"></i> لديك ${ready} مكافأة جاهزة — اعرضها عند الكاونتر</p>`
          : `<p class="bp-loyalty-left">باقٍ ${Math.max(0, thr - bal)} حجوزات على مكافأتك</p>`}
        <a class="btn btn--primary btn--lg bp-loyalty-btn" href="${esc(window.utils.path('/card'))}?c=${encodeURIComponent(card.serial)}">
          <i data-lucide="wallet"></i>
          <span>افتح بطاقتي وأضِفها للمحفظة</span>
        </a>
      </section>`;
  }

  // إصدار البطاقة بيد العميل. الخادم هو من يقرّر أيحتاج اسماً أم لا: من حجز
  // عندنا من قبل يكفيه رقمه، ومن لم يحجز يُسجَّل عميلاً باسمه ثم تُصدَر بطاقته.
  // فلا تسأل الواجهة عن اسمٍ قد لا يُحتاج، ولا تُخمّن من هو العميل.
  async function selfIssue(phone, bookingsData, name) {
    const btn = root.querySelector('[data-issue]');
    if (btn) { btn.disabled = true; btn.dataset.loading = 'true'; }
    try {
      const { data, error } = await window.sb.rpc('loyalty_self_issue', {
        p_tenant_id: tenantId, p_phone: phone, p_name: name || null
      });
      if (error) throw error;

      if (data && data.need_name) {
        const entered = await askCustomerName();
        if (!entered) {
          if (btn) { btn.disabled = false; delete btn.dataset.loading; }
          return;
        }
        return selfIssue(phone, bookingsData, entered);
      }

      window.utils.toast('صدرت بطاقتك — أضِفها لمحفظتك', 'success');
      renderManageListView(phone, bookingsData, data);
    } catch (err) {
      window.utils.toast(window.utils.formatError(err), 'error');
      if (btn) { btn.disabled = false; delete btn.dataset.loading; }
    }
  }

  function askCustomerName() {
    return new Promise((resolve) => {
      const ctrl = window.utils.openModal({
        title: 'اسمك',
        body: `
          <p class="text-muted text-sm" style="margin-block-start:0">
            أول مرة معنا — اكتب اسمك لتُصدَر بطاقتك باسمك.
          </p>
          <div class="form-group">
            <label class="form-label" for="bp-issue-name">الاسم <span class="required">*</span></label>
            <input class="form-control" id="bp-issue-name" maxlength="60" autocomplete="name">
          </div>`,
        footer: `
          <button type="button" class="btn btn--ghost" data-act="cancel">إلغاء</button>
          <button type="button" class="btn btn--primary" data-act="ok">أصدر بطاقتي</button>`
      });
      const input = ctrl.modal.querySelector('#bp-issue-name');
      const done = (v) => { ctrl.close(); resolve(v); };
      ctrl.modal.querySelector('[data-act="cancel"]').addEventListener('click', () => done(null));
      ctrl.modal.querySelector('[data-act="ok"]').addEventListener('click', () => {
        const v = input.value.trim();
        if (!v) { input.focus(); return; }
        done(v);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); ctrl.modal.querySelector('[data-act="ok"]').click(); }
      });
      setTimeout(() => input.focus(), 50);
    });
  }

  function renderManageListView(phone, data, card) {
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
                <span class="bp-booking-item-price">${window.utils.formatPrice(b.total_price)}</span>
                ${b.is_cancellable ? `
                  <button type="button" class="btn btn--danger btn--sm" data-cancel-id="${b.id}">
                    <i data-lucide="x-circle"></i>
                    <span>إلغاء</span>
                  </button>
                ` : ''}
              </div>
              ${!b.is_cancellable && b.has_payment ? `
                <p class="bp-booking-item-locked">
                  <i data-lucide="lock"></i>
                  <span>تم تحصيل مبلغ لهذا الحجز — للإلغاء تواصل مع الملعب</span>
                </p>
              ` : ''}
            </li>
          `;
        }).join('')}
      </ul>
    ` : `
      <div class="bp-empty">
        <div class="bp-empty-icon"><i data-lucide="calendar-x"></i></div>
        <h3>لا توجد حجوزات قادمة</h3>
        <p>${card ? 'احجز موعدك التالي وازدد ختماً على بطاقتك.' : 'لم نجد حجوزات لهذا الرقم في هذا الملعب.'}</p>
      </div>
    `;

    // البطاقة أولاً: هي الدائمة، والقائمة تحتها قد تفرغ في أغلب الأيام —
    // فراغُها بعد اليوم لا يترك الشاشة خاوية.
    const stripHtml = renderLoyaltyStrip(card);

    // لا بطاقة بعد: البطاقة لا تُصدَر إلا بيده — فالسطر دعوةٌ لا اعتذار.
    // ولا يُطلب الاسم هنا: الخادم يطلبه إن لم يكن الرقم لعميلٍ مسجَّل.
    const noCardHtml = (!stripHtml && state.tenantInfo.loyalty_active) ? `
      <section class="bp-loyalty bp-loyalty--empty">
        <p><i data-lucide="wallet"></i> لا بطاقة ولاء لهذا الرقم بعد.</p>
        <button type="button" class="btn btn--primary bp-loyalty-issue" data-issue="${window.utils.escapeHtml(phone)}">
          <i data-lucide="plus"></i>
          <span>أصدر بطاقتي الآن</span>
        </button>
      </section>` : '';

    root.innerHTML = `
      <header class="bp-hero">
        <span class="bp-hero-tag">
          <span class="bp-hero-tag-dot"></span>
          ${state.tenantInfo.loyalty_active
            ? (bookingsAllowed() ? 'بطاقتي وحجوزاتي' : 'بطاقتي')
            : 'حجوزاتي'} · ${window.utils.escapeHtml(phone)}
        </span>
        <h1 class="bp-hero-title">${window.utils.escapeHtml((data && data.tenant_name) || state.tenantInfo.name)}</h1>
      </header>

      ${stripHtml}
      ${noCardHtml}
      ${bookingsAllowed() ? listHtml : ''}

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
      ${renderFooter()}
    `;
    window.utils.renderIcons(root);

    const issueBtn = root.querySelector('[data-issue]');
    if (issueBtn) issueBtn.addEventListener('click', () => selfIssue(phone, data));

    document.getElementById('bp-manage-other').addEventListener('click', () => renderManageEntryView());
    document.getElementById('bp-manage-tobook').addEventListener('click', () => dispatchRoute());

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
          // مرّر البطاقة معها وإلا اختفت من الشاشة بعد أول إلغاء
          renderManageListView(phone, refreshed, card);
        } catch (err) {
          const msg = err && err.message ? err.message : String(err);
          if (msg.includes('PHONE_MISMATCH')) {
            window.utils.toast('الرقم لا يطابق صاحب الحجز', 'error');
          } else if (msg.includes('NOT_CANCELLABLE_STATUS')) {
            window.utils.toast('لا يمكن إلغاء هذا الحجز في وضعه الحالي', 'error');
          } else if (msg.includes('BOOKING_ALREADY_STARTED')) {
            window.utils.toast('بدأ موعد الحجز — لا يمكن إلغاؤه', 'error');
          } else if (msg.includes('BOOKING_PAID')) {
            window.utils.toast('تم تحصيل مبلغ لهذا الحجز — للإلغاء تواصل مع الملعب', 'error');
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
