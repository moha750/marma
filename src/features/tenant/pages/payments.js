// بوابات الدفع — كيف يدفع العميل للملعب.
//
// طريقتان يستعملهما الناس هنا فعلاً: تحويلٌ بنكيّ إلى أيبان، وتحويلٌ إلى محفظةٍ
// رقمية برقم جوال. لكلٍّ مفتاحُ تشغيلٍ مستقلّ وبياناته، وما يُشغَّل يظهر للعميل
// عند تأكيد الحجز. ولا شيء يظهر لمن لم يشغّل شيئاً — كما كانت الصفحة قبلها.
//
// «ما يراه عميلك» أسفل الصفحة ليس زينة: المالك يكتب أيباناً في لوحة تحكّم،
// والذي يهمّه هو شكل الخانة في هاتف عميله. فنعرضها بنفس صنف الواجهة العامة.
(function () {
  // بنوك السعودية — اقتراحاتٌ لا قائمةً مغلقة: الحقل نصّ حرّ، فمن بنكه خارجها
  // كتبه بيده. (datalist يقترح ولا يمنع)
  const BANKS = [
    'مصرف الراجحي', 'البنك الأهلي السعودي', 'بنك الرياض', 'بنك البلاد',
    'مصرف الإنماء', 'البنك السعودي الفرنسي', 'البنك العربي الوطني',
    'بنك الجزيرة', 'البنك السعودي الأول', 'البنك السعودي للاستثمار',
    'بنك الخليج الدولي', 'بنك D360', 'stc bank'
  ];

  const esc = (v) => window.utils.escapeHtml(v == null ? '' : String(v));

  function formatIban(iban) {
    if (!iban) return '';
    return String(iban).replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
  }

  function wallets() {
    return window.api.PAYMENT_WALLETS || [];
  }

  function TEMPLATE(t) {
    const selected = new Set(t.payment_wallets || []);
    return `
      <div class="page-header">
        <div>
          <h2>بوابات الدفع</h2>
          <div class="page-subtitle">اختر كيف يدفع عميلك — ما تُشغّله هنا يظهر له عند تأكيد الحجز</div>
        </div>
      </div>

      <div class="card mb-md" id="bank-card">
        <div class="card-header">
          <h3>التحويل البنكي</h3>
          <label class="form-check" style="margin:0">
            <input type="checkbox" id="bank-enabled" ${t.payment_bank_enabled ? 'checked' : ''}>
            <span>مُفعّل</span>
          </label>
        </div>
        <form id="bank-form" autocomplete="off">
          <div class="card-body">
            <div class="form-group">
              <label class="form-label">البنك</label>
              <input type="text" class="form-control" name="bank_name" list="bank-list" maxlength="60"
                     placeholder="مصرف الراجحي" value="${esc(t.payment_bank_name)}">
              <datalist id="bank-list">${BANKS.map((b) => `<option value="${esc(b)}"></option>`).join('')}</datalist>
              <span class="form-help">اختياري — يطمئن العميل إلى أين يحوّل.</span>
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">رقم الأيبان (IBAN) <span class="required">*</span></label>
              <input type="text" class="form-control" name="iban" dir="ltr" maxlength="34"
                     autocapitalize="characters" spellcheck="false"
                     placeholder="SA00 0000 0000 0000 0000 0000" value="${esc(formatIban(t.payment_iban))}">
              <span class="form-help">ينسخه عميلك بضغطة ويلصقه في تطبيق بنكه.</span>
            </div>
          </div>
          <div class="card-footer">
            <button type="submit" class="btn btn--primary" id="bank-save">حفظ التحويل البنكي</button>
          </div>
        </form>
      </div>

      <div class="card mb-md" id="wallet-card">
        <div class="card-header">
          <h3>المحفظة الرقمية</h3>
          <label class="form-check" style="margin:0">
            <input type="checkbox" id="wallet-enabled" ${t.payment_wallet_enabled ? 'checked' : ''}>
            <span>مُفعّل</span>
          </label>
        </div>
        <form id="wallet-form" autocomplete="off">
          <div class="card-body">
            <div class="form-group">
              <label class="form-label">رقم الجوال <span class="required">*</span></label>
              <input type="tel" class="form-control" name="wallet_phone" dir="ltr" maxlength="10"
                     inputmode="numeric" placeholder="05XXXXXXXX" value="${esc(t.payment_wallet_phone)}">
              <span class="form-help">الرقم الذي تستقبل عليه التحويلات في محافظك.</span>
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">المحافظ التي تستقبل على هذا الرقم <span class="required">*</span></label>
              <div class="chip-rail" id="wallet-chips">
                ${wallets().map((w) => `
                  <button type="button" class="chip" data-wallet="${esc(w.key)}"
                          aria-pressed="${selected.has(w.key) ? 'true' : 'false'}">
                    ${esc(w.label)}
                  </button>
                `).join('')}
              </div>
              <span class="form-help">اختر ما لديك — يراها عميلك ليعرف من أي تطبيق يحوّل.</span>
            </div>
          </div>
          <div class="card-footer">
            <button type="submit" class="btn btn--primary" id="wallet-save">حفظ المحفظة</button>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>ما يراه عميلك</h3>
          <span class="card-header-meta">عند تأكيد الحجز</span>
        </div>
        <div class="card-body">
          <div id="pay-preview"></div>
        </div>
      </div>
    `;
  }

  // نفس أصناف الواجهة العامة (bp-pay*) — فالمعاينة هي الشيء نفسه لا رسمَه.
  function renderPreview(host, t) {
    const bank = t.payment_bank_enabled && t.payment_iban
      ? { iban: t.payment_iban, bank_name: t.payment_bank_name } : null;
    const walletProviders = t.payment_wallets || [];
    const wallet = t.payment_wallet_enabled && t.payment_wallet_phone && walletProviders.length
      ? { phone: t.payment_wallet_phone, providers: walletProviders } : null;

    if (!bank && !wallet) {
      host.innerHTML = `
        <div class="empty-state" style="padding:var(--space-5) 0">
          <p>لا تظهر لعميلك أي طريقة دفع الآن — شغّل واحدة أعلاه.</p>
        </div>`;
      return;
    }
    host.innerHTML = window.paymentMethodsHtml({ bank, wallet }, { labels: window.api.PAYMENT_WALLET_LABELS });
    window.utils.renderIcons(host);
  }

  const page = {
    async mount(container, ctx) {
      const t = ctx.tenant;
      if (!t) {
        container.innerHTML = `<div class="card"><div class="card-body"><div class="empty-state"><p>لا توجد بيانات الملعب.</p></div></div></div>`;
        return;
      }
      container.innerHTML = TEMPLATE(t);
      window.utils.renderIcons(container);

      const preview = container.querySelector('#pay-preview');
      renderPreview(preview, t);

      // ── التحويل البنكي ──
      const bankForm = container.querySelector('#bank-form');
      const bankToggle = container.querySelector('#bank-enabled');
      const bankSave = container.querySelector('#bank-save');
      bankForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(bankForm);
        bankSave.disabled = true;
        bankSave.dataset.loading = 'true';
        try {
          const saved = await window.api.updatePaymentGateways({
            bank: {
              enabled: bankToggle.checked,
              iban: fd.get('iban'),
              bank_name: fd.get('bank_name')
            }
          });
          Object.assign(t, saved);
          bankForm.iban.value = formatIban(saved.payment_iban);
          window.utils.toast(saved.payment_bank_enabled ? 'التحويل البنكي يظهر لعملائك الآن' : 'التحويل البنكي مُطفأ', 'success');
          renderPreview(preview, t);
        } catch (err) {
          window.utils.toast(window.utils.formatError(err), 'error');
        } finally {
          bankSave.disabled = false;
          delete bankSave.dataset.loading;
        }
      });

      // ── المحفظة الرقمية ──
      const walletForm = container.querySelector('#wallet-form');
      const walletToggle = container.querySelector('#wallet-enabled');
      const walletSave = container.querySelector('#wallet-save');
      const chips = container.querySelector('#wallet-chips');

      chips.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-wallet]');
        if (!chip) return;
        chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      });

      walletForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const providers = Array.from(chips.querySelectorAll('[aria-pressed="true"]')).map((c) => c.dataset.wallet);
        walletSave.disabled = true;
        walletSave.dataset.loading = 'true';
        try {
          const saved = await window.api.updatePaymentGateways({
            wallet: {
              enabled: walletToggle.checked,
              phone: walletForm.wallet_phone.value,
              providers
            }
          });
          Object.assign(t, saved);
          window.utils.toast(saved.payment_wallet_enabled ? 'المحفظة تظهر لعملائك الآن' : 'المحفظة مُطفأة', 'success');
          renderPreview(preview, t);
        } catch (err) {
          window.utils.toast(window.utils.formatError(err), 'error');
        } finally {
          walletSave.disabled = false;
          delete walletSave.dataset.loading;
        }
      });
    },

    unmount() {}
  };

  window.pages = window.pages || {};
  window.pages.payments = page;
})();
