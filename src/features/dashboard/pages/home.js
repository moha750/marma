// لوحة التحكم — تصميم Time-forward:
// شريط طلبات معلّقة (يظهر فقط عند الحاجة) → KPIs (إيراد/إشغال/حجوزات) →
// Timeline اليوم → Tomorrow preview → Quick links (مالك).

(function () {
  // ─── أدوات تواريخ ─────────────────────────────────────

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function endOfDay(d) {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function isoLocalDate(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  const longDateFormatter = new Intl.DateTimeFormat('ar-EG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const weekdayFormatter = new Intl.DateTimeFormat('ar-EG', { weekday: 'long' });

  // ─── أدوات صغيرة ──────────────────────────────────────

  function fmtMoney(v) { return window.utils.formatCurrency(v || 0); }

  function statusChip(status) {
    if (status === 'pending')   return '<span class="chip-status chip-status--pending">معلّق</span>';
    if (status === 'confirmed') return '<span class="chip-status chip-status--confirmed">مؤكد</span>';
    if (status === 'completed') return '<span class="chip-status chip-status--completed">مكتمل</span>';
    if (status === 'cancelled') return '<span class="chip-status chip-status--cancelled">ملغي</span>';
    return '';
  }

  function escapeName(v) { return window.utils.escapeHtml(v || '—'); }

  // ─── جلب البيانات ─────────────────────────────────────

  // اتجاه 14 يوماً لإيرادات
  async function fetchRevenueTrend() {
    try {
      const now = new Date();
      const from = addDays(startOfDay(now), -13);
      const bookings = await window.api.listBookings({
        from: from.toISOString(),
        to:   endOfDay(now).toISOString(),
        limit: 500
      });
      const byDay = {};
      for (let i = 0; i < 14; i++) {
        byDay[isoLocalDate(addDays(from, i))] = 0;
      }
      bookings.forEach((b) => {
        if (b.status === 'cancelled') return;
        const key = isoLocalDate(new Date(b.start_time));
        if (byDay[key] != null) byDay[key] += Number(b.total_price) || 0;
      });
      return Object.values(byDay);
    } catch (_) { return null; }
  }

  // الإشغال: مجموع slots محجوزة / مجموع slots متاحة عبر كل الأرضيات اليوم
  async function fetchUtilization(today) {
    try {
      const fields = window.store
        ? await window.store.get('fields:active')
        : await window.api.listFields(false);
      if (!fields.length) return null;

      const dateStr = isoLocalDate(today);
      const slotArrays = await Promise.all(
        fields.map((f) => window.api.getAvailableSlots(f.id, dateStr).catch(() => []))
      );
      let total = 0, booked = 0;
      slotArrays.forEach((slots) => {
        slots.forEach((s) => {
          total++;
          if (!s.is_available) booked++;
        });
      });
      if (total === 0) return null;
      return { total, booked, percent: Math.round((booked / total) * 100) };
    } catch (_) { return null; }
  }

  // ─── العرض ────────────────────────────────────────────

  function renderSkeletonStatCard() {
    return `
      <div class="skeleton-card">
        <div style="display:flex;gap:var(--space-2);align-items:center">
          <div class="skeleton skeleton-circle" style="width:28px;height:28px;border-radius:var(--radius-sm)"></div>
          <div class="skeleton skeleton-line" style="width:60px;height:10px"></div>
        </div>
        <div class="skeleton skeleton-line" style="width:120px;height:24px;margin-top:var(--space-2)"></div>
        <div class="skeleton skeleton-line" style="width:80%;height:8px;margin-top:var(--space-3)"></div>
      </div>
    `;
  }

  function buildTemplate(isOwner, todayLabel) {
    return `
      <div class="page-header">
        <div>
          <h2>لوحة التحكم</h2>
          <div class="page-subtitle">${todayLabel}</div>
        </div>
        <div class="actions">
          <a href="${window.utils.path('/calendar')}" class="btn btn--secondary">
            <i data-lucide="calendar"></i> التقويم
          </a>
          <button class="btn btn--primary" id="quick-booking-btn">
            <i data-lucide="plus"></i> حجز جديد
          </button>
        </div>
      </div>

      <div id="push-banner-area"></div>

      <div id="pending-banner-area"></div>

      <div id="kpi-area">
        <div class="stats-grid stats-grid--bento">
          ${renderSkeletonStatCard()}
          ${renderSkeletonStatCard()}
          ${renderSkeletonStatCard()}
        </div>
      </div>

      <div id="sparkline-area"></div>

      <div id="timeline-area"></div>

      <div id="tomorrow-area"></div>
    `;
  }

  // شريط الطلبات المعلّقة — لا يُعرض إن كانت القائمة فارغة
  function renderPendingBanner(pending) {
    if (!pending.length) return '';
    const top3 = pending.slice(0, 3);
    const rest = pending.length - top3.length;
    return `
      <div class="stat-card stat-card--warning" style="margin-bottom:var(--space-4)">
        <div class="stat-card-head">
          <span class="stat-icon-chip stat-icon-chip--warning"><i data-lucide="hourglass"></i></span>
          <span class="stat-label">${pending.length} طلب${pending.length > 1 ? 'ات' : ''} بانتظار موافقتك</span>
        </div>
        <div class="pending-inline-list">
          ${top3.map((b) => `
            <div class="pending-inline-item is-clickable" data-id="${b.id}">
              <div class="pending-inline-text">
                <div class="pending-inline-title">${escapeName(b.customers && b.customers.full_name)}</div>
                <div class="pending-inline-sub">${window.utils.formatDateTime(b.start_time)} · ${escapeName(b.fields && b.fields.name)}</div>
              </div>
            </div>
          `).join('')}
        </div>
        ${rest > 0 ? `<a class="pending-inline-more" href="${window.utils.path('/bookings')}?status=pending">+ ${rest} طلب${rest > 1 ? 'اً آخر' : ' آخر'} ←</a>` : ''}
      </div>
    `;
  }

  // KPI #1 — يُختلف بحسب الدور
  function renderHeroCard({ isOwner, stats }) {
    if (isOwner) {
      const unpaid = (stats.today_revenue || 0) - (stats.today_paid || 0);
      return `
        <div class="stat-card">
          <div class="stat-card-head">
            <span class="stat-icon-chip stat-icon-chip--accent"><i data-lucide="trending-up"></i></span>
            <span class="stat-label">إيرادات اليوم</span>
          </div>
          <div class="stat-value stat-value--lg">${fmtMoney(stats.today_revenue)}</div>
          <div class="stat-sub">
            مدفوع <span class="text-success fw-semibold">${fmtMoney(stats.today_paid)}</span>
            · غير مدفوع ${fmtMoney(unpaid)}
          </div>
        </div>
      `;
    }
    const count = stats.today_bookings || 0;
    return `
      <div class="stat-card">
        <div class="stat-card-head">
          <span class="stat-icon-chip stat-icon-chip--info"><i data-lucide="calendar-check"></i></span>
          <span class="stat-label">حجوزات اليوم</span>
        </div>
        <div class="stat-value stat-value--lg">${count}</div>
        <div class="stat-sub">${count === 0 ? 'لا توجد حجوزات اليوم بعد' : 'حجزاً مسجّلاً'}</div>
      </div>
    `;
  }

  // KPI #2 — الإشغال (مشترك للدورين)
  function renderUtilizationCard(util) {
    if (!util) {
      return `
        <div class="stat-card">
          <div class="stat-card-head">
            <span class="stat-icon-chip"><i data-lucide="gauge"></i></span>
            <span class="stat-label">الإشغال اليوم</span>
          </div>
          <div class="stat-value text-tertiary">—</div>
          <div class="stat-sub">لا توجد جداول عمل لليوم</div>
        </div>
      `;
    }
    const segs = `<span class="stat-bar-seg stat-bar-seg--success" style="width:${util.percent}%"></span>`;
    return `
      <div class="stat-card">
        <div class="stat-card-head">
          <span class="stat-icon-chip stat-icon-chip--accent"><i data-lucide="gauge"></i></span>
          <span class="stat-label">الإشغال اليوم</span>
        </div>
        <div class="stat-value">${util.percent}<span style="font-size:0.55em;color:var(--text-secondary)">%</span></div>
        <div class="stat-sub">${util.booked} من ${util.total} موعداً محجوز</div>
        <div class="stat-bar">${segs}</div>
      </div>
    `;
  }

  // KPI #3 — حجوزات اليوم مع مزيج الحالات (للمالك)، أو نظرة الأسبوع (للموظف)
  function renderThirdCard({ isOwner, stats, todayMix, weekCount }) {
    if (isOwner) {
      const total = stats.today_bookings || 0;
      const segs = [];
      const ratio = total > 0 ? 100 / total : 0;
      if (todayMix.confirmed) segs.push(`<span class="stat-bar-seg stat-bar-seg--success" style="width:${todayMix.confirmed * ratio}%"></span>`);
      if (todayMix.pending)   segs.push(`<span class="stat-bar-seg stat-bar-seg--warning" style="width:${todayMix.pending * ratio}%"></span>`);
      if (todayMix.completed) segs.push(`<span class="stat-bar-seg stat-bar-seg--muted"   style="width:${todayMix.completed * ratio}%"></span>`);
      if (todayMix.cancelled) segs.push(`<span class="stat-bar-seg stat-bar-seg--danger"  style="width:${todayMix.cancelled * ratio}%"></span>`);
      return `
        <div class="stat-card">
          <div class="stat-card-head">
            <span class="stat-icon-chip stat-icon-chip--info"><i data-lucide="calendar-check"></i></span>
            <span class="stat-label">حجوزات اليوم</span>
          </div>
          <div class="stat-value">${total}</div>
          ${total > 0 ? `
            <div class="stat-bar">${segs.join('')}</div>
            <div class="stat-legend">
              ${todayMix.confirmed ? `<span><span class="dot" style="background:var(--success)"></span>مؤكد ${todayMix.confirmed}</span>` : ''}
              ${todayMix.pending   ? `<span><span class="dot" style="background:var(--warning)"></span>معلّق ${todayMix.pending}</span>` : ''}
              ${todayMix.completed ? `<span><span class="dot" style="background:var(--border-strong)"></span>مكتمل ${todayMix.completed}</span>` : ''}
              ${todayMix.cancelled ? `<span><span class="dot" style="background:var(--danger)"></span>ملغي ${todayMix.cancelled}</span>` : ''}
            </div>
          ` : `<div class="stat-sub">لا حجوزات اليوم بعد</div>`}
        </div>
      `;
    }
    return `
      <div class="stat-card">
        <div class="stat-card-head">
          <span class="stat-icon-chip"><i data-lucide="calendar-range"></i></span>
          <span class="stat-label">هذا الأسبوع</span>
        </div>
        <div class="stat-value">${weekCount}</div>
        <div class="stat-sub">حجزاً خلال 7 أيام</div>
      </div>
    `;
  }

  function renderSparklineRow(spark) {
    if (!spark || !spark.length) return '';
    const total = spark.reduce((a, b) => a + b, 0);
    const peak = Math.max(...spark);
    return `
      <div class="card mb-md" style="padding:var(--space-4)">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:var(--space-2)">
          <div>
            <div class="text-xs text-tertiary fw-medium">آخر 14 يوماً</div>
            <div class="fw-semibold" style="font-size:var(--text-md)">${fmtMoney(total)}</div>
          </div>
          <div class="text-xs text-tertiary">ذروة يومية ${fmtMoney(peak)}</div>
        </div>
        <div id="rev-spark-big" style="height:48px"></div>
      </div>
    `;
  }

  // Timeline اليوم — قائمة الحجوزات بترتيب الوقت
  function renderTodayTimeline(todayBookings) {
    if (!todayBookings.length) {
      return `
        <div class="card mb-md">
          <div class="card-header">
            <h3>جدول اليوم</h3>
          </div>
          <div class="empty-state" style="padding:var(--space-6)">
            <div class="empty-icon"><i data-lucide="clock"></i></div>
            <p>لا توجد حجوزات لليوم بعد. شارك رابط الحجز أو أنشئ حجزاً يدوياً.</p>
          </div>
        </div>
      `;
    }
    const sorted = [...todayBookings].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    return `
      <div class="card mb-md">
        <div class="card-header">
          <h3>جدول اليوم</h3>
          <span class="card-header-meta">${sorted.length} موعداً</span>
        </div>
        <div class="timeline-list">
          ${sorted.map((b) => `
            <div class="timeline-row is-clickable" data-id="${b.id}" data-status="${b.status}">
              <div class="timeline-time">
                <span class="timeline-time-from">${window.utils.formatTime(b.start_time)}</span>
                <span class="timeline-time-sep">→</span>
                <span class="timeline-time-to">${window.utils.formatTime(b.end_time)}</span>
              </div>
              <div class="timeline-main">
                <div class="timeline-customer">${escapeName(b.customers && b.customers.full_name)}</div>
                <div class="timeline-field">${escapeName(b.fields && b.fields.name)}</div>
              </div>
              <div class="timeline-side">
                ${statusChip(b.status)}
                <span class="timeline-price">${fmtMoney(b.total_price)}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Tomorrow preview — قائمة مضغوطة لحجوزات الغد
  function renderTomorrow(tomorrowBookings, tomorrowDate) {
    const dayLabel = weekdayFormatter.format(tomorrowDate);
    if (!tomorrowBookings.length) {
      return `
        <div class="card mb-md">
          <div class="card-header">
            <h3>غداً (${dayLabel})</h3>
          </div>
          <div class="empty-state" style="padding:var(--space-5)">
            <p class="text-muted">لا حجوزات مجدولة لـ${dayLabel}.</p>
          </div>
        </div>
      `;
    }
    const sorted = [...tomorrowBookings].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    const top = sorted.slice(0, 5);
    const rest = sorted.length - top.length;
    return `
      <div class="card mb-md">
        <div class="card-header">
          <h3>غداً (${dayLabel})</h3>
          <span class="card-header-meta">${sorted.length} حجزاً</span>
        </div>
        <div class="timeline-list">
          ${top.map((b) => `
            <div class="timeline-row is-clickable timeline-row--compact" data-id="${b.id}">
              <div class="timeline-time">
                <span class="timeline-time-from">${window.utils.formatTime(b.start_time)}</span>
              </div>
              <div class="timeline-main">
                <div class="timeline-customer">${escapeName(b.customers && b.customers.full_name)}</div>
                <div class="timeline-field">${escapeName(b.fields && b.fields.name)}</div>
              </div>
              <div class="timeline-side">
                ${statusChip(b.status)}
              </div>
            </div>
          `).join('')}
        </div>
        ${rest > 0 ? `<a class="pending-inline-more" href="${window.utils.path('/bookings')}" style="padding:var(--space-2) var(--space-4)">+ ${rest} حجزاً آخر ←</a>` : ''}
      </div>
    `;
  }

  // ─── منطق الصفحة ──────────────────────────────────────

  // بانر تفعيل الإشعارات — يظهر فقط عند:
  // - التطبيق مثبّت (standalone)
  // - المتصفح يدعم Push API
  // - الإذن لم يُطلب بعد (permission === 'default')
  // - المستخدم لم يتجاهله سابقاً
  function renderPushBanner(area) {
    if (!area) return;
    if (!window.push || !window.push.isSupported()) return;
    if (!window.pwa || !window.pwa.isStandalone()) return;
    if (window.push.permission() !== 'default') return;
    try {
      if (localStorage.getItem('marma:push:dismissed') === '1') return;
    } catch (_) {}

    area.innerHTML = `
      <div class="stat-card" style="margin-bottom:var(--space-4);background:var(--accent-50);border-color:var(--accent-100)">
        <div class="stat-card-head">
          <span class="stat-icon-chip stat-icon-chip--accent"><i data-lucide="bell"></i></span>
          <span class="stat-label" style="color:var(--accent-700)">فعّل إشعارات الحجوزات</span>
        </div>
        <p class="text-sm" style="margin-top:var(--space-2);margin-bottom:var(--space-3)">
          استلم تنبيهاً فورياً على جوالك عند أي حجز جديد — حتى لو التطبيق مغلق.
        </p>
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
          <button type="button" class="btn btn--primary btn--sm" id="push-enable-btn">
            <i data-lucide="bell"></i><span>تفعيل الإشعارات</span>
          </button>
          <button type="button" class="btn btn--secondary btn--sm" id="push-dismiss-btn">لاحقاً</button>
        </div>
      </div>
    `;

    area.querySelector('#push-enable-btn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const res = await window.push.subscribe();
        if (res.ok) {
          area.innerHTML = '';
          if (window.utils) window.utils.toast('تم تفعيل الإشعارات', 'success');
        } else if (res.reason === 'denied') {
          if (window.utils) window.utils.toast('رُفض الإذن — يمكن تفعيله من إعدادات المتصفح', 'warning');
          area.innerHTML = '';
        } else {
          if (window.utils) window.utils.toast('تعذّر تفعيل الإشعارات', 'error');
        }
      } finally {
        btn.disabled = false;
      }
    });

    area.querySelector('#push-dismiss-btn').addEventListener('click', () => {
      try { localStorage.setItem('marma:push:dismissed', '1'); } catch (_) {}
      area.innerHTML = '';
    });

    if (window.utils) window.utils.renderIcons(area);
  }

  function todayBookingsMix(todayBookings) {
    const mix = { confirmed: 0, pending: 0, completed: 0, cancelled: 0 };
    todayBookings.forEach((b) => {
      if (mix[b.status] != null) mix[b.status]++;
    });
    return mix;
  }

  const page = {
    async mount(container, ctx) {
      const isOwner = ctx.profile.role === 'owner';
      const today = new Date();
      const todayLabel = longDateFormatter.format(today);
      container.innerHTML = buildTemplate(isOwner, todayLabel);

      const pushBannerArea = container.querySelector('#push-banner-area');
      const pendingArea  = container.querySelector('#pending-banner-area');

      // ─── بانر تفعيل الإشعارات ─────────────────────────
      renderPushBanner(pushBannerArea);
      const kpiArea      = container.querySelector('#kpi-area');
      const sparkArea    = container.querySelector('#sparkline-area');
      const timelineArea = container.querySelector('#timeline-area');
      const tomorrowArea = container.querySelector('#tomorrow-area');
      const quickBtn     = container.querySelector('#quick-booking-btn');

      const cleanup = [];
      let alive = true;
      page._cleanup = cleanup;

      async function refresh() {
        if (!alive) return;
        try {
          const todayStart = startOfDay(today).toISOString();
          const todayEnd   = endOfDay(today).toISOString();
          const tomorrow = addDays(today, 1);
          const tomorrowStart = startOfDay(tomorrow).toISOString();
          const tomorrowEnd   = endOfDay(tomorrow).toISOString();
          const weekStart = todayStart;
          const weekEnd   = endOfDay(addDays(today, 6)).toISOString();

          const [stats, todayBookings, tomorrowBookings, weekBookings, pending, spark, util] = await Promise.all([
            window.api.getDashboardStats(),
            window.api.listBookings({ from: todayStart, to: todayEnd, limit: 200 }),
            window.api.listBookings({ from: tomorrowStart, to: tomorrowEnd, limit: 200 }),
            isOwner ? Promise.resolve([]) : window.api.listBookings({ from: weekStart, to: weekEnd, limit: 200 }),
            window.api.listPendingBookings(),
            isOwner ? fetchRevenueTrend() : Promise.resolve(null),
            fetchUtilization(today)
          ]);
          if (!alive) return;

          const mix = todayBookingsMix(todayBookings);
          const hasSpark = spark && spark.length >= 2 && spark.some((v) => v > 0);

          // ── 1) شريط الطلبات المعلّقة (يختفي عند صفر)
          pendingArea.innerHTML = renderPendingBanner(pending);

          // ── 2) KPIs الرئيسية
          kpiArea.innerHTML = `
            <div class="stats-grid stats-grid--bento">
              ${renderHeroCard({ isOwner, stats })}
              ${renderUtilizationCard(util)}
              ${renderThirdCard({ isOwner, stats, todayMix: mix, weekCount: weekBookings.length })}
            </div>
          `;

          // ── 3) Sparkline كبير (مالك فقط، يُخفى عند انعدام البيانات)
          sparkArea.innerHTML = (isOwner && hasSpark) ? renderSparklineRow(spark) : '';
          if (isOwner && hasSpark) {
            const big = sparkArea.querySelector('#rev-spark-big');
            if (big) window.charts.sparkline({ container: big, data: spark, fill: true, height: 48, strokeWidth: 2 });
          }

          // ── 4) Timeline اليوم
          timelineArea.innerHTML = renderTodayTimeline(todayBookings);

          // ── 5) غداً
          tomorrowArea.innerHTML = renderTomorrow(tomorrowBookings, tomorrow);

          // ── ربط الأفعال ──────────────────────────────

          // Pending: نقر الصف يفتح المودال (الموافقة/الرفض من footer المودال)
          pendingArea.querySelectorAll('.pending-inline-item').forEach((row) => {
            row.addEventListener('click', () => {
              const b = pending.find((x) => x.id === row.dataset.id);
              if (b) window.bookingModal.open({ booking: b, onSaved: refresh });
            });
          });

          // Timeline اليوم — نقر على الصف يفتح مودال التعديل
          timelineArea.querySelectorAll('.timeline-row[data-id]').forEach((row) => {
            row.addEventListener('click', () => {
              const b = todayBookings.find((x) => x.id === row.dataset.id);
              if (b) window.bookingModal.open({ booking: b, onSaved: refresh });
            });
          });

          // Tomorrow — نقر على الصف يفتح مودال التعديل
          tomorrowArea.querySelectorAll('.timeline-row[data-id]').forEach((row) => {
            row.addEventListener('click', () => {
              const b = tomorrowBookings.find((x) => x.id === row.dataset.id);
              if (b) window.bookingModal.open({ booking: b, onSaved: refresh });
            });
          });

          window.utils.renderIcons(container);
        } catch (err) {
          if (!alive) return;
          kpiArea.innerHTML = `
            <div class="card">
              <div class="empty-state">
                <div class="empty-icon"><i data-lucide="triangle-alert"></i></div>
                <h3>تعذّر تحميل البيانات</h3>
                <p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p>
                <button class="btn btn--primary" id="retry-btn">إعادة المحاولة</button>
              </div>
            </div>
          `;
          const r = kpiArea.querySelector('#retry-btn');
          if (r) r.addEventListener('click', refresh);
          window.utils.renderIcons(container);
        }
      }

      const onQuickClick = () => window.bookingModal.open({ onSaved: refresh });
      quickBtn.addEventListener('click', onQuickClick);
      cleanup.push(() => quickBtn.removeEventListener('click', onQuickClick));

      if (window.realtime) {
        const debounced = window.utils.debounce(refresh, 400);
        const off = window.realtime.on('bookings:change', debounced);
        cleanup.push(off);
      }

      page._refresh = refresh;
      refresh();
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
      page._refresh = null;
    }
  };

  window.pages = window.pages || {};
  window.pages.dashboard = page;
})();
