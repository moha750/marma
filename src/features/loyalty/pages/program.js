// صفحة برنامج الولاء — قواعد المكافأة + هوية البطاقة + معاينة حيّة. للمالك فقط.
//
// المالك يحدّد كل شيء: كم ختماً، وما المكافأة (حجز مجاني/نسبة/مبلغ/عينية)،
// وقيمتها وسقفها وصلاحيتها. الخادم يتحقّق من كل قيمة ويولّد تسمية المكافأة.
//
// الهوية محكومة عمداً: ٣ قوالب معتمدة ولوحة ألوان من ١٢ لوناً بدل منتقٍ حر —
// البطاقة تعيش في جيب العميل وتمثّل مَرمى، وتباينها يجب أن يعبر WCAG AA دائماً.
// لون النص والتسميات يُشتقّان حسابياً من لون الخلفية فلا يستطيع أحد كسرهما.
(function () {
  // لوحة معتمدة — كلها داكنة بما يكفي لنص أبيض يتجاوز AA بفارق مريح
  const PALETTE = [
    { hex: '#0F3D2E', name: 'أخضر مَرمى' },
    { hex: '#14532D', name: 'أخضر غابة' },
    { hex: '#134E4A', name: 'أزرق مخضرّ' },
    { hex: '#0B3B5B', name: 'أزرق ليلي' },
    { hex: '#1E3A8A', name: 'أزرق ملكي' },
    { hex: '#3B0764', name: 'بنفسجي عميق' },
    { hex: '#4C1D95', name: 'بنفسجي' },
    { hex: '#7F1D1D', name: 'عنّابي' },
    { hex: '#7C2D12', name: 'نحاسي' },
    { hex: '#78350F', name: 'بنّي ذهبي' },
    { hex: '#1F2937', name: 'رمادي فحمي' },
    { hex: '#111827', name: 'أسود مزرق' }
  ];

  const TEMPLATES = [
    { key: 'classic', name: 'كلاسيكي', desc: 'لون صلب وشعارك وعدّاد نصّي — أنيق ومحايد', icon: 'credit-card' },
    { key: 'photo',   name: 'صورة الملعب', desc: 'صورة ملعبك شريطاً أعلى البطاقة', icon: 'image' },
    { key: 'stamps',  name: 'عدّاد الأختام', desc: 'دوائر بعدد الأختام تمتلئ مع كل حجز', icon: 'circle-check-big' }
  ];

  const REWARD_KINDS = [
    { key: 'free_booking',     label: 'حجز مجاني' },
    { key: 'percent_discount', label: 'خصم بنسبة' },
    { key: 'amount_discount',  label: 'خصم بمبلغ' },
    { key: 'free_item',        label: 'مكافأة عينية' }
  ];

  const DURATIONS = [
    { v: '',    label: 'الفترة كاملة مجاناً' },
    { v: '60',  label: '٦٠ دقيقة' },
    { v: '90',  label: '٩٠ دقيقة' },
    { v: '120', label: '١٢٠ دقيقة' }
  ];

  // ─── حساب التباين (WCAG) ───────────────────────────────────
  const hexToRgb = (h) => {
    const s = String(h || '').replace('#', '');
    return [0, 2, 4].map((i) => parseInt(s.substring(i, i + 2), 16) || 0);
  };
  const relLum = (hex) => {
    const [r, g, b] = hexToRgb(hex).map((c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const la = relLum(a), lb = relLum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const mix = (a, b, t) => {
    const A = hexToRgb(a), B = hexToRgb(b);
    const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  };
  // لون النص يُختار حسابياً، والتسميات مزيج بينهما — فلا يوجد خيار يكسر القراءة
  const fgFor = (bg) => (contrast(bg, '#FFFFFF') >= contrast(bg, '#14160F') ? '#FFFFFF' : '#14160F');
  const labelFor = (bg, fg) => mix(bg, fg, 0.62);

  const AR = (n) => String(n == null ? '' : n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

  function rewardPreviewLabel(kind, value, custom) {
    const v = value === '' || value == null ? null : Number(value);
    if (kind === 'free_item') return (custom || '').trim() || 'مكافأة عينية';
    if (kind === 'free_booking') return v == null ? 'حجز مجاني' : `حجز مجاني ${AR(v)} دقيقة`;
    if (kind === 'percent_discount') return `خصم ${AR(v == null ? 0 : v)}٪`;
    if (kind === 'amount_discount') return `خصم ${AR(v == null ? 0 : v)} ريال`;
    return 'مكافأة';
  }

  const page = {
    async mount(container, ctx) {
      ctx = ctx || (window.layout && window.layout.getContext()) || {};
      let alive = true;
      let state = null;          // { enabled, allowed_cards, program, stats }
      let form = null;           // نسخة العمل من البرنامج
      let activeTab = 'program';
      page._cleanup = [() => { alive = false; }];

      container.innerHTML = `
        <div class="page-header">
          <div>
            <h2>برنامج الولاء</h2>
            <div class="page-subtitle">بطاقة أختام لعملائك — تُمنح تلقائياً على كل حجز مكتمل ومُسدَّد</div>
          </div>
          <div class="actions" id="loy-actions"></div>
        </div>
        <div id="loy-body"><div class="loader-center"><div class="loader loader--lg"></div></div></div>
      `;
      const body = container.querySelector('#loy-body');
      const actions = container.querySelector('#loy-actions');

      // ─── التحميل ─────────────────────────────────────────

      async function load() {
        try {
          const data = await window.loyaltyApi.getProgram();
          if (!alive) return;
          state = data || {};
          form = Object.assign({
            name: (ctx.tenant && ctx.tenant.name) ? `بطاقة ${ctx.tenant.name}` : 'بطاقة الولاء',
            kind: 'stamps',
            is_active: false,
            reward_threshold: 10,
            reward_kind: 'free_booking',
            reward_value: '',
            reward_max_value: '',
            reward_label: '',
            reward_valid_days: '',
            reward_excludes_offers: true,
            reward_terms: '',
            min_booking_amount: 0,
            auto_enroll: true,
            redeem_pin_enabled: true,
            template: 'classic',
            brand_bg: PALETTE[0].hex,
            logo_url: (ctx.tenant && ctx.tenant.logo_url) || '',
            hero_url: ''
          }, state.program || {});
          // القيم الرقمية تصل نصوصاً من numeric — وحّدها للعرض
          ['reward_value', 'reward_max_value', 'reward_valid_days'].forEach((k) => {
            form[k] = form[k] == null ? '' : String(form[k]);
          });
          form.reward_threshold = Number(form.reward_threshold || 10);
          render();
        } catch (err) {
          if (!alive) return;
          // حالة انتقالية معروفة: الواجهة مرفوعة والمهاجرة لم تُطبَّق بعد
          const notMigrated = /loyalty_get_program|PGRST202|does not exist/i.test(err && (err.message || ''));
          body.innerHTML = `<div class="card"><div class="empty-state">
            <div class="empty-icon"><i data-lucide="${notMigrated ? 'database' : 'triangle-alert'}"></i></div>
            <h3>${notMigrated ? 'برنامج الولاء لم يُفعَّل بعد' : 'تعذّر التحميل'}</h3>
            <p>${notMigrated
              ? 'ترقية قاعدة البيانات الخاصة بالولاء لم تُطبَّق على هذا المشروع بعد.'
              : window.utils.escapeHtml(window.utils.formatError(err))}</p>
          </div></div>`;
          window.utils.renderIcons(body);
        }
      }

      // ─── الرسم ───────────────────────────────────────────

      function render() {
        if (!state.enabled) return renderUpsell();
        // صفحة البطاقات لا يصلها الشريط الجانبي (عنصر واحد للولاء)، فمدخلها من هنا
        actions.innerHTML = `
          <a class="btn btn--ghost" href="${window.utils.path('/loyalty/cards')}">
            <i data-lucide="credit-card"></i> البطاقات
          </a>
          <button class="btn btn--primary" id="loy-save"><i data-lucide="save"></i> حفظ</button>`;
        window.utils.renderIcons(actions);
        actions.querySelector('#loy-save').addEventListener('click', save);

        body.innerHTML = `
          ${renderStats()}
          <div class="loy-grid">
            <div class="loy-main">
              <div class="loy-tabs" role="tablist">
                <button class="loy-tab${activeTab === 'program' ? ' is-active' : ''}" data-tab="program">القواعد والمكافأة</button>
                <button class="loy-tab${activeTab === 'identity' ? ' is-active' : ''}" data-tab="identity">هوية البطاقة</button>
              </div>
              <div id="loy-pane"></div>
            </div>
            <aside class="loy-side">
              <div class="loy-preview-head">معاينة حيّة</div>
              <div id="loy-preview"></div>
              <p class="loy-preview-note">هكذا تظهر البطاقة في Apple Wallet و Google Wallet. الأرقام هنا للتوضيح فقط.</p>
            </aside>
          </div>
        `;
        body.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
          activeTab = b.dataset.tab;
          render();
        }));
        renderPane();
        renderPreview();
        window.utils.renderIcons(body);
      }

      function renderUpsell() {
        actions.innerHTML = '';
        body.innerHTML = `
          <div class="card">
            <div class="empty-state">
              <div class="empty-icon"><i data-lucide="sparkles"></i></div>
              <h3>برنامج الولاء متاح في الباقة الأعلى</h3>
              <p>بطاقة أختام رقمية باسم ملعبك تُضاف إلى محفظة عميلك على iPhone و Android،
                 وتُحدَّث نفسها بعد كل حجز — بلا تطبيق وبلا عمل يدوي من موظفيك.</p>
              <a class="btn btn--primary" href="${window.utils.path('/subscription')}">
                <i data-lucide="arrow-up-circle"></i> ترقية الباقة
              </a>
            </div>
          </div>`;
        window.utils.renderIcons(body);
      }

      function renderStats() {
        const s = state.stats || {};
        const cards = [
          { label: 'بطاقات', value: AR(s.cards || 0), icon: 'credit-card' },
          { label: 'قسائم متاحة', value: AR(s.rewards_available || 0), icon: 'ticket' },
          { label: 'أختام آخر ٣٠ يوماً', value: AR(Math.round(Number(s.stamps_30d || 0))), icon: 'stamp' },
          { label: 'خصومات مصروفة', value: window.utils.formatCurrency(s.discount_30d || 0), icon: 'wallet' }
        ];
        return `<div class="loy-stats">${cards.map((c) => `
          <div class="loy-stat">
            <div class="loy-stat-icon"><i data-lucide="${c.icon}"></i></div>
            <div><div class="loy-stat-value">${window.utils.escapeHtml(c.value)}</div>
                 <div class="loy-stat-label">${c.label}</div></div>
          </div>`).join('')}</div>`;
      }

      // ─── لوحة القواعد ────────────────────────────────────

      function renderPane() {
        const pane = body.querySelector('#loy-pane');
        pane.innerHTML = activeTab === 'program' ? programPaneHtml() : identityPaneHtml();
        window.utils.renderIcons(pane);
        if (activeTab === 'program') bindProgramPane(pane); else bindIdentityPane(pane);
      }

      function programPaneHtml() {
        const k = form.reward_kind;
        return `
          <div class="card">
            <div class="loy-switch-row">
              <label class="sch-switch">
                <input type="checkbox" id="f-active" ${form.is_active ? 'checked' : ''}>
                <span class="sch-switch-track"></span>
              </label>
              <div>
                <div class="fw-semibold">${form.is_active ? 'البرنامج مفعّل' : 'البرنامج متوقّف'}</div>
                <div class="text-tertiary text-sm">عند الإيقاف لا تُمنح أختام جديدة، والبطاقات الصادرة تبقى في جيوب عملائك.</div>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="f-name">اسم البرنامج <span class="required">*</span></label>
              <input class="form-control" id="f-name" maxlength="60" value="${window.utils.escapeHtml(form.name || '')}">
            </div>

            <div class="form-row cols-2">
              <div class="form-group">
                <label class="form-label" for="f-threshold">كم ختماً للمكافأة؟ <span class="required">*</span></label>
                <input class="form-control" id="f-threshold" type="number" min="2" max="50" step="1" value="${form.reward_threshold}">
                <div class="form-help">بين ٢ و ٥٠ — كل حجز مكتمل ومُسدَّد يمنح ختماً واحداً.</div>
              </div>
              <div class="form-group">
                <label class="form-label" for="f-kind">ما المكافأة؟ <span class="required">*</span></label>
                <select class="form-control" id="f-kind">
                  ${REWARD_KINDS.map((r) => `<option value="${r.key}"${k === r.key ? ' selected' : ''}>${r.label}</option>`).join('')}
                </select>
              </div>
            </div>

            <div class="form-row cols-2" id="reward-value-row">${rewardValueHtml()}</div>

            <div class="form-row cols-2">
              <div class="form-group">
                <label class="form-label" for="f-valid">صلاحية القسيمة (بالأيام)</label>
                <input class="form-control" id="f-valid" type="number" min="1" placeholder="بلا انتهاء" value="${window.utils.escapeHtml(form.reward_valid_days)}">
                <div class="form-help">اتركه فارغاً فلا تنتهي — الأسلم لسمعتك.</div>
              </div>
              <div class="form-group">
                <label class="form-label" for="f-min">أقل مبلغ حجز يمنح ختماً</label>
                <input class="form-control" id="f-min" type="number" min="0" step="1" value="${Number(form.min_booking_amount || 0)}">
                <div class="form-help">صفر = كل حجز مُسدَّد يمنح ختماً.</div>
              </div>
            </div>

            <div class="loy-checks">
              <label class="check"><input type="checkbox" id="f-excl" ${form.reward_excludes_offers ? 'checked' : ''}>
                <span>لا تُجمع المكافأة مع عرض سعري على نفس الفترة</span></label>
              <label class="check"><input type="checkbox" id="f-auto" ${form.auto_enroll ? 'checked' : ''}>
                <span>انضمام تلقائي — تُصدَر البطاقة مع أول حجز مكتمل</span></label>
              <label class="check"><input type="checkbox" id="f-pin" ${form.redeem_pin_enabled ? 'checked' : ''}>
                <span>طلب رمز الاستبدال من العميل عند الصرف</span></label>
            </div>

            <div class="form-group">
              <label class="form-label" for="f-terms">شروط البرنامج</label>
              <textarea class="form-control" id="f-terms" rows="3" maxlength="500"
                placeholder="تظهر في ظهر البطاقة — مثال: المكافأة لا تُستبدل نقداً، وتُصرف بحضور صاحب البطاقة.">${window.utils.escapeHtml(form.reward_terms || '')}</textarea>
            </div>
          </div>`;
      }

      function rewardValueHtml() {
        const k = form.reward_kind;
        if (k === 'free_item') {
          return `<div class="form-group loy-span-2">
            <label class="form-label" for="f-item">وصف المكافأة <span class="required">*</span></label>
            <input class="form-control" id="f-item" maxlength="60" placeholder="مثال: مشروبات للفريق"
              value="${window.utils.escapeHtml(form.reward_label || '')}">
            <div class="form-help">تُصرف يدوياً عند الكاونتر — بلا خصم على الفاتورة.</div>
          </div>`;
        }
        if (k === 'free_booking') {
          return `
            <div class="form-group">
              <label class="form-label" for="f-value">المدة المجانية</label>
              <select class="form-control" id="f-value">
                ${DURATIONS.map((d) => `<option value="${d.v}"${String(form.reward_value || '') === d.v ? ' selected' : ''}>${d.label}</option>`).join('')}
              </select>
              <div class="form-help">تُحتسب تناسبياً: ٦٠ دقيقة على حجز ١٢٠ دقيقة تخصم نصف السعر.</div>
            </div>
            ${maxValueHtml()}`;
        }
        const isPct = k === 'percent_discount';
        return `
          <div class="form-group">
            <label class="form-label" for="f-value">${isPct ? 'نسبة الخصم (٪)' : 'مبلغ الخصم (ريال)'} <span class="required">*</span></label>
            <input class="form-control" id="f-value" type="number" ${isPct ? 'min="5" max="100"' : 'min="1"'} step="1"
              value="${window.utils.escapeHtml(form.reward_value)}">
            ${isPct ? '<div class="form-help">بين ٥٪ و ١٠٠٪.</div>' : ''}
          </div>
          ${maxValueHtml()}`;
      }

      function maxValueHtml() {
        return `<div class="form-group">
          <label class="form-label" for="f-max">سقف الخصم (ريال)</label>
          <input class="form-control" id="f-max" type="number" min="1" step="1" placeholder="بلا سقف"
            value="${window.utils.escapeHtml(form.reward_max_value)}">
          <div class="form-help">يحميك من ساعة ذروة غالية.</div>
        </div>`;
      }

      function bindProgramPane(pane) {
        const on = (sel, ev, fn) => { const el = pane.querySelector(sel); if (el) el.addEventListener(ev, fn); };
        on('#f-active', 'change', (e) => { form.is_active = e.target.checked; renderPane(); renderPreview(); });
        on('#f-name', 'input', (e) => { form.name = e.target.value; });
        on('#f-threshold', 'input', (e) => { form.reward_threshold = Number(e.target.value || 0); renderPreview(); });
        on('#f-kind', 'change', (e) => {
          form.reward_kind = e.target.value;
          form.reward_value = '';
          pane.querySelector('#reward-value-row').innerHTML = rewardValueHtml();
          bindProgramPane(pane);
          renderPreview();
        });
        on('#f-value', 'input', (e) => { form.reward_value = e.target.value; renderPreview(); });
        on('#f-value', 'change', (e) => { form.reward_value = e.target.value; renderPreview(); });
        on('#f-item', 'input', (e) => { form.reward_label = e.target.value; renderPreview(); });
        on('#f-max', 'input', (e) => { form.reward_max_value = e.target.value; });
        on('#f-valid', 'input', (e) => { form.reward_valid_days = e.target.value; });
        on('#f-min', 'input', (e) => { form.min_booking_amount = Number(e.target.value || 0); });
        on('#f-excl', 'change', (e) => { form.reward_excludes_offers = e.target.checked; });
        on('#f-auto', 'change', (e) => { form.auto_enroll = e.target.checked; });
        on('#f-pin', 'change', (e) => { form.redeem_pin_enabled = e.target.checked; });
        on('#f-terms', 'input', (e) => { form.reward_terms = e.target.value; });
      }

      // ─── لوحة الهوية ─────────────────────────────────────

      function identityPaneHtml() {
        const fg = fgFor(form.brand_bg);
        const ratio = contrast(form.brand_bg, fg);
        return `
          <div class="card">
            <div class="form-label">القالب</div>
            <div class="loy-templates">
              ${TEMPLATES.map((t) => `
                <button type="button" class="loy-template${form.template === t.key ? ' is-active' : ''}" data-tpl="${t.key}">
                  <i data-lucide="${t.icon}"></i>
                  <div class="loy-template-name">${t.name}</div>
                  <div class="loy-template-desc">${t.desc}</div>
                </button>`).join('')}
            </div>

            <div class="form-label mt-lg">اللون</div>
            <div class="loy-swatches">
              ${PALETTE.map((c) => `
                <button type="button" class="loy-swatch${form.brand_bg === c.hex ? ' is-active' : ''}"
                  data-color="${c.hex}" title="${c.name}" aria-label="${c.name}"
                  style="background:${c.hex}"></button>`).join('')}
            </div>
            <div class="loy-contrast">
              <i data-lucide="${ratio >= 4.5 ? 'check' : 'triangle-alert'}"></i>
              تباين النص ${ratio.toFixed(1)}:1 — ${ratio >= 4.5 ? 'يتجاوز معيار WCAG AA' : 'دون المعيار'}
            </div>

            <div class="form-label mt-lg">الشعار</div>
            <div class="loy-asset" data-asset="logo">
              ${form.logo_url
                ? `<img class="loy-asset-preview loy-asset-preview--logo" src="${window.utils.escapeHtml(form.logo_url)}" alt="شعار البطاقة">`
                : '<div class="loy-asset-empty"><i data-lucide="image-plus"></i></div>'}
              <div class="loy-asset-actions">
                <label class="btn btn--ghost btn--sm">
                  <input type="file" accept="image/jpeg,image/png,image/webp" hidden data-role="pick-logo">
                  <i data-lucide="upload"></i><span>${form.logo_url ? 'تغيير' : 'رفع شعار'}</span>
                </label>
                ${form.logo_url ? '<button type="button" class="btn btn--danger-quiet btn--sm" data-role="clear-logo">إزالة</button>' : ''}
                ${(ctx.tenant && ctx.tenant.logo_url && ctx.tenant.logo_url !== form.logo_url)
                  ? '<button type="button" class="btn btn--ghost btn--sm" data-role="use-tenant-logo">استخدم شعار الملعب</button>' : ''}
              </div>
            </div>

            ${form.template === 'photo' ? `
              <div class="form-label mt-lg">صورة البطاقة</div>
              <div class="loy-asset" data-asset="hero">
                ${form.hero_url
                  ? `<img class="loy-asset-preview loy-asset-preview--hero" src="${window.utils.escapeHtml(form.hero_url)}" alt="صورة البطاقة">`
                  : '<div class="loy-asset-empty loy-asset-empty--wide"><i data-lucide="image-plus"></i></div>'}
                <div class="loy-asset-actions">
                  <label class="btn btn--ghost btn--sm">
                    <input type="file" accept="image/jpeg,image/png,image/webp" hidden data-role="pick-hero">
                    <i data-lucide="upload"></i><span>${form.hero_url ? 'تغيير' : 'رفع صورة'}</span>
                  </label>
                  ${form.hero_url ? '<button type="button" class="btn btn--danger-quiet btn--sm" data-role="clear-hero">إزالة</button>' : ''}
                </div>
                <div class="form-help">صورة عريضة لملعبك — تُقصّ إلى ١٠٣٢×٣٣٦ تلقائياً.</div>
              </div>` : ''}
          </div>`;
      }

      function bindIdentityPane(pane) {
        pane.querySelectorAll('[data-tpl]').forEach((b) => b.addEventListener('click', () => {
          form.template = b.dataset.tpl;
          renderPane(); renderPreview();
        }));
        pane.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => {
          form.brand_bg = b.dataset.color;
          renderPane(); renderPreview();
        }));

        pane.addEventListener('change', async (e) => {
          const logoIn = e.target.closest('[data-role="pick-logo"]');
          const heroIn = e.target.closest('[data-role="pick-hero"]');
          const input = logoIn || heroIn;
          if (!input) return;
          const file = input.files && input.files[0];
          input.value = '';
          if (!file) return;
          const isLogo = !!logoIn;
          try {
            // PNG إلزامي: Apple Wallet لا تقبل JPEG داخل حزمة .pkpass،
            // والـ cropper يُخرج JPEG افتراضياً.
            const cropped = await window.cropImage(file, isLogo
              ? { aspect: 1, outWidth: 512, outHeight: 512, mime: 'image/png', title: 'قصّ الشعار' }
              : { aspect: 1032 / 336, outWidth: 1032, outHeight: 336, mime: 'image/png', title: 'قصّ صورة البطاقة' });
            if (!cropped || !alive) return;
            window.utils.toast('جارٍ الرفع…', 'info');
            const url = await window.loyaltyApi.uploadLoyaltyAsset(cropped, isLogo ? 'logo' : 'hero');
            if (!alive) return;
            if (isLogo) form.logo_url = url; else form.hero_url = url;
            renderPane(); renderPreview();
            window.utils.toast('تم الرفع — لا تنسَ الحفظ', 'success');
          } catch (err) {
            if (alive) window.utils.toast(window.utils.formatError(err), 'error');
          }
        });

        pane.addEventListener('click', (e) => {
          if (e.target.closest('[data-role="clear-logo"]')) { form.logo_url = ''; renderPane(); renderPreview(); }
          if (e.target.closest('[data-role="clear-hero"]')) { form.hero_url = ''; renderPane(); renderPreview(); }
          if (e.target.closest('[data-role="use-tenant-logo"]')) {
            form.logo_url = ctx.tenant.logo_url; renderPane(); renderPreview();
          }
        });
      }

      // ─── المعاينة الحيّة ─────────────────────────────────

      function renderPreview() {
        const el = body.querySelector('#loy-preview');
        if (!el) return;
        const bg = form.brand_bg;
        const fg = fgFor(bg);
        const label = labelFor(bg, fg);
        const thr = Math.max(2, Math.min(50, Number(form.reward_threshold) || 10));
        const filled = Math.min(thr, Math.max(1, Math.round(thr * 0.7)));
        const org = (ctx.tenant && ctx.tenant.name) || 'ملعبك';
        const reward = rewardPreviewLabel(form.reward_kind, form.reward_value, form.reward_label);

        let strip = '';
        if (form.template === 'photo') {
          strip = form.hero_url
            ? `<div class="wcard-strip" style="background-image:url('${window.utils.escapeHtml(form.hero_url)}')"></div>`
            : '<div class="wcard-strip wcard-strip--empty">ارفع صورة ملعبك</div>';
        } else if (form.template === 'stamps') {
          const dots = Array.from({ length: thr }, (_, i) =>
            `<span class="wcard-dot${i < filled ? ' is-filled' : ''}"></span>`).join('');
          strip = `<div class="wcard-strip wcard-strip--stamps">${dots}</div>`;
        }

        el.innerHTML = `
          <div class="wcard" style="--wc-bg:${bg};--wc-fg:${fg};--wc-label:${label}">
            <div class="wcard-top">
              <div class="wcard-logo">${form.logo_url
                ? `<img src="${window.utils.escapeHtml(form.logo_url)}" alt="">`
                : `<span>${window.utils.escapeHtml(org.trim().charAt(0) || 'م')}</span>`}</div>
              <div class="wcard-org">
                <div class="wcard-org-name">${window.utils.escapeHtml(org)}</div>
                <div class="wcard-org-by">بواسطة مَرمى</div>
              </div>
              <div class="wcard-balance">
                <div class="wcard-mini-label">الأختام</div>
                <div class="wcard-mini-value">${AR(filled)} / ${AR(thr)}</div>
              </div>
            </div>
            ${strip}
            <div class="wcard-primary">
              <div class="wcard-mini-label">المكافأة</div>
              <div class="wcard-primary-value">${window.utils.escapeHtml(reward)}</div>
            </div>
            <div class="wcard-row">
              <div><div class="wcard-mini-label">العضو</div><div class="wcard-mini-value">محمد العلي</div></div>
              <div><div class="wcard-mini-label">الباقي</div><div class="wcard-mini-value">${AR(Math.max(0, thr - filled))} حجوزات</div></div>
            </div>
            <div class="wcard-qr"><i data-lucide="qr-code"></i></div>
          </div>
          ${!form.is_active ? '<div class="loy-preview-off"><i data-lucide="pause"></i> البرنامج متوقّف — لن تُمنح أختام جديدة</div>' : ''}
        `;
        window.utils.renderIcons(el);
      }

      // ─── الحفظ ───────────────────────────────────────────

      function validate() {
        if (!String(form.name || '').trim()) return 'اسم البرنامج مطلوب';
        const thr = Number(form.reward_threshold);
        if (!(thr >= 2 && thr <= 50)) return 'عدد الأختام يجب أن يكون بين ٢ و ٥٠';
        const v = form.reward_value === '' ? null : Number(form.reward_value);
        if (form.reward_kind === 'percent_discount' && !(v >= 5 && v <= 100)) return 'نسبة الخصم يجب أن تكون بين ٥٪ و ١٠٠٪';
        if (form.reward_kind === 'amount_discount' && !(v > 0)) return 'مبلغ الخصم يجب أن يكون أكبر من صفر';
        if (form.reward_kind === 'free_item' && !String(form.reward_label || '').trim()) return 'اكتب وصف المكافأة العينية';
        if (form.template === 'photo' && !form.hero_url) return 'قالب «صورة الملعب» يحتاج صورة — ارفعها أو غيّر القالب';
        return null;
      }

      async function save() {
        const err = validate();
        if (err) { window.utils.toast(err, 'error'); return; }
        const btn = actions.querySelector('#loy-save');
        btn.disabled = true;
        const fg = fgFor(form.brand_bg);
        try {
          const payload = {
            name: String(form.name).trim(),
            kind: 'stamps',
            is_active: !!form.is_active,
            reward_threshold: Number(form.reward_threshold),
            reward_kind: form.reward_kind,
            reward_value: form.reward_value === '' ? null : Number(form.reward_value),
            reward_max_value: form.reward_max_value === '' ? null : Number(form.reward_max_value),
            // التسمية من الخادم إلا في المكافأة العينية — نصّها هو التسمية
            reward_label: form.reward_kind === 'free_item' ? String(form.reward_label).trim() : null,
            reward_valid_days: form.reward_valid_days === '' ? null : Number(form.reward_valid_days),
            reward_excludes_offers: !!form.reward_excludes_offers,
            reward_terms: String(form.reward_terms || '').trim() || null,
            min_booking_amount: Number(form.min_booking_amount || 0),
            auto_enroll: !!form.auto_enroll,
            redeem_pin_enabled: !!form.redeem_pin_enabled,
            template: form.template,
            brand_bg: form.brand_bg,
            brand_fg: fg,
            brand_label: labelFor(form.brand_bg, fg),
            logo_url: form.logo_url || null,
            hero_url: form.hero_url || null
          };
          const data = await window.loyaltyApi.saveProgram(payload);
          if (!alive) return;
          state = data || state;
          window.utils.toast('تم حفظ البرنامج', 'success');
          if (window.store) window.store.invalidate('loyalty:program');
          render();
        } catch (e) {
          if (alive) window.utils.toast(window.utils.formatError(e), 'error');
        } finally {
          if (alive && btn) btn.disabled = false;
        }
      }

      // تحديث لحظي: أي حركة أختام تغيّر الإحصاءات
      if (window.realtime) {
        const refresh = window.utils.debounce(async () => {
          if (!alive) return;
          try {
            const d = await window.loyaltyApi.getProgram();
            if (!alive || !d) return;
            state.stats = d.stats;
            const el = body.querySelector('.loy-stats');
            if (el) {
              el.outerHTML = renderStats();
              window.utils.renderIcons(body);
            }
          } catch (_) { /* الإحصاءات ليست حرجة */ }
        }, 600);
        page._cleanup.push(window.realtime.on('loyalty:change', refresh));
      }

      await load();
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages.loyalty = page;
})();
