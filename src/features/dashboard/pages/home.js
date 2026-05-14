// لوحة التحكم - SPA page module
// window.pages.dashboard.mount(container, ctx) — يستدعيها الراوتر

(function () {
  const TEMPLATE = `
    <div class="page-header">
      <h2>لوحة التحكم</h2>
      <div class="actions">
        <a href="/calendar" class="btn btn--secondary">عرض التقويم</a>
        <button class="btn btn--primary" id="quick-booking-btn">+ حجز جديد</button>
      </div>
    </div>

    <div id="stats-area">
      <div class="loader-center"><div class="loader loader--lg"></div></div>
    </div>

    <div id="pending-section" class="hidden"></div>

    <div class="card mt-md">
      <div class="card-header">
        <span>آخر 5 حجوزات</span>
        <a href="/bookings" class="text-muted" style="font-size:0.9rem">عرض الكل ←</a>
      </div>
      <div id="recent-bookings">
        <div class="loader-center"><div class="loader"></div></div>
      </div>
    </div>
  `;

  function renderStatusBadge(status) {
    if (status === 'pending') return '<span class="badge badge--warning">بانتظار الموافقة</span>';
    if (status === 'confirmed') return '<span class="badge badge--success">مؤكد</span>';
    if (status === 'completed') return '<span class="badge badge--info">مكتمل</span>';
    if (status === 'cancelled') return '<span class="badge badge--danger">ملغي</span>';
    return `<span class="badge badge--muted">${window.utils.escapeHtml(status)}</span>`;
  }

  const page = {
    async mount(container, ctx) {
      container.innerHTML = TEMPLATE;
      const isOwner = ctx.profile.role === 'owner';

      const statsArea = container.querySelector('#stats-area');
      const pendingSection = container.querySelector('#pending-section');
      const recentBookings = container.querySelector('#recent-bookings');
      const quickBookingBtn = container.querySelector('#quick-booking-btn');

      const cleanup = [];
      let alive = true;
      page._cleanup = cleanup;
      page._alive = () => alive;

      async function refresh() {
        if (!alive) return;
        try {
          const [stats, latest, pending] = await Promise.all([
            window.api.getDashboardStats(),
            window.api.listBookings({ limit: 5 }),
            window.api.listPendingBookings()
          ]);
          if (!alive) return;

          const pendingCount = pending.length;
          const revenueCards = isOwner ? `
            <div class="stat-card">
              <div class="stat-label">إيرادات اليوم</div>
              <div class="stat-value">${window.utils.formatCurrency(stats.today_revenue || 0)}</div>
              <div class="stat-sub">مدفوع: ${window.utils.formatCurrency(stats.today_paid || 0)}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">إيرادات الشهر</div>
              <div class="stat-value">${window.utils.formatCurrency(stats.month_revenue || 0)}</div>
              <div class="stat-sub">مدفوع: ${window.utils.formatCurrency(stats.month_paid || 0)}</div>
            </div>
          ` : '';

          statsArea.innerHTML = `
            <div class="stats-grid">
              <div class="stat-card${pendingCount > 0 ? ' stat-card--warning' : ''}">
                <div class="stat-label">بانتظار الموافقة</div>
                <div class="stat-value">${pendingCount}</div>
                <div class="stat-sub">${pendingCount > 0 ? 'تحتاج مراجعتك' : 'لا توجد طلبات معلّقة'}</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">حجوزات اليوم</div>
                <div class="stat-value">${stats.today_bookings || 0}</div>
                <div class="stat-sub">من ${stats.fields_count || 0} أرضية</div>
              </div>
              ${revenueCards}
              <div class="stat-card">
                <div class="stat-label">إجمالي العملاء</div>
                <div class="stat-value">${stats.customers_count || 0}</div>
                <div class="stat-sub"><a href="/customers">إدارة العملاء →</a></div>
              </div>
            </div>
          `;

          renderPendingSection(pending);

          if (!latest.length) {
            recentBookings.innerHTML = `
              <div class="empty-state">
                <p>لا توجد حجوزات حتى الآن</p>
                <button class="btn btn--primary mt-md" id="empty-add-btn">+ إنشاء أول حجز</button>
              </div>
            `;
            const btn = recentBookings.querySelector('#empty-add-btn');
            if (btn) btn.addEventListener('click', () => window.bookingModal.open({ onSaved: refresh }));
          } else {
            recentBookings.innerHTML = `
              <div class="table-wrapper" style="border:0;border-radius:0">
                <table class="table">
                  <thead>
                    <tr>
                      <th>التاريخ والوقت</th>
                      <th>الأرضية</th>
                      <th>العميل</th>
                      <th>السعر</th>
                      <th>الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${latest.map((b) => `
                      <tr style="cursor:pointer" data-id="${b.id}">
                        <td>${window.utils.formatDateTime(b.start_time)}</td>
                        <td>${window.utils.escapeHtml(b.fields ? b.fields.name : '—')}</td>
                        <td>${window.utils.escapeHtml(b.customers ? b.customers.full_name : '—')}</td>
                        <td>${window.utils.formatCurrency(b.total_price)}</td>
                        <td>${renderStatusBadge(b.status)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `;
            recentBookings.querySelectorAll('tr[data-id]').forEach((tr) => {
              tr.addEventListener('click', () => {
                const booking = latest.find((b) => b.id === tr.dataset.id);
                window.bookingModal.open({ booking, onSaved: refresh });
              });
            });
          }

          window.utils.renderIcons(container);
        } catch (err) {
          if (!alive) return;
          statsArea.innerHTML = `<div class="card"><div class="empty-state"><p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p></div></div>`;
        }
      }

      function renderPendingSection(pending) {
        if (!pending.length) {
          pendingSection.classList.add('hidden');
          pendingSection.innerHTML = '';
          return;
        }
        pendingSection.classList.remove('hidden');
        pendingSection.innerHTML = `
          <div class="card mt-md" style="border-color:var(--color-warning);box-shadow:0 0 0 1px var(--color-warning)">
            <div class="card-header" style="background:var(--color-warning-light);color:var(--color-warning)">
              <span>⏳ حجوزات بانتظار موافقتك (${pending.length})</span>
            </div>
            <div class="table-wrapper" style="border:0;border-radius:0">
              <table class="table">
                <thead>
                  <tr>
                    <th>التاريخ والوقت</th>
                    <th>الأرضية</th>
                    <th>العميل</th>
                    <th>السعر</th>
                    <th class="text-end">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  ${pending.map((b) => `
                    <tr>
                      <td>${window.utils.formatDateTime(b.start_time)}</td>
                      <td>${window.utils.escapeHtml(b.fields ? b.fields.name : '—')}</td>
                      <td>
                        ${window.utils.escapeHtml(b.customers ? b.customers.full_name : '—')}
                        ${b.customer_input_name && b.customers && b.customer_input_name.trim() !== (b.customers.full_name || '').trim() ? '<span class="badge badge--info" style="margin-inline-start:6px">اسم مختلف</span>' : ''}
                        <div class="text-muted" style="font-size:0.85rem">${window.utils.escapeHtml(b.customers ? b.customers.phone : '')}</div>
                      </td>
                      <td>${window.utils.formatCurrency(b.total_price)}</td>
                      <td class="text-end">
                        <button class="btn btn--primary btn--sm" data-action="review" data-id="${b.id}">مراجعة</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
        pendingSection.querySelectorAll('[data-action="review"]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const booking = pending.find((b) => b.id === btn.dataset.id);
            window.bookingModal.open({ booking, onSaved: refresh });
          });
        });
      }

      const onQuickClick = () => window.bookingModal.open({ onSaved: refresh });
      quickBookingBtn.addEventListener('click', onQuickClick);
      cleanup.push(() => quickBookingBtn.removeEventListener('click', onQuickClick));

      // اشتراك realtime: انعش عند أي تغيير في الحجوزات
      if (window.realtime) {
        const debouncedRefresh = window.utils.debounce(refresh, 400);
        const off = window.realtime.on('bookings:change', debouncedRefresh);
        cleanup.push(off);
      }

      page._refresh = refresh;
      refresh();
    },

    unmount() {
      if (page._cleanup) {
        page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      }
      page._cleanup = null;
      page._refresh = null;
      page._alive = () => false;
    }
  };

  window.pages = window.pages || {};
  window.pages.dashboard = page;
})();
