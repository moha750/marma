// الأختام المعلّقة — كل حجز مكتمل ومُسدَّد يرفع طلباً، ولا يُمنح ختمٌ إلا من هنا.
//
// لماذا صفحة لا نافذة؟ لأن القرار متكرّر ويومي: المالك يفتحها فيمرّ على ما
// تراكم دفعةً واحدة. والقائمة مرتّبة بالأقدم أولاً — من انتظر أكثر يُحسم أولاً.
//
// الرفض لا يُخفي الصفّ فحسب: هو قرارٌ مسجَّل (مَن ومتى) لأن العميل قد يسأل.
(function () {
  const esc = (s) => window.utils.escapeHtml(String(s == null ? '' : s));
  const AR = (n) => String(n == null ? '' : n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

  const page = {
    async mount(container, ctx) {
      ctx = ctx || (window.layout && window.layout.getContext()) || {};
      let alive = true;
      let rows = [];
      page._cleanup = [() => { alive = false; }];

      container.innerHTML = `
        <div class="page-header">
          <div>
            <h2>الأختام المعلّقة</h2>
            <div class="page-subtitle">كل حجز مكتمل ومُسدَّد يرفع طلب ختم — لا يُمنح حتى توافق</div>
          </div>
        </div>
        ${window.layout.pageTabs(window.layout.LOYALTY_TABS, '/loyalty/stamps')}
        <div id="stamps-body"><div class="loader-center"><div class="loader loader--lg"></div></div></div>
      `;
      const body = container.querySelector('#stamps-body');

      async function load() {
        try {
          rows = await window.loyaltyApi.pendingStamps();
          if (!alive) return;
          render();
        } catch (err) {
          if (!alive) return;
          body.innerHTML = `<div class="card"><div class="empty-state">
            <div class="empty-icon"><i data-lucide="triangle-alert"></i></div>
            <h3>تعذّر التحميل</h3>
            <p>${esc(window.utils.formatError(err))}</p>
          </div></div>`;
          window.utils.renderIcons(body);
        }
      }

      function render() {
        if (!rows.length) {
          body.innerHTML = `<div class="card"><div class="empty-state">
            <div class="empty-icon"><i data-lucide="check-check"></i></div>
            <h3>لا طلبات معلّقة</h3>
            <p>حين يُكمل عميلٌ يحمل بطاقة حجزاً مُسدَّداً، يظهر طلب ختمه هنا.</p>
          </div></div>`;
          window.utils.renderIcons(body);
          return;
        }

        body.innerHTML = `
          <div class="card"><div class="card-body">
            <div class="stamp-reqs">
              ${rows.map((r) => `
                <div class="stamp-req" data-row="${esc(r.id)}">
                  <div class="stamp-req-main">
                    <div class="stamp-req-name">${esc(r.customer_name || '')}</div>
                    <div class="stamp-req-meta">
                      <span><i data-lucide="goal"></i>${esc(r.field_name || '')}</span>
                      <span><i data-lucide="calendar"></i>${esc(window.utils.formatDate(new Date(r.booking_start)))}</span>
                      <span dir="ltr">${esc(r.customer_phone || '')}</span>
                    </div>
                  </div>
                  <div class="stamp-req-count">
                    <bdi dir="ltr">${AR(Number(r.balance) || 0)} / ${AR(Number(r.threshold) || 0)}</bdi>
                    <small>الرصيد الآن</small>
                  </div>
                  <div class="stamp-req-actions">
                    <button class="btn btn--primary btn--sm" data-approve="${esc(r.id)}">
                      <i data-lucide="check"></i><span>وافق</span>
                    </button>
                    <button class="btn btn--danger-quiet btn--sm" data-reject="${esc(r.id)}">
                      <i data-lucide="x"></i><span>ارفض</span>
                    </button>
                  </div>
                </div>`).join('')}
            </div>
          </div></div>`;
        window.utils.renderIcons(body);
      }

      // تفويض على الحاوية: الصفوف تُعاد كتابتها بعد كل قرار
      body.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-approve], [data-reject]');
        if (!btn) return;
        const approve = btn.hasAttribute('data-approve');
        const id = btn.getAttribute(approve ? 'data-approve' : 'data-reject');

        // الرفض قرارٌ لا رجعة فيه من الواجهة — أكّده. والموافقة تمضي بلا سؤال:
        // هي المسار المتوقّع، وسؤالٌ على كل ختمٍ يجعل الشاشة عبئاً.
        if (!approve) {
          const ok = await window.utils.confirm({
            title: 'رفض الختم',
            message: 'لن يُمنح هذا الختم، ولا يمكن التراجع من هنا.',
            confirmText: 'نعم، ارفض',
            cancelText: 'تراجع',
            danger: true
          });
          if (!ok) return;
        }

        const row = btn.closest('.stamp-req');
        row.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        try {
          await window.loyaltyApi.decideStamp(id, approve);
          if (!alive) return;
          rows = rows.filter((r) => r.id !== id);
          render();
          window.utils.toast(approve ? 'مُنح الختم' : 'رُفض الطلب', approve ? 'success' : 'info');
          if (window.store) window.store.invalidate('loyalty:program');
        } catch (err) {
          if (!alive) return;
          window.utils.toast(window.utils.formatError(err), 'error');
          row.querySelectorAll('button').forEach((b) => { b.disabled = false; });
        }
      });

      // طلبٌ جديد قد يصل والصفحة مفتوحة — الموظف عند الكاونتر ينتظر
      if (window.realtime) {
        const refresh = window.utils.debounce(async () => {
          if (!alive) return;
          try {
            rows = await window.loyaltyApi.pendingStamps();
            if (alive) render();
          } catch (_) { /* التحديث اللحظي ليس حرجاً */ }
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
  window.pages['loyalty-stamps'] = page;
})();
