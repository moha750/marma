// إشعارات داخل التطبيق — جرس الترويسة + مركز عدّ مشترك (لشارة تبويب القائمة أيضًا).
// المصدر: RPCs (list_notifications / unread_notifications_count / mark_*). تحديث لحظي عبر realtime.
window.notificationBell = (function () {
  function withBase(p) { return (window.__BASE__ || '') + p; }
  const esc = (s) => window.utils.escapeHtml(s == null ? '' : String(s));

  // أيقونة لكل نوع إشعار
  const ICONS = {
    booking_new: 'calendar-plus',
    booking_cancelled: 'calendar-x',
    subscription_request: 'credit-card',
    subscription_approved: 'badge-check',
    subscription_rejected: 'circle-x',
    account_suspended: 'ban',
    account_unsuspended: 'circle-check',
    lifetime_granted: 'gem',
    trial_extended: 'hourglass',
    staff_joined: 'user-plus',
    tenant_new: 'store',
    broadcast: 'megaphone'
  };
  function iconFor(type) { return ICONS[type] || 'bell'; }

  function timeAgo(iso) {
    const then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (s < 60) return 'الآن';
    const m = Math.floor(s / 60);
    if (m < 60) return `قبل ${m} ${m === 1 ? 'دقيقة' : (m === 2 ? 'دقيقتين' : (m <= 10 ? 'دقائق' : 'دقيقة'))}`;
    const h = Math.floor(m / 60);
    if (h < 24) return `قبل ${h} ${h === 1 ? 'ساعة' : (h === 2 ? 'ساعتين' : (h <= 10 ? 'ساعات' : 'ساعة'))}`;
    const d = Math.floor(h / 24);
    if (d < 30) return `قبل ${d} ${d === 1 ? 'يوم' : (d === 2 ? 'يومين' : (d <= 10 ? 'أيام' : 'يومًا'))}`;
    try { return window.utils.formatDate(iso); } catch (_) { return ''; }
  }

  // ─── مركز عدّ غير المقروء (مشترك بين الجرس وشارة التبويب) ───
  const badgeTargets = new Set(); // عناصر <span> شارة يُحدَّث نصها/إخفاؤها
  let lastCount = 0;
  let realtimeBound = false;

  function paint(el) {
    if (lastCount > 0) { el.textContent = lastCount > 9 ? '9+' : String(lastCount); el.hidden = false; }
    else { el.textContent = ''; el.hidden = true; }
  }
  function paintAll() { badgeTargets.forEach(paint); }

  async function refreshCount() {
    try {
      const { data, error } = await window.sb.rpc('unread_notifications_count');
      if (error) throw error;
      lastCount = Number(data) || 0;
    } catch (_) { return; }
    paintAll();
  }

  function ensureRealtime() {
    if (realtimeBound || !window.realtime) return;
    realtimeBound = true;
    window.realtime.on('notifications:change', window.utils.debounce(refreshCount, 300));
  }

  // يربط عنصر شارة (الجرس) بمركز العدّ. يعيد دالة فكّ ارتباط.
  function bindBadge(el) {
    if (!el) return function () {};
    badgeTargets.add(el);
    paint(el);
    ensureRealtime();
    refreshCount();
    return function () { badgeTargets.delete(el); };
  }

  // ─── شارات "طابور العمل" على تبويبات الشريط (حالة معلّقة فعلية) ───
  // منفصلة تمامًا عن الجرس: تعكس عملًا لم يُنجَز بعد (حجوزات/طلبات pending)،
  // وتُصفّى عند إنجاز العمل لا عند قراءة الإشعار.
  // sources: [{ link, event, count }] حيث count دالة async تعيد عددًا.
  function bindPendingBadges(navEl, sources) {
    if (!Array.isArray(sources)) return;
    function paintTab(link, n) {
      // نطلي كل الشارات المطابقة (الشريط الجانبي + الـ bottom-nav على الجوال)
      document.querySelectorAll('[data-notif-link="' + link + '"]').forEach((el) => {
        if (n > 0) { el.textContent = n > 9 ? '9+' : String(n); el.hidden = false; }
        else { el.textContent = ''; el.hidden = true; }
      });
    }
    sources.forEach((s) => {
      const refresh = async () => {
        let n = 0;
        try { n = await s.count(); } catch (_) { return; }
        paintTab(s.link, n);
      };
      refresh();
      if (window.realtime && s.event) {
        window.realtime.on(s.event, window.utils.debounce(refresh, 300));
      }
    });
  }

  // ─── الجرس (قائمة منسدلة) — نمط الترويسة أو الشريط الجانبي ───
  function mount(slot, opts) {
    if (!slot) return function () {};
    opts = opts || {};
    const sidebar = opts.variant === 'sidebar';
    let items = [];
    let open = false;
    let loading = false;

    const btnHtml = sidebar
      ? '<button type="button" class="sidebar-notif-btn" id="notif-btn" aria-label="الإشعارات" aria-haspopup="true" aria-expanded="false">'
        + '  <span class="nav-icon"><i data-lucide="bell"></i></span>'
        + '  <span class="nav-label">الإشعارات</span>'
        + '  <span class="nav-notif-badge" id="notif-badge" hidden></span>'
        + '</button>'
      : '<button type="button" class="notif-bell-btn" id="notif-btn" aria-label="الإشعارات" aria-haspopup="true" aria-expanded="false">'
        + '  <i data-lucide="bell"></i>'
        + '  <span class="notif-badge" id="notif-badge" hidden></span>'
        + '</button>';

    slot.innerHTML = ''
      + '<div class="notif-bell' + (sidebar ? ' notif-bell--sidebar' : '') + '">'
      + btnHtml
      + '  <div class="notif-panel' + (sidebar ? ' notif-panel--fixed' : '') + '" id="notif-panel" role="menu" hidden>'
      + '    <div class="notif-panel-head">'
      + '      <span class="notif-panel-title">الإشعارات</span>'
      + '      <button type="button" class="notif-markall" id="notif-markall">تعليم الكل كمقروء</button>'
      + '    </div>'
      + '    <div class="notif-list" id="notif-list"></div>'
      + '  </div>'
      + '</div>';
    window.utils.renderIcons(slot);

    const btn = slot.querySelector('#notif-btn');
    const panel = slot.querySelector('#notif-panel');
    const listEl = slot.querySelector('#notif-list');
    const markAllBtn = slot.querySelector('#notif-markall');
    const unbindBadge = bindBadge(slot.querySelector('#notif-badge'));

    // في نمط الشريط: القائمة fixed وتُموضَع بجانب الزر (تفادي قصّ overflow الشريط)
    function positionPanel() {
      if (!sidebar) return;
      const r = btn.getBoundingClientRect();
      const maxH = 520;
      let top = Math.min(r.top, window.innerHeight - maxH - 12);
      top = Math.max(12, top);
      panel.style.top = top + 'px';
      panel.style.insetInlineEnd = (window.innerWidth - r.left + 8) + 'px';
      panel.style.insetInlineStart = 'auto';
    }

    function renderList() {
      if (!items.length) {
        listEl.innerHTML = '<div class="notif-empty"><i data-lucide="bell-off"></i><p>لا توجد إشعارات</p></div>';
        window.utils.renderIcons(listEl);
        return;
      }
      listEl.innerHTML = items.map((n) => {
        const unread = !n.is_read;
        const body = n.body ? `<span class="notif-item-body">${esc(n.body)}</span>` : '';
        return ''
          + `<a class="notif-item${unread ? ' is-unread' : ''}" data-id="${esc(n.id)}" href="${esc(withBase(n.link || '/dashboard'))}" role="menuitem">`
          + `  <span class="notif-item-icon"><i data-lucide="${iconFor(n.type)}"></i></span>`
          + '  <span class="notif-item-main">'
          + `    <span class="notif-item-title">${esc(n.title)}</span>`
          + body
          + `    <span class="notif-item-time">${esc(timeAgo(n.created_at))}</span>`
          + '  </span>'
          + (unread ? '<span class="notif-dot" aria-hidden="true"></span>' : '')
          + '</a>';
      }).join('');
      window.utils.renderIcons(listEl);
      listEl.querySelectorAll('.notif-item').forEach((el) => {
        el.addEventListener('click', async (e) => {
          e.preventDefault();
          const id = el.dataset.id;
          const link = el.getAttribute('href');
          try { await window.sb.rpc('mark_notification_read', { p_id: id }); } catch (_) {}
          refreshCount();
          if (link) window.location.href = link; else closePanel();
        });
      });
    }

    async function loadList() {
      if (loading) return;
      loading = true;
      listEl.innerHTML = '<div class="notif-loading"><div class="loader"></div></div>';
      try {
        const { data, error } = await window.sb.rpc('list_notifications', { p_limit: 20 });
        if (error) throw error;
        items = data || [];
        renderList();
      } catch (err) {
        listEl.innerHTML = `<div class="notif-empty"><p>${esc(window.utils.formatError(err))}</p></div>`;
      } finally {
        loading = false;
      }
    }

    function openPanel() { open = true; panel.hidden = false; btn.setAttribute('aria-expanded', 'true'); positionPanel(); loadList(); }
    function closePanel() { open = false; panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    function toggle() { open ? closePanel() : openPanel(); }

    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    panel.addEventListener('click', (e) => e.stopPropagation());

    markAllBtn.addEventListener('click', async () => {
      try {
        await window.sb.rpc('mark_all_notifications_read');
        items.forEach((n) => { n.is_read = true; });
        renderList();
        refreshCount();
      } catch (err) {
        window.utils.toast(window.utils.formatError(err), 'error');
      }
    });

    const onDocClick = () => { if (open) closePanel(); };
    const onKey = (e) => { if (e.key === 'Escape' && open) closePanel(); };
    const onReposition = () => { if (open && sidebar) positionPanel(); };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);

    let offRealtime = function () {};
    if (window.realtime) {
      offRealtime = window.realtime.on('notifications:change', window.utils.debounce(() => {
        if (open) loadList();
      }, 300));
    }

    return function cleanup() {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
      offRealtime();
      unbindBadge();
    };
  }

  return { mount, bindBadge, bindPendingBadges, refreshCount, iconFor, timeAgo };
})();
