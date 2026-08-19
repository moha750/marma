// صفحة بطاقة الولاء العامة — /card?c=<serial>.<sig>
//
// هذه هي الصفحة التي تصل العميل فعلاً عبر واتساب. مسؤوليتها واحدة: أن يضيف
// البطاقة إلى محفظته في أقل عدد ممكن من اللمسات.
//
// كشف المنصّة يحدّد الزرّ المعروض:
//   iOS      → Apple Wallet  (ملف .pkpass موقَّع من دالتنا)
//   Android  → Google Wallet (رابط pay.google.com يُصدره wallet-google)
//   غير ذلك  → الزرّان معاً — البطاقة تُفتح لاحقاً على الجوال
//
// وفي كل الأحوال البطاقة أعلاه بنفس الـ QR: لا أحد يُترك بلا بطاقة لو تعثّرت
// المحفظة. ولهذا يعود المساران عند الفشل إلى هنا بـ ?gw= أو ?aw= بدل صفحة خطأ.
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (v) => window.utils.escapeHtml(v == null ? '' : String(v));
  const AR = (n) => String(n == null ? '' : n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

  const root = $('#root');
  const payload = (new URLSearchParams(location.search).get('c') || '').trim();
  const serial = payload.split('.')[0];

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(navigator.userAgent);

  function fail(title, msg) {
    root.innerHTML = `
      <div class="bp-card" style="text-align:center;padding:40px 24px">
        <div class="empty-icon"><i data-lucide="credit-card"></i></div>
        <h2>${esc(title)}</h2>
        <p class="text-tertiary">${esc(msg)}</p>
        <a class="btn btn--ghost" href="/" style="margin-top:16px">الصفحة الرئيسية</a>
      </div>`;
    window.utils.renderIcons(root);
  }

  function render(d) {
    const prog = d.program || {};
    const bg = prog.brand_bg || '#0F3D2E';
    const fg = prog.brand_fg || '#FFFFFF';
    const label = prog.brand_label || '#C9D6CF';
    const threshold = Math.max(1, Number(d.threshold || 10));
    const balance = Math.max(0, Math.round(Number(d.balance || 0)));
    const reward = d.reward;
    const blocked = d.status !== 'active' || d.opted_out;

    const dots = Array.from({ length: Math.min(threshold, 20) }, (_, i) =>
      `<span class="wcard-dot${i < balance ? ' is-filled' : ''}"></span>`).join('');

    root.innerHTML = `
      <div class="lcard-page">
        <div class="lcard-head">
          ${prog.logo_url || d.tenant.logo
            ? `<img class="lcard-logo" src="${esc(prog.logo_url || d.tenant.logo)}" alt="">`
            : ''}
          <h1 class="lcard-title">${esc(d.tenant.name)}</h1>
          <p class="lcard-sub">${esc(prog.name || 'بطاقة الولاء')}</p>
        </div>

        <div class="wcard" style="--wc-bg:${esc(bg)};--wc-fg:${esc(fg)};--wc-label:${esc(label)}">
          <div class="wcard-top">
            <div class="wcard-logo">${prog.logo_url
              ? `<img src="${esc(prog.logo_url)}" alt="">`
              : `<span>${esc((d.tenant.name || 'م').trim().charAt(0))}</span>`}</div>
            <div class="wcard-org">
              <div class="wcard-org-name">${esc(d.tenant.name)}</div>
              <div class="wcard-org-by">بواسطة مَرمى</div>
            </div>
            <div class="wcard-balance">
              <div class="wcard-mini-label">الأختام</div>
              <div class="wcard-mini-value">${AR(balance)} / ${AR(threshold)}</div>
            </div>
          </div>
          <div class="wcard-strip wcard-strip--stamps">${dots}</div>
          <div class="wcard-primary">
            <div class="wcard-mini-label">${reward ? 'مكافأة جاهزة' : 'المكافأة'}</div>
            <div class="wcard-primary-value">${esc(reward ? reward.label : prog.reward)}</div>
          </div>
          <div class="wcard-row">
            <div><div class="wcard-mini-label">العضو</div>
                 <div class="wcard-mini-value">${esc(d.member)}</div></div>
            <div><div class="wcard-mini-label">${reward ? 'رمز المكافأة' : 'الباقي'}</div>
                 <div class="wcard-mini-value">${reward ? esc(reward.code) : AR(Math.max(0, threshold - balance)) + ' حجوزات'}</div></div>
          </div>
          <div class="wcard-qr" id="qr-slot"></div>
        </div>

        ${blocked ? `
          <div class="lcard-note lcard-note--warn">
            <i data-lucide="pause"></i>
            ${d.opted_out ? 'أنت غير مشترك في البرنامج حالياً.' : 'هذه البطاقة موقوفة.'}
          </div>`
          : `${gwNote()}<div class="lcard-actions">${walletButtons()}</div>`}

        ${prog.terms ? `
          <details class="lcard-terms">
            <summary>شروط البرنامج</summary>
            <p>${esc(prog.terms)}</p>
          </details>` : ''}

        <div class="lcard-links">
          <a class="btn btn--ghost btn--sm" href="/book?t=${esc(d.tenant.id)}">
            <i data-lucide="calendar-plus"></i> احجز الآن
          </a>
          ${blocked ? '' : `
            <button class="btn btn--ghost btn--sm" id="opt-out">
              <i data-lucide="bell-off"></i> إلغاء الاشتراك
            </button>`}
        </div>

        <p class="lcard-foot">أختامك تُضاف تلقائياً بعد كل حجز مكتمل ومُسدَّد.</p>
      </div>`;

    window.utils.renderIcons(root);
    drawQr();
    wire(d);
  }

  function walletButtons() {
    const enc = encodeURIComponent(payload);
    const apple = `<a class="lcard-wallet lcard-wallet--apple" href="/api/wallet/pkpass/${enc}">
      <i data-lucide="wallet"></i>
      <span><b>إضافة إلى Apple Wallet</b><small>تُحدَّث تلقائياً بعد كل حجز</small></span>
    </a>`;
    const google = `<a class="lcard-wallet lcard-wallet--google" href="/api/wallet/google/save/${enc}">
      <i data-lucide="wallet-cards"></i>
      <span><b>إضافة إلى Google Wallet</b><small>تُحدَّث تلقائياً بعد كل حجز</small></span>
    </a>`;

    if (isIOS) return apple;
    if (isAndroid) return google;
    // سطح المكتب: الزرّان معاً — لا نُخمّن أي جوال سيفتح به البطاقة
    return apple + google;
  }

  // رسائل عودة مسارَي المحفظتين — كلاهما يُعيد التوجيه إلى هنا عند التعثّر
  // بدل صفحة خطأ: البطاقة أعلاه بالـ QR تعمل، والملعب يختم منها.
  const WALLET_NOTES = {
    gw: {
      off: 'خدمة Google Wallet غير مُفعَّلة بعد على هذا الملعب — بطاقتك أعلاه تعمل كما هي.',
      err: 'تعذّرت إضافة البطاقة إلى Google Wallet الآن — جرّب لاحقاً، وبطاقتك أعلاه تعمل كما هي.'
    },
    aw: {
      off: 'خدمة Apple Wallet غير مُفعَّلة بعد على هذا الملعب — بطاقتك أعلاه تعمل كما هي.',
      // aw=blocked لا نصّ له عمداً: البطاقة الموقوفة ترسم بانرها الخاص أعلاه
      err: 'تعذّرت إضافة البطاقة إلى Apple Wallet الآن — جرّب لاحقاً، وبطاقتك أعلاه تعمل كما هي.'
    }
  };

  function gwNote() {
    const q = new URLSearchParams(location.search);
    const out = [];
    for (const key of ['gw', 'aw']) {
      const msg = WALLET_NOTES[key][(q.get(key) || '').trim()];
      if (msg) out.push(`<div class="lcard-note lcard-note--warn">
        <i data-lucide="info"></i>${esc(msg)}
      </div>`);
    }
    return out.join('');
  }

  function drawQr() {
    const slot = $('#qr-slot');
    if (!slot || !window.QRCode) return;
    slot.innerHTML = '';
    try {
      new window.QRCode(slot, {
        text: 'MRM1:' + payload.replace('.', ':'),
        width: 132, height: 132,
        colorDark: '#111111', colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.M
      });
    } catch (_) {
      slot.innerHTML = `<div class="lcard-serial" dir="ltr">${esc(serial.substring(0, 8))}</div>`;
    }
  }

  function wire(d) {
    const btn = $('#opt-out');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const ok = confirm(
        `إلغاء اشتراكك في برنامج ولاء ${d.tenant.name}؟\n` +
        'ستتوقف أختامك الجديدة وتُوقَف بطاقتك.'
      );
      if (!ok) return;
      btn.disabled = true;
      try {
        await window.sb.rpc('loyalty_public_opt_out', { p_payload: payload });
        location.reload();
      } catch (_) {
        btn.disabled = false;
        alert('تعذّر إلغاء الاشتراك — حاول لاحقاً.');
      }
    });
  }

  async function boot() {
    if (!payload) return fail('رابط ناقص', 'افتح البطاقة من الرابط الذي وصلك.');
    try {
      const { data, error } = await window.sb.rpc('loyalty_public_card', { p_payload: payload });
      if (error) throw error;
      if (!data) throw new Error('empty');
      render(data);
      // الانتقال المباشر إلى #out من ظهر بطاقة آبل يفتح إلغاء الاشتراك فوراً
      if (location.hash === '#out') {
        const b = $('#opt-out');
        if (b) { b.scrollIntoView({ behavior: 'smooth', block: 'center' }); b.focus(); }
      }
    } catch (err) {
      fail('تعذّر فتح البطاقة', window.utils.formatError(err));
    }
  }

  boot();
})();
