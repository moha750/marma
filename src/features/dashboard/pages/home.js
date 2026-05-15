// لوحة التحكم — تخطيط Bento، إجراءات معلّقة inline، sparkline اختياري للإيرادات،
// donut لمزيج حالات اليوم، جدول حجوزات حديث.

(function () {
  function buildTemplate(isOwner) {
    return `
      <div class="page-header">
        <div>
          <h2>لوحة التحكم</h2>
          <div class="page-subtitle">نظرة عامة على عمل اليوم</div>
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

      <div id="bento-area">
        <div class="stats-grid stats-grid--bento">
          ${renderSkeletonStatCard()}
          ${renderSkeletonStatCard()}
          ${renderSkeletonStatCard()}
        </div>
      </div>

      ${isOwner ? '<div id="secondary-stats"></div>' : ''}

      <div id="status-mix-area"></div>

      <div class="card mt-md">
        <div class="card-header">
          <h3>آخر الحجوزات</h3>
          <a href="${window.utils.path('/bookings')}" class="text-muted text-sm">عرض الكل ←</a>
        </div>
        <div id="recent-bookings">
          <div class="loader-center" style="padding: var(--space-8); min-height: auto"><div class="loader"></div></div>
        </div>
      </div>
    `;
  }

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

  function statusChip(status) {
    if (status === 'pending')   return '<span class="chip-status chip-status--pending">معلّق</span>';
    if (status === 'confirmed') return '<span class="chip-status chip-status--confirmed">مؤكد</span>';
    if (status === 'completed') return '<span class="chip-status chip-status--completed">مكتمل</span>';
    if (status === 'cancelled') return '<span class="chip-status chip-status--cancelled">ملغي</span>';
    return `<span class="chip-status chip-status--muted">${window.utils.escapeHtml(status)}</span>`;
  }

  function fmtMoney(v) {
    return window.utils.formatCurrency(v || 0);
  }

  // ─── سحب تاريخ ١٤ يوماً لـ sparkline (إذا أمكن) ───────
  async function fetchRevenueTrend() {
    try {
      const now = new Date();
      const from = new Date(now);
      from.setDate(from.getDate() - 13);
      from.setHours(0, 0, 0, 0);

      const bookings = await window.api.listBookings({
        from: from.toISOString(),
        to:   new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString(),
        limit: 500
      });

      // جمّع حسب اليوم
      const byDay = {};
      for (let i = 0; i < 14; i++) {
        const d = new Date(from);
        d.setDate(from.getDate() + i);
        const key = d.toISOString().slice(0, 10);
        byDay[key] = 0;
      }
      bookings.forEach((b) => {
        if (b.status === 'cancelled') return;
        const key = new Date(b.start_time).toISOString().slice(0, 10);
        if (byDay[key] != null) byDay[key] += Number(b.total_price) || 0;
      });

      return Object.values(byDay);
    } catch (_) {
      return null;
    }
  }

  function todayBookingsStatusMix(latest) {
    // مزيج حالات حجوزات اليوم — يُحسب من قائمة latest المحدودة (آخر 5).
    // ليس مثالياً لكنه يعكس الواقع القريب.
    const today = new Date().toISOString().slice(0, 10);
    const byStatus = { confirmed: 0, pending: 0, cancelled: 0, completed: 0 };
    latest.forEach((b) => {
      const day = new Date(b.start_time).toISOString().slice(0, 10);
      if (day === today && byStatus[b.status] != null) byStatus[b.status]++;
    });
    return byStatus;
  }

  // ─── البطاقات ─────────────────────────────────────────

  function renderHeroRevenueCard(stats, hasSpark) {
    return `
      <div class="stat-card">
        <div class="stat-card-head">
          <span class="stat-icon-chip stat-icon-chip--accent"><i data-lucide="trending-up"></i></span>
          <span class="stat-label">إيرادات اليوم</span>
        </div>
        <div class="stat-value stat-value--lg">${fmtMoney(stats.today_revenue || 0)}</div>
        <div class="stat-sub">
          مدفوع <span class="text-success fw-semibold">${fmtMoney(stats.today_paid || 0)}</span>
          · غير مدفوع ${fmtMoney((stats.today_revenue || 0) - (stats.today_paid || 0))}
        </div>
        ${hasSpark ? '<div class="stat-spark" id="rev-spark"></div>' : ''}
      </div>
    `;
  }

  function renderTodayBookingsCard(stats, mix) {
    const total = stats.today_bookings || 0;
    const segs = [];
    if (mix.confirmed) segs.push(`<span class="stat-bar-seg stat-bar-seg--success" style="width:${(mix.confirmed/Math.max(total,1))*100}%"></span>`);
    if (mix.pending)   segs.push(`<span class="stat-bar-seg stat-bar-seg--warning" style="width:${(mix.pending/Math.max(total,1))*100}%"></span>`);
    if (mix.cancelled) segs.push(`<span class="stat-bar-seg stat-bar-seg--danger"  style="width:${(mix.cancelled/Math.max(total,1))*100}%"></span>`);
    return `
      <div class="stat-card">
        <div class="stat-card-head">
          <span class="stat-icon-chip stat-icon-chip--info"><i data-lucide="calendar-check"></i></span>
          <span class="stat-label">حجوزات اليوم</span>
        </div>
        <div class="stat-value">${total}</div>
        <div class="stat-bar">${segs.join('')}</div>
        <div class="stat-legend">
          <span><span class="dot" style="background:var(--success)"></span>مؤكد ${mix.confirmed || 0}</span>
          <span><span class="dot" style="background:var(--warning)"></span>معلّق ${mix.pending || 0}</span>
          ${mix.cancelled ? `<span><span class="dot" style="background:var(--danger)"></span>ملغي ${mix.cancelled}</span>` : ''}
        </div>
      </div>
    `;
  }

  function renderPendingCard(pending) {
    if (!pending.length) {
      return `
        <div class="stat-card">
          <div class="stat-card-head">
            <span class="stat-icon-chip"><i data-lucide="check"></i></span>
            <span class="stat-label">بانتظار الموافقة</span>
          </div>
          <div class="stat-value">0</div>
          <div class="stat-sub">لا توجد طلبات معلّقة</div>
        </div>
      `;
    }
    const top3 = pending.slice(0, 3);
    const rest = pending.length - top3.length;
    return `
      <div class="stat-card stat-card--warning">
        <div class="stat-card-head">
          <span class="stat-icon-chip stat-icon-chip--warning"><i data-lucide="hourglass"></i></span>
          <span class="stat-label">بانتظار موافقتك</span>
        </div>
        <div class="stat-value">${pending.length}</div>
        <div class="pending-inline-list">
          ${top3.map((b) => `
            <div class="pending-inline-item" data-id="${b.id}">
              <div class="pending-inline-text">
                <div class="pending-inline-title">${window.utils.escapeHtml(b.customers ? b.customers.full_name : '—')}</div>
                <div class="pending-inline-sub">${window.utils.formatDateTime(b.start_time)} · ${window.utils.escapeHtml(b.fields ? b.fields.name : '')}</div>
              </div>
              <div class="pending-inline-actions">
                <button class="btn btn--xs btn--accent-quiet" data-action="approve" data-id="${b.id}" title="موافقة">
                  <i data-lucide="check"></i>
                </button>
                <button class="btn btn--xs btn--danger-quiet" data-action="reject" data-id="${b.id}" title="رفض">
                  <i data-lucide="x"></i>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
        ${rest > 0 ? `<a class="pending-inline-more" href="${window.utils.path('/bookings')}?status=pending">+ ${rest} طلب آخر ←</a>` : ''}
      </div>
    `;
  }

  function renderSecondaryStats(stats, isOwner) {
    if (!isOwner) return '';
    return `
      <div class="stats-grid mt-md">
        <div class="stat-card">
          <div class="stat-card-head">
            <span class="stat-icon-chip"><i data-lucide="banknote"></i></span>
            <span class="stat-label">إيرادات الشهر</span>
          </div>
          <div class="stat-value">${fmtMoney(stats.month_revenue || 0)}</div>
          <div class="stat-sub">مدفوع ${fmtMoney(stats.month_paid || 0)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-head">
            <span class="stat-icon-chip"><i data-lucide="users"></i></span>
            <span class="stat-label">إجمالي العملاء</span>
          </div>
          <div class="stat-value">${stats.customers_count || 0}</div>
          <div class="stat-sub"><a href="${window.utils.path('/customers')}">إدارة العملاء →</a></div>
        </div>
        <div class="stat-card">
          <div class="stat-card-head">
            <span class="stat-icon-chip"><i data-lucide="goal"></i></span>
            <span class="stat-label">الأرضيات</span>
          </div>
          <div class="stat-value">${stats.fields_count || 0}</div>
          <div class="stat-sub"><a href="${window.utils.path('/fields')}">إدارة الأرضيات →</a></div>
        </div>
      </div>
    `;
  }

  function renderRecentBookingsTable(latest, onRowClick) {
    if (!latest.length) {
      return `
        <div class="empty-state">
          <div class="empty-icon"><i data-lucide="calendar-x"></i></div>
          <h3>لا توجد حجوزات حتى الآن</h3>
          <p>ابدأ بإنشاء أول حجز يدوي أو شارك رابط الحجز العام مع عملائك.</p>
          <button class="btn btn--primary" id="empty-add-btn"><i data-lucide="plus"></i> إنشاء أول حجز</button>
        </div>
      `;
    }
    return `
      <div class="table-wrapper" style="box-shadow:none;border-radius:0">
        <table class="table table--sticky-first">
          <thead>
            <tr>
              <th>التاريخ والوقت</th>
              <th>الأرضية</th>
              <th>العميل</th>
              <th>السعر</th>
              <th>الحالة</th>
              <th class="actions-cell"></th>
            </tr>
          </thead>
          <tbody>
            ${latest.map((b) => `
              <tr class="is-clickable" data-id="${b.id}" data-status="${window.utils.escapeHtml(b.status)}">
                <td>${window.utils.formatDateTime(b.start_time)}</td>
                <td>${window.utils.escapeHtml(b.fields ? b.fields.name : '—')}</td>
                <td>
                  <div>${window.utils.escapeHtml(b.customers ? b.customers.full_name : '—')}</div>
                  ${b.customers && b.customers.phone ? `<div class="text-xs text-tertiary">${window.utils.escapeHtml(b.customers.phone)}</div>` : ''}
                </td>
                <td>${fmtMoney(b.total_price)}</td>
                <td>${statusChip(b.status)}</td>
                <td class="actions-cell">
                  <div class="actions-inline">
                    <button class="btn btn--xs btn--ghost" data-action="edit" data-id="${b.id}" title="تعديل">
                      <i data-lucide="pencil"></i>
                    </button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ─── الصفحة ───────────────────────────────────────────

  const page = {
    async mount(container, ctx) {
      const isOwner = ctx.profile.role === 'owner';
      container.innerHTML = buildTemplate(isOwner);

      const bento         = container.querySelector('#bento-area');
      const secondary     = container.querySelector('#secondary-stats');
      const statusMix     = container.querySelector('#status-mix-area');
      const recentArea    = container.querySelector('#recent-bookings');
      const quickBtn      = container.querySelector('#quick-booking-btn');

      const cleanup = [];
      let alive = true;
      page._cleanup = cleanup;

      async function refresh() {
        if (!alive) return;
        try {
          const [stats, latest, pending, spark] = await Promise.all([
            window.api.getDashboardStats(),
            window.api.listBookings({ limit: 10 }),
            window.api.listPendingBookings(),
            isOwner ? fetchRevenueTrend() : Promise.resolve(null)
          ]);
          if (!alive) return;

          const mix = todayBookingsStatusMix(latest);
          const hasSpark = spark && spark.length >= 2 && spark.some((v) => v > 0);

          const heroCard = isOwner
            ? renderHeroRevenueCard(stats, hasSpark)
            : renderTodayBookingsCard(stats, mix);

          bento.innerHTML = `
            <div class="stats-grid stats-grid--bento">
              ${heroCard}
              ${isOwner ? renderTodayBookingsCard(stats, mix) : ''}
              ${renderPendingCard(pending)}
            </div>
          `;

          if (isOwner && hasSpark) {
            const sparkEl = bento.querySelector('#rev-spark');
            if (sparkEl) window.charts.sparkline({ container: sparkEl, data: spark, fill: true });
          }

          if (secondary) {
            secondary.innerHTML = renderSecondaryStats(stats, isOwner);
          }

          recentArea.innerHTML = renderRecentBookingsTable(latest.slice(0, 5));

          // ربط الأفعال
          recentArea.querySelectorAll('tr[data-id]').forEach((tr) => {
            tr.addEventListener('click', () => {
              const booking = latest.find((b) => b.id === tr.dataset.id);
              window.bookingModal.open({ booking, onSaved: refresh });
            });
          });

          bento.querySelectorAll('.pending-inline-item').forEach((row) => {
            const reviewBtn = row.querySelector('[data-action]');
            row.querySelector('.pending-inline-text').addEventListener('click', () => {
              const booking = pending.find((b) => b.id === row.dataset.id);
              if (booking) window.bookingModal.open({ booking, onSaved: refresh });
            });
          });

          bento.querySelectorAll('[data-action="approve"]').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
              e.stopPropagation();
              btn.disabled = true;
              try {
                await window.api.approveBooking(btn.dataset.id);
                window.utils.toast('تم تأكيد الحجز', 'success');
                refresh();
              } catch (err) {
                btn.disabled = false;
                window.utils.toast(window.utils.formatError(err), 'error');
              }
            });
          });

          bento.querySelectorAll('[data-action="reject"]').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
              e.stopPropagation();
              if (!confirm('تأكيد رفض الحجز؟')) return;
              btn.disabled = true;
              try {
                await window.api.rejectBooking(btn.dataset.id);
                window.utils.toast('تم رفض الحجز', 'success');
                refresh();
              } catch (err) {
                btn.disabled = false;
                window.utils.toast(window.utils.formatError(err), 'error');
              }
            });
          });

          const emptyBtn = recentArea.querySelector('#empty-add-btn');
          if (emptyBtn) emptyBtn.addEventListener('click', () => window.bookingModal.open({ onSaved: refresh }));

          window.utils.renderIcons(container);
        } catch (err) {
          if (!alive) return;
          bento.innerHTML = `
            <div class="card">
              <div class="empty-state">
                <div class="empty-icon"><i data-lucide="triangle-alert"></i></div>
                <h3>تعذّر تحميل البيانات</h3>
                <p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p>
                <button class="btn btn--primary" id="retry-btn">إعادة المحاولة</button>
              </div>
            </div>
          `;
          const r = bento.querySelector('#retry-btn');
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
