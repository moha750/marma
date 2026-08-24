// طرق الدفع كما يراها العميل — مصدرٌ واحد لصورتها.
//
// تستدعيه صفحة الحجز العامة لتعرضها للعميل، وتستدعيه صفحة «بوابات الدفع» في
// اللوحة لتري المالك ما سيراه عميله. نسختان للصورة الواحدة تفترقان بعد شهر،
// فما يضبطه المالك على معاينةٍ يخالف ما يقع في الهاتف — فجعلناها واحدة.
//
// النصّ فقط، بلا مستمعات: النسخ يتولّاه المستدعي عبر [data-copy].
(function () {
  const DEFAULT_LABELS = {
    stcpay: 'STC Pay', urpay: 'urpay', barq: 'برق',
    tiqmo: 'تيقمو', alinmapay: 'إنماء باي', d360: 'D360'
  };

  const esc = (v) => window.utils.escapeHtml(v == null ? '' : String(v));

  function groupIban(iban) {
    return String(iban).replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
  }

  // 0501234567 → 050 123 4567 — يُقرأ بلمحة، ويُنسخ خاماً
  function groupPhone(phone) {
    const p = String(phone).replace(/\s+/g, '');
    return p.length === 10 ? `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}` : p;
  }

  function methodHtml({ icon, title, meta, display, copyValue, copyLabel }) {
    return `
      <div class="bp-pay-method">
        <div class="bp-pay-method-head">
          <i data-lucide="${esc(icon)}"></i>
          <span class="bp-pay-method-title">${esc(title)}</span>
          ${meta ? `<span class="bp-pay-method-meta">${meta}</span>` : ''}
        </div>
        <button type="button" class="bp-pay-value" data-copy="${esc(copyValue)}"
                title="انسخ ${esc(copyLabel)}" aria-label="انسخ ${esc(copyLabel)}">
          <code dir="ltr">${esc(display)}</code>
          <i data-lucide="copy"></i>
        </button>
      </div>
    `;
  }

  // payment: { bank: {iban, bank_name} | null, wallet: {phone, providers[]} | null }
  // يُرجع '' إن لم تكن هناك طريقة واحدة — فلا يطبع المستدعي صندوقاً فارغاً.
  function paymentMethodsHtml(payment, opts) {
    const p = payment || {};
    const labels = (opts && opts.labels) || DEFAULT_LABELS;
    const bank = p.bank && p.bank.iban ? p.bank : null;
    const wallet = p.wallet && p.wallet.phone && (p.wallet.providers || []).length ? p.wallet : null;
    if (!bank && !wallet) return '';

    const bankHtml = bank ? methodHtml({
      icon: 'landmark',
      title: 'تحويل بنكي',
      meta: bank.bank_name ? esc(bank.bank_name) : '',
      display: groupIban(bank.iban),
      copyValue: String(bank.iban).replace(/\s+/g, '').toUpperCase(),
      copyLabel: 'الأيبان'
    }) : '';

    const walletHtml = wallet ? methodHtml({
      icon: 'wallet',
      title: 'محفظة رقمية',
      meta: (wallet.providers || []).map((k) => `<span class="bp-pay-tag">${esc(labels[k] || k)}</span>`).join(''),
      display: groupPhone(wallet.phone),
      copyValue: String(wallet.phone).replace(/\s+/g, ''),
      copyLabel: 'رقم المحفظة'
    }) : '';

    return `
      <div class="bp-pay">
        <div class="bp-pay-head">
          <i data-lucide="banknote"></i>
          <span>حوّل المبلغ لتأكيد الحجز</span>
        </div>
        ${bankHtml}${walletHtml}
        <p class="bp-pay-note">${bank && wallet ? 'حوّل المبلغ بإحدى الطريقتين' : 'حوّل المبلغ'} ثم أرسل الإيصال لإدارة الملعب.</p>
      </div>
    `;
  }

  // ربط النسخ: تفويضٌ واحد على الحاوية — يعمل مع أي عدد من الطرق
  function bindPaymentCopy(scope) {
    if (!scope || scope.dataset.payCopyBound === '1') return;
    scope.dataset.payCopyBound = '1';
    scope.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-copy]');
      if (!btn || !scope.contains(btn)) return;
      await window.utils.copyToClipboard(btn.dataset.copy);
      btn.dataset.copied = 'true';
      window.utils.toast('تم النسخ', 'success');
      setTimeout(() => { delete btn.dataset.copied; }, 1600);
    });
  }

  window.paymentMethodsHtml = paymentMethodsHtml;
  window.bindPaymentCopy = bindPaymentCopy;
})();
