// بوابات الدفع — كيف يدفع العميل للملعب.
//
// قائمةٌ لا حقول: للمالك حسابان في بنكين، ورقما محفظةٍ مختلفان، وقد يقبض
// نقدًا عند الملعب. فكلُّ طريقةٍ سطرٌ يُضاف ويُطفأ ويُحذف على حدة، وما كان
// مشتغلًا ظهر لعميله عند تأكيد الحجز بالترتيب نفسه.
//
// «ما يراه عميلك» أسفل الصفحة ليس زينة: المالك يكتب أيبانًا في لوحة تحكّم،
// والذي يهمّه شكلُ الخانة في هاتف عميله — فنعرضها بنفس مكوّن الواجهة العامة.
(function () {
  // بنوك السعودية — اقتراحاتٌ لا قائمةً مغلقة: الحقل نصّ حرّ، فمن بنكه خارجها
  // كتبه بيده. (D360 و stc bank بنوكٌ رقمية لها أيبان، ومكانها هنا لا في المحافظ)
  const BANKS = [
    'مصرف الراجحي', 'البنك الأهلي السعودي', 'بنك الرياض', 'بنك البلاد',
    'مصرف الإنماء', 'البنك السعودي الفرنسي', 'البنك العربي الوطني',
    'بنك الجزيرة', 'البنك السعودي الأول', 'البنك السعودي للاستثمار',
    'بنك الخليج الدولي', 'بنك D360', 'stc bank'
  ];

  const KIND_META = {
    bank:   { icon: 'landmark',   label: 'تحويل بنكي' },
    wallet: { icon: 'wallet',     label: 'محفظة رقمية' },
    cash:   { icon: 'hand-coins', label: 'الدفع عند الاستلام' }
  };

  const esc = (v) => window.utils.escapeHtml(v == null ? '' : String(v));

  function formatIban(iban) {
    if (!iban) return '';
    return String(iban).replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
  }

  function formatPhone(phone) {
    const p = String(phone || '').replace(/\s+/g, '');
    return p.length === 10 ? `${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}` : p;
  }

  function wallets() {
    return window.api.PAYMENT_WALLETS || [];
  }

  function walletLabel(key) {
    return (window.api.PAYMENT_WALLET_LABELS || {})[key] || key;
  }

  function TEMPLATE() {
    return `
      <div class="page-header">
        <div>
          <h2>بوابات الدفع</h2>
          <div class="page-subtitle">اختر كيف يدفع عميلك — ما تُشغّله هنا يظهر له عند تأكيد الحجز</div>
        </div>
        <div class="actions">
          <button type="button" class="btn btn--secondary" data-add="cash">
            <i data-lucide="hand-coins"></i><span>الدفع عند الاستلام</span>
          </button>
          <button type="button" class="btn btn--secondary" data-add="wallet">
            <i data-lucide="wallet"></i><span>محفظة رقمية</span>
          </button>
          <button type="button" class="btn btn--primary" data-add="bank">
            <i data-lucide="landmark"></i><span>حساب بنكي</span>
          </button>
        </div>
      </div>

      <div class="card mb-md">
        <div class="card-header">
          <h3>الطرق المضافة</h3>
          <span class="card-header-meta">أضف ما شئت — حسابين في بنكين، أو رقمين لمحفظتين</span>
        </div>
        <div class="card-body" id="methods-body">
          <div class="loader-center" style="min-height:80px"><div class="loader"></div></div>
        </div>
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

  function methodRow(m) {
    const meta = KIND_META[m.kind] || KIND_META.bank;
    const value = m.kind === 'bank' ? formatIban(m.iban)
      : m.kind === 'wallet' ? formatPhone(m.phone)
      : (m.note || 'ادفع نقدًا عند وصولك للملعب');
    const sub = m.kind === 'bank' ? (m.title || '')
      : m.kind === 'wallet' ? (m.wallets || []).map((k) => `<span class="badge">${esc(walletLabel(k))}</span>`).join(' ')
      : '';
    return `
      <li class="pay-row ${m.is_active ? '' : 'is-off'}" data-id="${esc(m.id)}">
        <span class="stat-icon-chip"><i data-lucide="${meta.icon}"></i></span>
        <div class="pay-row-main">
          <div class="pay-row-title">
            <span>${esc(meta.label)}</span>
            ${sub ? `<span class="pay-row-sub">${m.kind === 'bank' ? esc(sub) : sub}</span>` : ''}
            ${m.is_active ? '' : '<span class="badge badge--muted">مُطفأة</span>'}
          </div>
          <div class="pay-row-value" ${m.kind === 'cash' ? '' : 'dir="ltr"'}>${esc(value)}</div>
          ${m.kind !== 'cash' && m.note ? `<div class="pay-row-note">${esc(m.note)}</div>` : ''}
        </div>
        <div class="pay-row-actions">
          <label class="form-check" style="margin:0" title="${m.is_active ? 'إطفاء' : 'تشغيل'}">
            <input type="checkbox" data-toggle aria-label="مُفعّلة" ${m.is_active ? 'checked' : ''}>
          </label>
          <button type="button" class="btn btn--ghost btn--sm" data-edit title="تعديل"><i data-lucide="pencil"></i></button>
          <button type="button" class="btn btn--danger-quiet btn--sm" data-delete title="حذف"><i data-lucide="trash-2"></i></button>
        </div>
      </li>
    `;
  }

  function renderList(host, methods) {
    if (!methods.length) {
      host.innerHTML = `
        <div class="empty-state">
          <i data-lucide="wallet"></i>
          <p>لم تُضف طريقة دفع بعد — عميلك لا يرى قسم الدفع إطلاقًا.</p>
          <p class="text-muted text-sm">أضف حسابًا بنكيًا أو محفظة رقمية أو الدفع عند الاستلام من أعلى الصفحة.</p>
        </div>`;
      window.utils.renderIcons(host);
      return;
    }
    host.innerHTML = `<ul class="pay-list">${methods.map(methodRow).join('')}</ul>`;
    window.utils.renderIcons(host);
  }

  function renderPreview(host, methods) {
    const active = methods.filter((m) => m.is_active);
    const html = window.paymentMethodsHtml({ methods: active }, { labels: window.api.PAYMENT_WALLET_LABELS });
    if (!html) {
      host.innerHTML = `<div class="empty-state" style="padding:var(--space-5) 0">
        <p>لا تظهر لعميلك أي طريقة دفع الآن.</p></div>`;
      return;
    }
    host.innerHTML = html;
    window.utils.renderIcons(host);
    window.bindPaymentCopy(host);
  }

  // نموذج الإضافة/التعديل — نافذةٌ واحدة تخدم الأنواع الثلاثة، فلا ثلاثة
  // نماذج تتباعد. تُرجع الصفّ المحفوظ أو null إن تراجع المالك.
  function openMethodModal(kind, existing) {
    return new Promise((resolve) => {
      const m = existing || {};
      const selected = new Set(m.wallets || []);
      const body = document.createElement('div');
      body.innerHTML = `
        <form id="pm-form" autocomplete="off">
          ${kind === 'bank' ? `
            <div class="form-group">
              <label class="form-label">البنك</label>
              <input type="text" class="form-control" name="title" list="pm-banks" maxlength="60"
                     placeholder="مصرف الراجحي" value="${esc(m.title)}">
              <datalist id="pm-banks">${BANKS.map((b) => `<option value="${esc(b)}"></option>`).join('')}</datalist>
              <span class="form-help">اختياري — يطمئن العميل إلى أين يحوّل.</span>
            </div>
            <div class="form-group">
              <label class="form-label">رقم الأيبان (IBAN) <span class="required">*</span></label>
              <input type="text" class="form-control" name="iban" dir="ltr" maxlength="34"
                     autocapitalize="characters" spellcheck="false"
                     placeholder="SA00 0000 0000 0000 0000 0000" value="${esc(formatIban(m.iban))}">
            </div>
          ` : ''}
          ${kind === 'wallet' ? `
            <div class="form-group">
              <label class="form-label">رقم الجوال <span class="required">*</span></label>
              <input type="tel" class="form-control" name="phone" dir="ltr" maxlength="10"
                     inputmode="numeric" placeholder="05XXXXXXXX" value="${esc(m.phone)}">
              <span class="form-help">الرقم الذي تستقبل عليه التحويلات.</span>
            </div>
            <div class="form-group">
              <label class="form-label">المحافظ التي تستقبل على هذا الرقم <span class="required">*</span></label>
              <div class="chip-rail" id="pm-wallets">
                ${wallets().map((w) => `
                  <button type="button" class="chip" data-wallet="${esc(w.key)}"
                          aria-pressed="${selected.has(w.key) ? 'true' : 'false'}">${esc(w.label)}</button>
                `).join('')}
              </div>
            </div>
          ` : ''}
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">ملاحظة للعميل</label>
            <input type="text" class="form-control" name="note" maxlength="140"
                   placeholder="${kind === 'cash' ? 'ادفع نقدًا عند وصولك للملعب' : 'مثال: أرسل الإيصال على واتساب الملعب'}"
                   value="${esc(m.note)}">
            <span class="form-help">اختياري — تظهر تحت الطريقة في صفحة الحجز.</span>
          </div>
        </form>
      `;

      const footer = document.createElement('div');
      footer.style.cssText = 'display:flex;gap:8px;width:100%';
      footer.innerHTML = `
        <button type="button" class="btn btn--ghost" data-act="cancel">إلغاء</button>
        <div style="flex:1"></div>
        <button type="button" class="btn btn--primary" data-act="save">حفظ</button>
      `;

      const ctrl = window.utils.openModal({
        title: `${existing ? 'تعديل' : 'إضافة'} — ${KIND_META[kind].label}`,
        body, footer
      });

      const chips = ctrl.modal.querySelector('#pm-wallets');
      if (chips) {
        chips.addEventListener('click', (e) => {
          const chip = e.target.closest('[data-wallet]');
          if (!chip) return;
          chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
        });
      }

      const form = ctrl.modal.querySelector('#pm-form');
      const saveBtn = ctrl.modal.querySelector('[data-act="save"]');
      ctrl.modal.querySelector('[data-act="cancel"]').addEventListener('click', () => { ctrl.close(); resolve(null); });

      saveBtn.addEventListener('click', async () => {
        const fd = new FormData(form);
        const payload = {
          kind,
          note: fd.get('note'),
          is_active: existing ? existing.is_active : true
        };
        if (kind === 'bank') { payload.iban = fd.get('iban'); payload.title = fd.get('title'); }
        if (kind === 'wallet') {
          payload.phone = fd.get('phone');
          payload.wallets = Array.from(chips.querySelectorAll('[aria-pressed="true"]')).map((c) => c.dataset.wallet);
        }
        saveBtn.disabled = true;
        saveBtn.dataset.loading = 'true';
        try {
          const saved = existing
            ? await window.api.updatePaymentMethod(existing.id, payload)
            : await window.api.createPaymentMethod(payload);
          ctrl.close();
          resolve(saved);
        } catch (err) {
          window.utils.toast(window.utils.formatError(err), 'error');
          saveBtn.disabled = false;
          delete saveBtn.dataset.loading;
        }
      });
    });
  }

  const page = {
    async mount(container, ctx) {
      container.innerHTML = TEMPLATE();
      window.utils.renderIcons(container);

      const listHost = container.querySelector('#methods-body');
      const previewHost = container.querySelector('#pay-preview');
      let methods = [];

      const paint = () => { renderList(listHost, methods); renderPreview(previewHost, methods); };

      try {
        methods = await window.api.listPaymentMethods();
      } catch (err) {
        listHost.innerHTML = `<div class="empty-state"><p>${esc(window.utils.formatError(err))}</p></div>`;
        return;
      }
      paint();

      // ── الإضافة ──
      container.querySelector('.page-header .actions').addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-add]');
        if (!btn) return;
        const kind = btn.dataset.add;
        if (kind === 'cash' && methods.some((m) => m.kind === 'cash')) {
          window.utils.toast('«الدفع عند الاستلام» مُضاف مسبقًا', 'warning');
          return;
        }
        const saved = await openMethodModal(kind, null);
        if (!saved) return;
        methods.push(saved);
        paint();
        window.utils.toast('أُضيفت الطريقة — يراها عميلك الآن', 'success');
      });

      // ── التعديل والإطفاء والحذف ──
      listHost.addEventListener('click', async (e) => {
        const row = e.target.closest('.pay-row');
        if (!row) return;
        const id = row.dataset.id;
        const idx = methods.findIndex((m) => m.id === id);
        if (idx < 0) return;

        if (e.target.closest('[data-edit]')) {
          const saved = await openMethodModal(methods[idx].kind, methods[idx]);
          if (!saved) return;
          methods[idx] = saved;
          paint();
          window.utils.toast('تم الحفظ', 'success');
          return;
        }

        if (e.target.closest('[data-delete]')) {
          const ok = await window.utils.confirm({
            title: 'حذف طريقة الدفع',
            message: 'لن يراها عميلك بعد الآن. يمكنك إطفاؤها بدل حذفها.',
            confirmText: 'حذف',
            danger: true
          });
          if (!ok) return;
          try {
            await window.api.deletePaymentMethod(id);
            methods.splice(idx, 1);
            paint();
            window.utils.toast('حُذفت الطريقة', 'success');
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
          }
        }
      });

      listHost.addEventListener('change', async (e) => {
        const input = e.target.closest('[data-toggle]');
        if (!input) return;
        const row = input.closest('.pay-row');
        const id = row.dataset.id;
        const idx = methods.findIndex((m) => m.id === id);
        if (idx < 0) return;
        const next = input.checked;
        input.disabled = true;
        try {
          const saved = await window.api.setPaymentMethodActive(id, next);
          methods[idx] = saved;
          paint();
          window.utils.toast(next ? 'يراها عميلك الآن' : 'أُطفئت — لا يراها عميلك', 'success');
        } catch (err) {
          input.checked = !next;
          input.disabled = false;
          window.utils.toast(window.utils.formatError(err), 'error');
        }
      });
    },

    unmount() {}
  };

  window.pages = window.pages || {};
  window.pages.payments = page;
})();
