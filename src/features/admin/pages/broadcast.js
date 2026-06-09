// لوحة المشرف العام — بثّ رسالة (إشعار/بريد) لكل الملّاك أو ملّاك محدّدين.
(function () {
  const CHANNEL_LABEL = { push: 'إشعار', email: 'بريد' };

  function channelBadges(channels) {
    return (channels || []).map((c) =>
      `<span class="badge badge--muted">${CHANNEL_LABEL[c] || c}</span>`
    ).join(' ') || '—';
  }

  function audienceBadge(b) {
    return b.audience === 'selected'
      ? '<span class="badge badge--info">محدّدون</span>'
      : '<span class="badge badge--muted">الكل</span>';
  }

  function reachCell(b) {
    const parts = [];
    if ((b.channels || []).includes('push')) {
      parts.push(`<span class="reach-stat"><i data-lucide="bell"></i> ${b.push_sent}</span>`);
    }
    if ((b.channels || []).includes('email')) {
      parts.push(`<span class="reach-stat"><i data-lucide="mail"></i> ${b.email_sent}</span>`);
    }
    return parts.join(' · ') || '—';
  }

  function renderHistory(list) {
    if (!list.length) {
      return `<div class="card"><div class="empty-state">
        <div class="empty-icon"><i data-lucide="megaphone"></i></div>
        <h3>لا توجد رسائل بعد</h3><p>ستظهر هنا كل الرسائل التي تبثّها للملّاك.</p>
      </div></div>`;
    }
    const rows = list.map((b) => `
      <tr>
        <td data-label="الرسالة">
          <div class="fw-semibold">${window.utils.escapeHtml(b.title)}</div>
          <div class="text-tertiary text-xs truncate-1">${window.utils.escapeHtml(b.body)}</div>
        </td>
        <td data-label="القنوات">${channelBadges(b.channels)}</td>
        <td data-label="الجمهور">${audienceBadge(b)}</td>
        <td data-label="الوصول">${reachCell(b)}</td>
        <td data-label="المستلمون">${b.recipients}</td>
        <td data-label="التاريخ">${window.utils.formatDate(b.created_at)}</td>
      </tr>`).join('');
    return `
      <div class="table-wrapper">
        <table class="table table--cards">
          <thead>
            <tr><th>الرسالة</th><th>القنوات</th><th>الجمهور</th><th>الوصول</th><th>المستلمون</th><th>التاريخ</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function ownerItemHtml(o) {
    const pushTag = o.has_push
      ? '<span class="owner-tag" title="لديه جهاز مفعِّل للإشعارات"><i data-lucide="bell"></i></span>'
      : '';
    const sub = [o.tenant_name, o.email].filter(Boolean).map(window.utils.escapeHtml).join(' · ');
    return `
      <label class="owner-item">
        <input type="checkbox" value="${window.utils.escapeHtml(o.user_id)}">
        <span class="owner-check"><i data-lucide="check"></i></span>
        <span class="owner-main">
          <span class="owner-name">${window.utils.escapeHtml(o.name || '—')}</span>
          <span class="owner-sub">${sub || '—'}</span>
        </span>
        ${pushTag}
      </label>`;
  }

  const page = {
    async mount(container, ctx) {
      let alive = true;
      page._cleanup = [() => { alive = false; }];

      container.innerHTML = `
        <div class="page-header">
          <div>
            <h2>بثّ رسالة</h2>
            <div class="page-subtitle">أرسل إشعارًا أو بريدًا لكل الملّاك أو لملّاك محدّدين</div>
          </div>
        </div>

        <div class="card" style="margin-bottom:var(--space-5)">
          <div class="card-body">
            <form id="broadcast-form">
              <div class="form-group">
                <label class="form-label" for="bc-title">العنوان</label>
                <input type="text" class="form-control" id="bc-title" maxlength="80"
                       placeholder="مثال: صيانة مجدولة يوم الجمعة" required>
              </div>

              <div class="form-group">
                <label class="form-label" for="bc-body">الرسالة</label>
                <textarea class="form-control" id="bc-body" rows="4" maxlength="500"
                          placeholder="اكتب نص الرسالة التي ستصل للملّاك…" required></textarea>
                <span class="form-help">يظهر العنوان والنص في الإشعار، وبتنسيق رسالة في البريد.</span>
              </div>

              <div class="form-group">
                <label class="form-label">الجمهور</label>
                <div class="channel-row" id="audience-toggle">
                  <label class="form-check">
                    <input type="radio" name="audience" value="all" checked>
                    <i data-lucide="users"></i> كل الملّاك
                  </label>
                  <label class="form-check">
                    <input type="radio" name="audience" value="selected">
                    <i data-lucide="user-check"></i> ملّاك محدّدون
                  </label>
                </div>
                <div id="audience-line" class="audience-banner" style="margin-top:var(--space-3)">
                  <i data-lucide="users"></i><span>جارٍ حساب الجمهور…</span>
                </div>

                <div id="owner-picker" class="owner-picker" hidden>
                  <div class="owner-picker-head">
                    <input type="search" class="form-control" id="owner-search" placeholder="ابحث باسم المالك أو الملعب…">
                    <span class="owner-count" id="owner-count">0 محدّد</span>
                  </div>
                  <div class="owner-list" id="owner-list"></div>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">قنوات الإرسال</label>
                <div class="channel-row">
                  <label class="form-check">
                    <input type="checkbox" id="bc-push" checked>
                    <i data-lucide="bell"></i> إشعار فوري (Push)
                  </label>
                  <label class="form-check">
                    <input type="checkbox" id="bc-email">
                    <i data-lucide="mail"></i> بريد إلكتروني
                  </label>
                </div>
                <span class="form-help">الإشعار يصل للأجهزة المفعِّلة فقط؛ البريد يصل لكل الملّاك.</span>
              </div>

              <div class="form-actions">
                <button type="submit" class="btn btn--primary" id="bc-send">
                  <i data-lucide="send"></i> إرسال البثّ
                </button>
              </div>
            </form>
          </div>
        </div>

        <div class="page-header"><div><h2 style="font-size:var(--text-lg)">الرسائل السابقة</h2></div></div>
        <div id="bc-history"></div>
      `;
      window.utils.renderIcons(container);

      const form = container.querySelector('#broadcast-form');
      const titleEl = container.querySelector('#bc-title');
      const bodyEl = container.querySelector('#bc-body');
      const pushEl = container.querySelector('#bc-push');
      const emailEl = container.querySelector('#bc-email');
      const sendBtn = container.querySelector('#bc-send');
      const audienceLine = container.querySelector('#audience-line');
      const audienceToggle = container.querySelector('#audience-toggle');
      const picker = container.querySelector('#owner-picker');
      const ownerList = container.querySelector('#owner-list');
      const ownerSearch = container.querySelector('#owner-search');
      const ownerCount = container.querySelector('#owner-count');
      const historyBox = container.querySelector('#bc-history');

      let audience = { owners: 0, push_devices: 0 };
      let owners = [];
      const selected = new Set();

      function isSelectedMode() {
        const r = audienceToggle.querySelector('input[name="audience"]:checked');
        return r && r.value === 'selected';
      }

      function setAudienceBanner() {
        if (isSelectedMode()) {
          audienceLine.innerHTML =
            `<i data-lucide="user-check"></i><span>اخترت <strong>${selected.size}</strong> من <strong>${owners.length}</strong> مالكًا.</span>`;
        } else {
          audienceLine.innerHTML =
            `<i data-lucide="users"></i><span>سيصل إلى <strong>${audience.owners}</strong> مالكًا — منهم <strong>${audience.push_devices}</strong> جهازًا مفعِّلًا للإشعارات.</span>`;
        }
        window.utils.renderIcons(audienceLine);
      }

      function updateCount() {
        ownerCount.textContent = `${selected.size} محدّد`;
      }

      // ── الجمهور (إجمالي) ──
      window.api.adminBroadcastAudience().then((a) => {
        if (!alive) return;
        audience = a;
        if (!isSelectedMode()) setAudienceBanner();
      }).catch(() => {});

      // ── قائمة الملّاك (تُحمّل عند أول دخول لوضع التحديد) ──
      let ownersLoaded = false;
      async function ensureOwners() {
        if (ownersLoaded) return;
        ownersLoaded = true;
        ownerList.innerHTML = '<div class="loader-center"><div class="loader"></div></div>';
        try {
          owners = await window.api.adminBroadcastOwners();
          if (!alive) return;
          ownerList.innerHTML = owners.map(ownerItemHtml).join('') ||
            '<div class="owner-empty">لا يوجد ملّاك.</div>';
          window.utils.renderIcons(ownerList);
          ownerList.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
            cb.addEventListener('change', () => {
              if (cb.checked) selected.add(cb.value); else selected.delete(cb.value);
              updateCount();
              setAudienceBanner();
            });
          });
        } catch (err) {
          if (!alive) return;
          ownersLoaded = false;
          ownerList.innerHTML = `<div class="owner-empty">${window.utils.escapeHtml(window.utils.formatError(err))}</div>`;
        }
      }

      audienceToggle.addEventListener('change', () => {
        const sel = isSelectedMode();
        picker.hidden = !sel;
        if (sel) ensureOwners();
        setAudienceBanner();
      });

      ownerSearch.addEventListener('input', () => {
        const q = ownerSearch.value.trim().toLowerCase();
        ownerList.querySelectorAll('.owner-item').forEach((el) => {
          const txt = el.textContent.toLowerCase();
          el.style.display = (!q || txt.includes(q)) ? '' : 'none';
        });
      });

      // ── السجلّ ──
      async function loadHistory() {
        historyBox.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
        try {
          const list = await window.api.adminListBroadcasts();
          if (!alive) return;
          historyBox.innerHTML = renderHistory(list);
          window.utils.renderIcons(historyBox);
        } catch (err) {
          if (!alive) return;
          historyBox.innerHTML = `<div class="card"><div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert"></i></div><h3>تعذّر تحميل السجلّ</h3><p>${window.utils.escapeHtml(window.utils.formatError(err))}</p></div></div>`;
          window.utils.renderIcons(historyBox);
        }
      }

      // ── الإرسال ──
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = (titleEl.value || '').trim();
        const body = (bodyEl.value || '').trim();
        const wantPush = pushEl.checked;
        const wantEmail = emailEl.checked;
        const selectedMode = isSelectedMode();
        const recipients = selectedMode ? Array.from(selected) : null;

        if (!title || !body) { window.utils.toast('العنوان والنص مطلوبان', 'error'); return; }
        if (!wantPush && !wantEmail) { window.utils.toast('اختر قناة واحدة على الأقل', 'error'); return; }
        if (selectedMode && !recipients.length) { window.utils.toast('اختر مالكًا واحدًا على الأقل', 'error'); return; }

        const targetCount = selectedMode ? recipients.length : audience.owners;
        const chLabels = [wantPush && 'إشعار فوري', wantEmail && 'بريد إلكتروني'].filter(Boolean).join(' و');
        const ok = await window.utils.confirm({
          title: 'تأكيد البثّ',
          message: `سيُرسَل هذا إلى ${targetCount} مالكًا عبر ${chLabels}. هذا إجراء لا يمكن التراجع عنه.`,
          confirmText: 'إرسال'
        });
        if (!ok) return;

        sendBtn.disabled = true;
        sendBtn.innerHTML = '<span class="loader loader--sm"></span> جارٍ الإرسال…';
        try {
          const payload = { title, body, push: wantPush, email: wantEmail };
          if (recipients) payload.recipients = recipients;
          const res = await window.api.adminBroadcast(payload);
          if (!alive) return;
          const bits = [];
          if (wantPush) bits.push(`إشعار: ${res.push_sent}/${res.push_total}`);
          if (wantEmail) bits.push(`بريد: ${res.email_sent}/${res.email_total}`);
          window.utils.toast(`تم البثّ — ${bits.join(' · ')}`, 'success');
          form.reset();
          pushEl.checked = true;
          selected.clear();
          updateCount();
          picker.hidden = true;
          setAudienceBanner();
          await loadHistory();
        } catch (err) {
          if (!alive) return;
          window.utils.toast(window.utils.formatError(err), 'error');
        } finally {
          if (alive) {
            sendBtn.disabled = false;
            sendBtn.innerHTML = '<i data-lucide="send"></i> إرسال البثّ';
            window.utils.renderIcons(sendBtn);
          }
        }
      });

      setAudienceBanner();
      loadHistory();
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages['admin-broadcast'] = page;
})();
