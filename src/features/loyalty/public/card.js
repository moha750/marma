// صفحة بطاقة الولاء العامة — /card?c=<serial>.<sig>
//
// هذه هي الصفحة التي تصل العميل فعلاً عبر واتساب. مسؤوليتها واحدة: أن يضيف
// البطاقة إلى محفظته في أقل عدد ممكن من اللمسات.
//
// كشف المنصّة يحدّد الزرّ المعروض:
//   iOS      → Apple Wallet (ملف .pkpass موقَّع من دالتنا)
//   Android  → Google Wallet (يُفعَّل عند وصول موافقة جوجل)
//   غير ذلك  → بطاقة الويب نفسها بنفس الـ QR — لا أحد يُترك بلا بطاقة
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
          : `<div class="lcard-actions">${walletButtons()}</div>`}

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
    const pkpass = `/api/wallet/pkpass/${encodeURIComponent(payload)}`;
    if (isIOS) {
      return `<a class="lcard-wallet lcard-wallet--apple" href="${pkpass}">
        <i data-lucide="wallet"></i>
        <span><b>إضافة إلى Apple Wallet</b><small>تُحدَّث تلقائياً بعد كل حجز</small></span>
      </a>`;
    }
    if (isAndroid) {
      // زرّ جوجل يُفعَّل فور اعتماد حساب المُصدِر؛ حتى ذلك الحين البطاقة أعلاه كاملة
      return `<div class="lcard-wallet lcard-wallet--soon">
        <i data-lucide="clock"></i>
        <span><b>Google Wallet — قريباً</b><small>احفظ هذه الصفحة الآن، بطاقتك تعمل كما هي</small></span>
      </div>`;
    }
    return `<a class="lcard-wallet lcard-wallet--apple" href="${pkpass}">
      <i data-lucide="wallet"></i>
      <span><b>تنزيل البطاقة</b><small>افتحها على iPhone لإضافتها للمحفظة</small></span>
    </a>`;
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
