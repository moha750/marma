// طرق الدفع كما يراها العميل — مصدرٌ واحد لصورتها.
//
// تستدعيه صفحة الحجز العامة لتعرضها للعميل، وتستدعيه صفحة «بوابات الدفع» في
// اللوحة لتري المالك ما سيراه عميله. نسختان للصورة الواحدة تفترقان بعد شهر،
// فما يضبطه المالك على معاينةٍ يخالف ما يقع في الهاتف — فجعلناها واحدة.
//
// النصّ فقط، بلا مستمعات: النسخ يتولّاه المستدعي عبر bindPaymentCopy.
(function () {
  const DEFAULT_LABELS = {
    stcpay: 'STC Pay', urpay: 'urpay', barq: 'برق',
    tiqmo: 'تيقمو', alinmapay: 'إنماء باي'
  };

  const CASH_DEFAULT_NOTE = 'ادفع نقدًا عند وصولك للملعب';

  const esc = (v) => window.utils.escapeHtml(v == null ? '' : String(v));

  function groupIban(iban) {
    return String(iban).replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
  }

  // 0501234567 → 050 123 4567 — يُقرأ بلمحة، ويُنسخ خامًا
  function groupPhone(phone) {
    const p = String(phone).replace(/\s+/g, '');
    return p.length === 10 ? `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}` : p;
  }

  // يقبل الشكل الحديث { methods: [...] } والقديم { bank, wallet } معًا: خادمٌ
  // لم تصله الهجرة بعد، أو صفحةٌ عالقة في كاش نسخةٍ سابقة — كلاهما يُعرض.
  function normalizeMethods(payment) {
    const p = payment || {};
    if (Array.isArray(p.methods)) return p.methods.filter(isUsable);
    const out = [];
    if (p.bank && p.bank.iban) out.push({ kind: 'bank', iban: p.bank.iban, title: p.bank.bank_name });
    if (p.wallet && p.wallet.phone) out.push({ kind: 'wallet', phone: p.wallet.phone, wallets: p.wallet.providers || [] });
    return out.filter(isUsable);
  }

  function isUsable(m) {
    if (!m) return false;
    if (m.kind === 'bank')   return !!m.iban;
    if (m.kind === 'wallet') return !!m.phone && (m.wallets || []).length > 0;
    if (m.kind === 'cash')   return true;
    return false;
  }

  function methodHtml(m, labels) {
    const head = (icon, title, meta) => `
        <div class="bp-pay-method-head">
          <i data-lucide="${icon}"></i>
          <span class="bp-pay-method-title">${esc(title)}</span>
          ${meta ? `<span class="bp-pay-method-meta">${meta}</span>` : ''}
        </div>`;

    const copyRow = (display, value, label) => `
        <button type="button" class="bp-pay-value" data-copy="${esc(value)}"
                title="انسخ ${esc(label)}" aria-label="انسخ ${esc(label)}">
          <code dir="ltr">${esc(display)}</code>
          <i data-lucide="copy"></i>
        </button>`;

    if (m.kind === 'bank') {
      const iban = String(m.iban).replace(/\s+/g, '').toUpperCase();
      return `<div class="bp-pay-method">
        ${head('landmark', 'تحويل بنكي', m.title ? esc(m.title) : '')}
        ${copyRow(groupIban(iban), iban, 'الأيبان')}
        ${m.note ? `<p class="bp-pay-method-note">${esc(m.note)}</p>` : ''}
      </div>`;
    }

    if (m.kind === 'wallet') {
      const phone = String(m.phone).replace(/\s+/g, '');
      const tags = (m.wallets || []).map((k) => `<span class="bp-pay-tag">${esc(labels[k] || k)}</span>`).join('');
      return `<div class="bp-pay-method">
        ${head('wallet', 'محفظة رقمية', tags)}
        ${copyRow(groupPhone(phone), phone, 'رقم المحفظة')}
        ${m.note ? `<p class="bp-pay-method-note">${esc(m.note)}</p>` : ''}
      </div>`;
    }

    // نقدًا عند الاستلام: لا شيء يُنسخ — سطرٌ ساكن لا زرّ يُوهم بفعل.
    return `<div class="bp-pay-method">
      ${head('hand-coins', 'الدفع عند الاستلام', '')}
      <p class="bp-pay-static">${esc(m.note || CASH_DEFAULT_NOTE)}</p>
    </div>`;
  }

  // يُرجع '' إن لم تكن هناك طريقةٌ واحدة — فلا يطبع المستدعي صندوقًا فارغًا.
  function paymentMethodsHtml(payment, opts) {
    const labels = (opts && opts.labels) || DEFAULT_LABELS;
    const methods = normalizeMethods(payment);
    if (!methods.length) return '';

    const transfers = methods.filter((m) => m.kind !== 'cash').length;
    const hasCash = methods.some((m) => m.kind === 'cash');
    const note = transfers && hasCash
      ? `${transfers > 1 ? 'حوّل المبلغ بإحدى الطرق' : 'حوّل المبلغ'} وأرسل الإيصال لإدارة الملعب، أو ادفع عند وصولك.`
      : transfers
        ? `${transfers > 1 ? 'حوّل المبلغ بإحدى الطرق' : 'حوّل المبلغ'} ثم أرسل الإيصال لإدارة الملعب.`
        : 'لا حاجة لتحويلٍ مسبق — الدفع عند وصولك للملعب.';

    return `
      <div class="bp-pay">
        <div class="bp-pay-head">
          <i data-lucide="banknote"></i>
          <span>${methods.length > 1 ? 'طرق الدفع' : 'طريقة الدفع'}</span>
        </div>
        ${methods.map((m) => methodHtml(m, labels)).join('')}
        <p class="bp-pay-note">${note}</p>
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
