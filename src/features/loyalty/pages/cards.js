// بطاقات الولاء — قائمة المنضمّين وقسائمهم وسجل حركاتهم.
//
// كل عرض هنا مشتقّ من الخادم: الرصيد وعدّادات القسائم تُحسب داخل قاعدة البيانات
// من دفتر الحركات، فلا حساب في الواجهة يمكن أن ينحرف عمّا في بطاقة العميل.
(function () {
  const AR = (n) => String(n == null ? '' : n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
  const esc = (v) => window.utils.escapeHtml(v == null ? '' : String(v));

  const REWARD_STATUS = {
    available: { label: 'متاحة',  cls: 'active' },
    redeemed:  { label: 'مصروفة', cls: 'approved' },
    expired:   { label: 'منتهية', cls: 'expired' },
    void:      { label: 'ملغاة',  cls: 'muted' }
  };

  const TX_REASON = {
    booking:       'ختم من حجز',
    manual:        'تعديل يدوي',
    reward_issued: 'إصدار قسيمة',
    reward_void:   'إلغاء قسيمة',
    expiry:        'انتهاء صلاحية',
    adjust:        'تسوية',
    signup_bonus:  'مكافأة انضمام',
    gift:          'إهداء من الملعب'
  };

  const page = {
    async mount(container, ctx) {
      ctx = ctx || (window.layout && window.layout.getContext()) || {};
      const isOwner = ctx.profile && ctx.profile.role === 'owner';
      let alive = true, rows = [], search = '';
      page._cleanup = [() => { alive = false; }];

      container.innerHTML = `
        <div class="page-header">
          <div>
            <h2>برنامج الولاء</h2>
            <div class="page-subtitle">كل عميل انضم للبرنامج، ورصيده وقسائمه</div>
          </div>
          <div class="actions">
            <button class="btn btn--primary" id="add-card"><i data-lucide="user-plus"></i> إصدار بطاقة</button>
          </div>
        </div>
        ${window.layout.pageTabs(window.layout.LOYALTY_TABS, '/loyalty/cards')}
        <div class="card loy-toolbar">
          <div class="form-group mb-0">
            <input class="form-control" id="card-search" placeholder="ابحث باسم العميل أو جوّاله أو رمز البطاقة">
          </div>
        </div>
        <div id="cards-body"><div class="loader-center"><div class="loader loader--lg"></div></div></div>
      `;
      window.utils.renderIcons(container);
      const body = container.querySelector('#cards-body');

      // ─── القائمة ─────────────────────────────────────────

      async function load() {
        try {
          const data = await window.loyaltyApi.listCards({ search, limit: 200 });
          if (!alive) return;
          rows = data;
          render();
        } catch (err) {
          if (!alive) return;
          body.innerHTML = `<div class="card"><div class="empty-state">
            <div class="empty-icon"><i data-lucide="triangle-alert"></i></div>
            <h3>تعذّر التحميل</h3><p>${esc(window.utils.formatError(err))}</p></div></div>`;
          window.utils.renderIcons(body);
        }
      }

      function render() {
        if (!rows.length) {
          body.innerHTML = `<div class="card"><div class="empty-state">
            <div class="empty-icon"><i data-lucide="credit-card"></i></div>
            <h3>${search ? 'لا نتائج' : 'لا بطاقات بعد'}</h3>
            <p>${search ? 'جرّب بحثاً آخر.' : 'تُصدَر البطاقة تلقائياً مع أول حجز مكتمل ومُسدَّد، أو أصدرها يدوياً الآن.'}</p>
          </div></div>`;
          window.utils.renderIcons(body);
          return;
        }
        const html = rows.map((c) => `
          <tr data-card="${c.id}" class="is-clickable">
            <td data-label="العميل" class="fw-semibold">${esc(c.customer_name)}</td>
            <td data-label="الجوال" dir="ltr" class="text-start">${esc(c.customer_phone)}</td>
            <td data-label="الأختام">${AR(Math.round(Number(c.balance || 0)))}</td>
            <td data-label="قسائم متاحة">
              ${Number(c.rewards_available) > 0
                ? `<span class="status-badge status-badge--active">${AR(c.rewards_available)}</span>`
                : '<span class="text-tertiary">—</span>'}
            </td>
            <td data-label="مصروفة">${AR(c.rewards_redeemed || 0)}</td>
            <td data-label="الحالة" class="card-tag">
              <span class="status-badge status-badge--${c.status === 'active' ? 'active' : 'muted'}">
                ${c.status === 'active' ? 'نشطة' : 'موقوفة'}</span>
            </td>
            <td data-label="الانضمام" class="text-tertiary">${esc(window.utils.formatDate(c.created_at))}</td>
            <td data-label="" class="actions-cell">
              <div class="actions-inline">
                <button class="btn btn--ghost btn--sm" data-share="${esc(c.serial)}"
                  data-name="${esc(c.customer_name)}" data-phone="${esc(c.customer_phone)}">
                  <i data-lucide="send"></i> إرسال
                </button>
                ${isOwner && c.status === 'active' ? `
                  <button class="btn btn--ghost btn--sm" data-gift="${c.id}">
                    <i data-lucide="gift"></i> إهداء
                  </button>` : ''}
                <button class="btn btn--ghost btn--sm" data-detail="${c.id}">
                  <i data-lucide="list"></i> التفاصيل
                </button>
              </div>
            </td>
          </tr>`).join('');
        body.innerHTML = `
          <div class="table-wrapper"><table class="table table--cards">
            <thead><tr><th>العميل</th><th>الجوال</th><th>الأختام</th><th>قسائم متاحة</th>
              <th>مصروفة</th><th>الحالة</th><th>الانضمام</th><th class="text-end"></th></tr></thead>
            <tbody>${html}</tbody>
          </table></div>`;
        window.utils.renderIcons(body);
        body.querySelectorAll('[data-card]').forEach((tr) =>
          tr.addEventListener('click', (e) => {
            // أزرار الخليّة تتكفّل بنفسها — وإلا فُتحت التفاصيل مرّتين
            if (e.target.closest('.actions-inline')) return;
            openDetail(tr.dataset.card);
          }));
        body.querySelectorAll('[data-share]').forEach((b) =>
          b.addEventListener('click', () => shareCard(b.dataset.share, b.dataset.name, b.dataset.phone)));
        body.querySelectorAll('[data-detail]').forEach((b) =>
          b.addEventListener('click', () => openDetail(b.dataset.detail)));
        body.querySelectorAll('[data-gift]').forEach((b) =>
          b.addEventListener('click', () => openDetail(b.dataset.gift, 'gift')));
      }

      // إرسال رابط البطاقة عبر واتساب — قناة التوزيع الأعلى تحويلاً عندنا.
      // الرابط بالرقم التسلسلي وحده: التوقيع يُتحقَّق منه عند تنزيل .pkpass،
      // والصفحة تقبل الصورتين فيعمل الرابط كما هو.
      function shareCard(serial, name, phone) {
        const link = `${location.origin}/card?c=${encodeURIComponent(serial)}`;
        const text = `مرحباً ${name} 👋\n\n`
          + `بطاقة ولائك في ${(ctx.tenant && ctx.tenant.name) || 'ملعبنا'} جاهزة لكسب مكافآت من حجوزاتك🏟️🪪.\n\n`
          + `أضِفها لمحفظة جوالك من هنا📱:\n${link}`;
        const digits = String(phone || '').replace(/\D/g, '').replace(/^0/, '966');
        window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      }

      // ─── تفاصيل البطاقة ──────────────────────────────────

      // focus: 'gift' يفتح النافذة على حقل الإهداء مباشرةً — من ضغط «إهداء»
      // قصَدَ الإهداء، فلا يُترك يبحث عنه بين القسائم والحركات
      async function openDetail(cardId, focus) {
        let ctrl;
        try {
          const d = await window.loyaltyApi.cardDetail(cardId);
          if (!alive) return;
          ctrl = window.utils.openModal({
            title: 'بطاقة ' + (d.customer ? d.customer.full_name : ''),
            size: 'lg',
            body: detailHtml(d),
            footer: '<button type="button" class="btn btn--ghost" data-action="close">إغلاق</button>'
          });
          ctrl.modal.querySelector('[data-action="close"]').addEventListener('click', ctrl.close);
          bindDetail(ctrl, d);

          if (focus === 'gift') {
            const gi = ctrl.modal.querySelector('#gift-delta');
            if (gi) { gi.scrollIntoView({ block: 'center' }); gi.focus(); }
          }
        } catch (err) {
          window.utils.toast(window.utils.formatError(err), 'error');
        }
      }

      function detailHtml(d) {
        const c = d.card || {};
        const rewards = d.rewards || [];
        const txs = d.transactions || [];
        return `
          <div class="loy-detail">
            <div class="loy-detail-head">
              <div>
                <div class="loy-detail-balance">${AR(Math.round(Number(c.balance || 0)))}</div>
                <div class="loy-detail-cap">أختام</div>
              </div>
              <div>
                <div class="loy-detail-balance">${AR(c.rewards_available || 0)}</div>
                <div class="loy-detail-cap">قسائم متاحة</div>
              </div>
              <div>
                <div class="loy-detail-serial" dir="ltr">${esc((c.serial || '').substring(0, 8))}</div>
                <div class="loy-detail-cap">رمز البطاقة</div>
              </div>
              ${c.redeem_pin ? `<div>
                <div class="loy-detail-serial" dir="ltr">${esc(c.redeem_pin)}</div>
                <div class="loy-detail-cap">رمز الاستبدال</div>
              </div>` : ''}
            </div>

            ${isOwner ? `
              <div class="loy-gift">
                <div class="form-label"><i data-lucide="gift"></i> إهداء أختام</div>
                <div class="loy-adjust">
                  <input class="form-control" id="gift-delta" type="number" min="1" max="50" step="1"
                         placeholder="عدد الأختام" style="max-width:11rem">
                  <input class="form-control" id="gift-note" maxlength="80" placeholder="مناسبة الإهداء (تُسجَّل)">
                  <button class="btn btn--primary btn--sm" id="gift-go">أهدِ الآن</button>
                </div>
              </div>

              <!-- التصحيح مطويّ عمداً: هو الاستثناء لا الإجراء المعتاد، وإبرازه
                   بجانب الإهداء يجعل الخطأ في متناول اليد كالصواب -->
              <details class="loy-correct">
                <summary>تصحيح خطأ</summary>
                <div class="loy-adjust">
                  <input class="form-control" id="adj-delta" type="number" step="1" placeholder="± عدد الأختام" style="max-width:11rem">
                  <input class="form-control" id="adj-note" maxlength="80" placeholder="سبب التصحيح (يُسجَّل)">
                  <button class="btn btn--ghost btn--sm" id="adj-go">صحّح</button>
                </div>
              </details>` : ''}

            <div class="loy-detail-section">
              <div class="form-label">القسائم</div>
              ${rewards.length ? `<div class="loy-rewards">${rewards.map((r) => `
                <div class="loy-reward">
                  <div>
                    <div class="loy-reward-code" dir="ltr">${esc(r.code)}</div>
                    <div class="loy-reward-label">${esc(r.label)}</div>
                    <div class="loy-reward-meta">
                      ${esc(window.utils.formatDate(r.issued_at))}
                      ${r.expires_at ? ' · تنتهي ' + esc(window.utils.formatDate(r.expires_at)) : ''}
                    </div>
                  </div>
                  <div class="loy-reward-side">
                    <span class="status-badge status-badge--${(REWARD_STATUS[r.status] || {}).cls || 'expired'}">
                      ${(REWARD_STATUS[r.status] || {}).label || r.status}</span>
                    ${r.status === 'available' && r.kind === 'free_item'
                      ? `<button class="btn btn--primary btn--sm" data-redeem="${esc(r.code)}">صرف</button>` : ''}
                    ${r.status === 'redeemed'
                      ? `<button class="btn btn--ghost btn--sm" data-release="${esc(r.code)}">تراجع</button>` : ''}
                  </div>
                </div>`).join('')}</div>`
                : '<p class="text-tertiary">لا قسائم بعد.</p>'}
            </div>

            <div class="loy-detail-section">
              <div class="form-label">آخر الحركات</div>
              ${txs.length ? `<div class="loy-txs">${txs.map((t) => `
                <div class="loy-tx">
                  <span class="loy-tx-delta ${Number(t.delta) >= 0 ? 'is-plus' : 'is-minus'}">
                    ${Number(t.delta) >= 0 ? '+' : '−'}${AR(Math.abs(Math.round(Number(t.delta))))}
                  </span>
                  <span class="loy-tx-reason">${esc(TX_REASON[t.reason] || t.reason)}${t.note ? ' · ' + esc(t.note) : ''}</span>
                  <span class="loy-tx-date">${esc(window.utils.formatDate(t.created_at))}</span>
                </div>`).join('')}</div>`
                : '<p class="text-tertiary">لا حركات بعد.</p>'}
            </div>
          </div>`;
      }

      function bindDetail(ctrl, d) {
        const m = ctrl.modal;
        const reopen = async () => { ctrl.close(); await load(); openDetail(d.card.id); };

        const giftBtn = m.querySelector('#gift-go');
        if (giftBtn) giftBtn.addEventListener('click', async () => {
          const delta = Number(m.querySelector('#gift-delta').value || 0);
          const note = m.querySelector('#gift-note').value;
          if (!(delta > 0)) { window.utils.toast('أدخل عدد الأختام المُهداة', 'error'); return; }
          // الإهداء لا رجعة فيه من الواجهة (والقسيمة قد تُصدَر فوراً عند العتبة)
          const ok = await window.utils.confirm({
            title: 'إهداء أختام',
            message: `إهداء ${AR(delta)} ختماً إلى ${(d.customer && d.customer.full_name) || 'هذا العميل'}؟ سيصله إشعار على جواله.`,
            confirmText: 'أهدِ'
          });
          if (!ok) return;
          giftBtn.disabled = true;
          try {
            await window.loyaltyApi.gift(d.card.id, delta, note);
            window.utils.toast('تم الإهداء', 'success');
            await reopen();
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
            giftBtn.disabled = false;
          }
        });

        const adjBtn = m.querySelector('#adj-go');
        if (adjBtn) adjBtn.addEventListener('click', async () => {
          const delta = Number(m.querySelector('#adj-delta').value || 0);
          const note = m.querySelector('#adj-note').value;
          if (!delta) { window.utils.toast('أدخل قيمة التصحيح', 'error'); return; }
          adjBtn.disabled = true;
          try {
            await window.loyaltyApi.adjust(d.card.id, delta, note);
            window.utils.toast('تم التصحيح', 'success');
            await reopen();
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
            adjBtn.disabled = false;
          }
        });

        m.querySelectorAll('[data-redeem]').forEach((b) => b.addEventListener('click', async () => {
          const pin = d.card.redeem_pin || null;
          const ok = await window.utils.confirm({
            title: 'صرف المكافأة',
            message: 'تأكيد صرف هذه المكافأة للعميل الآن؟',
            confirmText: 'صرف'
          });
          if (!ok) return;
          try {
            await window.loyaltyApi.redeemReward(b.dataset.redeem, pin);
            window.utils.toast('تم الصرف', 'success');
            await reopen();
          } catch (err) { window.utils.toast(window.utils.formatError(err), 'error'); }
        }));

        m.querySelectorAll('[data-release]').forEach((b) => b.addEventListener('click', async () => {
          const ok = await window.utils.confirm({
            title: 'التراجع عن الصرف',
            message: 'تعود القسيمة متاحة، ويُستعاد سعر الحجز الأصلي إن كانت مرتبطة بحجز.',
            confirmText: 'تراجع'
          });
          if (!ok) return;
          try {
            await window.loyaltyApi.releaseReward(b.dataset.release);
            window.utils.toast('عادت القسيمة متاحة', 'success');
            await reopen();
          } catch (err) { window.utils.toast(window.utils.formatError(err), 'error'); }
        }));
      }

      // ─── إصدار بطاقة يدوياً ──────────────────────────────

      function openEnroll() {
        const ctrl = window.utils.openModal({
          title: 'إصدار بطاقة',
          body: `
            <div class="form-group">
              <label class="form-label" for="enroll-search">ابحث عن العميل</label>
              <input class="form-control" id="enroll-search" placeholder="الاسم أو رقم الجوال" autocomplete="off">
            </div>
            <div id="enroll-results" class="loy-picker"></div>`,
          footer: '<button type="button" class="btn btn--ghost" data-action="close">إغلاق</button>'
        });
        ctrl.modal.querySelector('[data-action="close"]').addEventListener('click', ctrl.close);
        const input = ctrl.modal.querySelector('#enroll-search');
        const results = ctrl.modal.querySelector('#enroll-results');

        const run = window.utils.debounce(async () => {
          const q = input.value.trim();
          if (q.length < 2) { results.innerHTML = '<p class="text-tertiary">اكتب حرفين على الأقل.</p>'; return; }
          try {
            const list = await window.customersApi.listCustomers(q);
            const have = new Set(rows.map((r) => r.customer_id));
            results.innerHTML = list.length ? list.slice(0, 12).map((c) => `
              <button type="button" class="loy-picker-row" data-cust="${c.id}" ${have.has(c.id) ? 'disabled' : ''}>
                <span class="fw-semibold">${esc(c.full_name)}</span>
                <span dir="ltr" class="text-tertiary">${esc(c.phone)}</span>
                ${have.has(c.id) ? '<span class="text-tertiary">له بطاقة</span>' : '<i data-lucide="plus"></i>'}
              </button>`).join('') : '<p class="text-tertiary">لا نتائج.</p>';
            window.utils.renderIcons(results);
            results.querySelectorAll('[data-cust]').forEach((b) => b.addEventListener('click', async () => {
              b.disabled = true;
              try {
                await window.loyaltyApi.enroll(b.dataset.cust);
                window.utils.toast('تم إصدار البطاقة', 'success');
                ctrl.close();
                await load();
              } catch (err) {
                window.utils.toast(window.utils.formatError(err), 'error');
                b.disabled = false;
              }
            }));
          } catch (err) {
            results.innerHTML = `<p class="text-danger">${esc(window.utils.formatError(err))}</p>`;
          }
        }, 300);
        input.addEventListener('input', run);
        setTimeout(() => input.focus(), 50);
      }

      // ─── الربط ───────────────────────────────────────────

      const searchEl = container.querySelector('#card-search');
      const onSearch = window.utils.debounce(() => { search = searchEl.value.trim(); load(); }, 350);
      searchEl.addEventListener('input', onSearch);
      container.querySelector('#add-card').addEventListener('click', openEnroll);
      page._cleanup.push(() => searchEl.removeEventListener('input', onSearch));

      if (window.realtime) {
        page._cleanup.push(window.realtime.on('loyalty:change', window.utils.debounce(() => {
          if (alive) load();
        }, 700)));
      }

      await load();
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages['loyalty-cards'] = page;
})();
