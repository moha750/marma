// مسح بطاقة الولاء والصرف عند الكاونتر — متاحة للموظفين، فهم من يصرفون فعلاً.
//
// المسح على مسارين لأن الكاميرا وحدها لا تكفي في ملعب مساءً:
//   1) BarcodeDetector الأصلي (Android/Chrome) أو jsQR على إطارات canvas (iOS)
//   2) إدخال يدوي لآخر خانات الرمز — يعمل دائماً، ويظهر بجانب الكاميرا لا خلفها
//
// الصرف يفرّق بين نوعين:
//   free_item          → صرف مباشر (مشروبات، كرة) بلا حجز
//   أنواع الخصم        → تُربط بحجز فعلي فيُخصم من فاتورته ويظهر الأثر في التقارير
(function () {
  const esc = (v) => window.utils.escapeHtml(v == null ? '' : String(v));

  const page = {
    async mount(container, ctx) {
      ctx = ctx || (window.layout && window.layout.getContext()) || {};
      // الماسح متاح للموظف عمداً، و/loyalty/cards للمالك وحده — فرابط
      // «التفاصيل» كان يقذف الموظف إلى لوحة التحكم بلا تفسير.
      const isOwner = !!(ctx.profile && ctx.profile.role === 'owner');
      let alive = true;
      let stream = null, rafId = null, detector = null, busy = false;
      let current = null;             // آخر بطاقة مقروءة

      page._cleanup = [() => { alive = false; stopCamera(); }];

      container.innerHTML = `
        <div class="page-header">
          <div>
            <h2>مسح البطاقة</h2>
            <div class="page-subtitle">امسح رمز بطاقة العميل أو أدخل رمزها يدوياً</div>
          </div>
        </div>

        <div class="scan-grid">
          <div class="card"><div class="card-body">
            <div class="scan-viewport" id="viewport">
              <video id="cam" playsinline muted></video>
              <div class="scan-frame" aria-hidden="true"></div>
              <div class="scan-hint" id="cam-hint">
                <i data-lucide="camera"></i>
                <span>اضغط لتشغيل الكاميرا</span>
              </div>
            </div>
            <div class="scan-cam-actions">
              <button class="btn btn--primary" id="cam-toggle">
                <i data-lucide="camera"></i> تشغيل الكاميرا
              </button>
            </div>
          </div></div>

          <div class="card"><div class="card-body">
            <div class="form-group mb-0">
              <label class="form-label" for="manual">إدخال يدوي</label>
              <div class="scan-manual">
                <input class="form-control" id="manual" dir="ltr" autocomplete="off"
                  placeholder="آخر 6 خانات من رمز البطاقة">
                <button class="btn btn--ghost" id="manual-go">بحث</button>
              </div>
              <div class="form-help">الرمز مطبوع على ظهر بطاقة العميل وأسفل رمز QR.</div>
            </div>
          </div></div>
        </div>

        <div id="scan-result"></div>
      `;
      window.utils.renderIcons(container);

      const video = container.querySelector('#cam');
      const viewport = container.querySelector('#viewport');
      const camHint = container.querySelector('#cam-hint');
      const camBtn = container.querySelector('#cam-toggle');
      const manual = container.querySelector('#manual');
      const result = container.querySelector('#scan-result');

      // ─── الكاميرا ────────────────────────────────────────

      async function startCamera() {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } }, audio: false
          });
          if (!alive) return stopCamera();
          video.srcObject = stream;
          await video.play();
          viewport.classList.add('is-live');
          camHint.style.display = 'none';
          camBtn.innerHTML = '<i data-lucide="camera-off"></i> إيقاف';
          window.utils.renderIcons(camBtn);

          if ('BarcodeDetector' in window) {
            const formats = await window.BarcodeDetector.getSupportedFormats();
            if (formats.includes('qr_code')) {
              detector = new window.BarcodeDetector({ formats: ['qr_code'] });
            }
          }
          if (!detector) await loadJsQr();
          tick();
        } catch (err) {
          window.utils.toast('تعذّر فتح الكاميرا — استخدم الإدخال اليدوي', 'error');
          stopCamera();
        }
      }

      function stopCamera() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        if (stream) stream.getTracks().forEach((t) => t.stop());
        stream = null;
        detector = null;
        if (video) video.srcObject = null;
        if (viewport) viewport.classList.remove('is-live');
        if (camHint) camHint.style.display = '';
        if (camBtn) {
          camBtn.innerHTML = '<i data-lucide="camera"></i> تشغيل الكاميرا';
          window.utils.renderIcons(camBtn);
        }
      }

      // jsQR بديل لأجهزة iOS — BarcodeDetector غير مدعوم على Safari.
      // يُحمَّل بتأجيل (٢٥١ ك.ب لا تُدفع إلا عند فتح الماسح فعلاً) ومن نطاقنا:
      // في النسخة الأصلية لا شبكة تُنتظر، وفي الويب لا CDN يتعطّل أو يتغيّر.
      function loadJsQr() {
        if (window.jsQR) return Promise.resolve();
        return new Promise((resolve) => {
          const s = document.createElement('script');
          s.src = (window.__BASE__ || '') + '/assets/vendor/jsQR.js';
          s.onload = resolve;
          s.onerror = () => resolve();   // نكمل بالإدخال اليدوي
          document.head.appendChild(s);
        });
      }

      let canvas = null, cctx = null;
      async function tick() {
        if (!alive || !stream) return;
        if (!busy && video.readyState >= 2) {
          try {
            let raw = null;
            if (detector) {
              const codes = await detector.detect(video);
              if (codes.length) raw = codes[0].rawValue;
            } else if (window.jsQR) {
              if (!canvas) {
                canvas = document.createElement('canvas');
                cctx = canvas.getContext('2d', { willReadFrequently: true });
              }
              const w = video.videoWidth, h = video.videoHeight;
              if (w && h) {
                canvas.width = w; canvas.height = h;
                cctx.drawImage(video, 0, 0, w, h);
                const img = cctx.getImageData(0, 0, w, h);
                const code = window.jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
                if (code) raw = code.data;
              }
            }
            if (raw) await onDetected(raw);
          } catch (_) { /* إطار فاشل لا يوقف المسح */ }
        }
        rafId = requestAnimationFrame(tick);
      }

      async function onDetected(raw) {
        busy = true;
        if (navigator.vibrate) navigator.vibrate(40);
        await lookup(raw);
        // مهلة قبل قبول مسح جديد كي لا يتكرر نفس الرمز عشرات المرات
        setTimeout(() => { busy = false; }, 2500);
      }

      // ─── البحث والعرض ────────────────────────────────────

      async function lookup(payload) {
        result.innerHTML = '<div class="loader-center"><div class="loader"></div></div>';
        try {
          const d = await window.loyaltyApi.scanLookup(payload);
          if (!alive) return;
          // الطلبات المعلّقة لهذه البطاقة: المسح هو اللحظة التي يقف فيها
          // العميل أمامك، فهي أولى لحظةٍ بحسم ختمه. وفشلُها لا يُفشل المسح.
          try {
            const all = await window.loyaltyApi.pendingStamps();
            d.pending = (all || []).filter((r) => r.card_id === (d.card && d.card.id));
          } catch (_) { d.pending = []; }
          if (!alive) return;
          current = d;
          renderCard(d);
        } catch (err) {
          if (!alive) return;
          current = null;
          result.innerHTML = `<div class="card"><div class="empty-state">
            <div class="empty-icon"><i data-lucide="scan-line"></i></div>
            <h3>${esc(window.utils.formatError(err))}</h3>
          </div></div>`;
          window.utils.renderIcons(result);
        }
      }

      function renderCard(d) {
        const c = d.card || {};
        const cu = d.customer || {};
        const rewards = (d.rewards || []).filter((r) => r.status === 'available');

        result.innerHTML = `
          <div class="card"><div class="card-body">
            <div class="scan-card-head">
              <div>
                <div class="scan-name">${esc(cu.full_name)}</div>
                <div class="scan-phone" dir="ltr">${esc(cu.phone)}</div>
              </div>
              <div class="scan-balance">
                <div class="scan-balance-value">${Math.round(Number(c.balance || 0))}</div>
                <div class="scan-balance-cap">ختماً</div>
              </div>
            </div>

            ${(d.pending || []).length ? `
              <div class="scan-pending">
                <div class="scan-pending-head">
                  <i data-lucide="stamp"></i>
                  <span>${(d.pending || []).length} ختم بانتظار قرارك</span>
                </div>
                ${d.pending.map((p) => `
                  <div class="scan-pending-row" data-prow="${esc(p.id)}">
                    <div>
                      <div class="scan-pending-field">${esc(p.field_name || '')}</div>
                      <div class="scan-pending-date">${esc(window.utils.formatDate(new Date(p.booking_start)))}</div>
                    </div>
                    <div class="scan-pending-actions">
                      <button class="btn btn--primary btn--sm" data-stamp-ok="${esc(p.id)}">وافق</button>
                      <button class="btn btn--danger-quiet btn--sm" data-stamp-no="${esc(p.id)}">ارفض</button>
                    </div>
                  </div>`).join('')}
              </div>` : ''}

            ${rewards.length ? `
              <div class="scan-rewards">
                ${rewards.map((r) => `
                  <div class="scan-reward">
                    <div>
                      <div class="scan-reward-label">${esc(r.label)}</div>
                      <div class="scan-reward-code" dir="ltr">${esc(r.code)}</div>
                    </div>
                    ${r.kind === 'free_item'
                      ? `<button class="btn btn--primary btn--sm" data-redeem="${esc(r.code)}">صرف</button>`
                      : `<button class="btn btn--primary btn--sm" data-apply="${esc(r.code)}">تطبيق على حجز</button>`}
                  </div>`).join('')}
              </div>`
              : `<div class="scan-none"><i data-lucide="info"></i> لا مكافآت متاحة على هذه البطاقة حالياً.</div>`}

            <div class="scan-foot">
              <span>رمز البطاقة <b dir="ltr">${esc((c.serial || '').substring(0, 8))}</b></span>
              ${isOwner ? `
              <a class="btn btn--ghost btn--sm" href="${window.utils.path('/loyalty/cards')}">
                <i data-lucide="external-link"></i> التفاصيل
              </a>` : ''}
            </div>
          </div></div>`;
        window.utils.renderIcons(result);

        result.querySelectorAll('[data-stamp-ok], [data-stamp-no]').forEach((b) =>
          b.addEventListener('click', () => decideStamp(b, d)));
        result.querySelectorAll('[data-redeem]').forEach((b) =>
          b.addEventListener('click', () => doRedeem(b.dataset.redeem, d)));
        result.querySelectorAll('[data-apply]').forEach((b) =>
          b.addEventListener('click', () => openApply(b.dataset.apply, d)));
      }

      // ─── قرار الختم ──────────────────────────────────────

      // بعد القرار نُعيد المسح لا نُعدّل الصفّ محلياً: الموافقة قد تبلغ العتبة
      // فتُصدر مكافأة — والشاشة يجب أن تُظهرها فوراً وإلا صرف الموظف بطاقةً
      // يظنّها بلا مكافأة.
      async function decideStamp(btn, d) {
        const approve = btn.hasAttribute('data-stamp-ok');
        const id = btn.getAttribute(approve ? 'data-stamp-ok' : 'data-stamp-no');
        const row = btn.closest('.scan-pending-row');
        row.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        try {
          await window.loyaltyApi.decideStamp(id, approve);
          if (!alive) return;
          window.utils.toast(approve ? 'مُنح الختم' : 'رُفض الطلب', approve ? 'success' : 'info');
          await lookup((d.card && d.card.serial) || '');
        } catch (err) {
          if (!alive) return;
          window.utils.toast(window.utils.formatError(err), 'error');
          row.querySelectorAll('button').forEach((b) => { b.disabled = false; });
        }
      }

      // ─── الصرف ───────────────────────────────────────────

      // رمز الاستبدال يُطلب من العميل لا يُقرأ من الشاشة — وإلا فقد معناه
      async function askPin(d) {
        const pin = d.card && d.card.redeem_pin;
        if (!pin) return null;
        const entered = prompt('اطلب من العميل رمز الاستبدال المكتوب في ظهر بطاقته:');
        return entered == null ? false : entered.trim();
      }

      async function doRedeem(code, d) {
        const pin = await askPin(d);
        if (pin === false) return;
        const ok = await window.utils.confirm({
          title: 'صرف المكافأة',
          message: 'تأكيد صرف هذه المكافأة للعميل الآن؟',
          confirmText: 'صرف'
        });
        if (!ok) return;
        try {
          await window.loyaltyApi.redeemReward(code, pin);
          window.utils.toast('تم الصرف', 'success');
          await lookup(d.card.serial);
        } catch (err) { window.utils.toast(window.utils.formatError(err), 'error'); }
      }

      async function openApply(code, d) {
        let bookings = [];
        try {
          bookings = await window.customersApi.getCustomerBookings(d.card.customer_id);
        } catch (_) { /* نكمل بقائمة فارغة */ }

        // القابل للتطبيق: غير ملغي، ليس غياباً، له سعر، وبلا مكافأة سابقة
        const eligible = (bookings || []).filter((b) =>
          b.status !== 'cancelled' && !b.no_show_at
          && b.total_price != null && !b.loyalty_reward_id
        ).slice(0, 15);

        const ctrl = window.utils.openModal({
          title: 'تطبيق المكافأة على حجز',
          body: eligible.length ? `
            <p class="text-tertiary text-sm">اختر الحجز الذي تُطبَّق عليه المكافأة — سيُخصم من فاتورته مباشرة.</p>
            <div class="loy-picker">
              ${eligible.map((b) => `
                <button type="button" class="loy-picker-row" data-booking="${esc(b.id)}">
                  <span>
                    <span class="fw-semibold">${esc(b.fields ? b.fields.name : 'أرضية')}</span>
                    <span class="text-tertiary"> · ${esc(window.utils.formatDateTime(b.start_time))}</span>
                  </span>
                  <span class="fw-semibold">${esc(window.utils.formatCurrency(b.total_price))}</span>
                </button>`).join('')}
            </div>`
            : '<p class="text-tertiary">لا حجوزات صالحة لتطبيق المكافأة. أنشئ الحجز أولاً ثم امسح البطاقة.</p>',
          footer: '<button type="button" class="btn btn--ghost" data-action="close">إغلاق</button>'
        });
        ctrl.modal.querySelector('[data-action="close"]').addEventListener('click', ctrl.close);

        ctrl.modal.querySelectorAll('[data-booking]').forEach((b) =>
          b.addEventListener('click', async () => {
            const pin = await askPin(d);
            if (pin === false) return;
            b.disabled = true;
            try {
              const res = await window.loyaltyApi.applyReward(code, b.dataset.booking, pin);
              ctrl.close();
              window.utils.toast(
                `طُبِّقت المكافأة — خُصم ${window.utils.formatCurrency(res.discount)}`, 'success');
              await lookup(d.card.serial);
            } catch (err) {
              window.utils.toast(window.utils.formatError(err), 'error');
              b.disabled = false;
            }
          }));
      }

      // ─── الربط ───────────────────────────────────────────

      camBtn.addEventListener('click', () => (stream ? stopCamera() : startCamera()));
      container.querySelector('#manual-go').addEventListener('click', () => {
        const v = manual.value.trim();
        if (v) lookup(v);
      });
      manual.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); const v = manual.value.trim(); if (v) lookup(v); }
      });
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages['loyalty-scan'] = page;
})();
