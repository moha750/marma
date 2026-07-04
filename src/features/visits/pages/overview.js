// الزيارات — تحليلات زوّار صفحة الحجز العامة للمالك
// KPI (مشاهدات/زوّار/جلسات/متصلون الآن/مدة/ارتداد/تحويل) + سلسلة يومية +
// قُمع تحويل + أجهزة (donut) + مصادر + دول/مدن + خريطة أوقات (heatmap) +
// أكثر الأرضيات مشاهدة + CSV. المصدر: RPC واحد tenant_visits_stats.
(function () {
  const TEMPLATE = `
    <div class="page-header">
      <div>
        <h2>الزيارات</h2>
        <div class="page-subtitle">من يزور صفحة الحجز؟ من أين؟ وكم منهم يحجز؟</div>
      </div>
      <div class="actions">
        <button class="btn btn--secondary" id="export-btn">
          <i data-lucide="download"></i> تصدير CSV
        </button>
      </div>
    </div>

    <div class="filters-bar">
      <div class="form-group">
        <label class="form-label">من تاريخ</label>
        <input type="date" id="from-date" class="form-control">
      </div>
      <div class="form-group">
        <label class="form-label">إلى تاريخ</label>
        <input type="date" id="to-date" class="form-control">
      </div>
      <div class="chip-rail" style="align-self:end">
        <button class="chip" data-quick="today">اليوم</button>
        <button class="chip" data-quick="week">هذا الأسبوع</button>
        <button class="chip is-active" data-quick="month">هذا الشهر</button>
      </div>
    </div>

    <div id="visits-container">
      <div class="loader-center"><div class="loader loader--lg"></div></div>
    </div>
  `;

  const HEATMAP_DAYS = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
  const DEVICE_LABELS = { mobile: 'جوال', tablet: 'لوحي', desktop: 'حاسب', unknown: 'غير معروف' };
  const DEVICE_COLORS = { mobile: 'var(--accent-500)', tablet: 'var(--warning)', desktop: 'var(--info, #3b82f6)', unknown: 'var(--text-tertiary)' };

  function toISODate(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function dayLabel(iso) {
    const d = new Date(iso);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  }

  // مدة تقريبية: "45 ث" أو "2 د 15 ث"
  function fmtDuration(s) {
    s = Math.max(0, Math.round(Number(s) || 0));
    if (s < 60) return `${s} ث`;
    const m = Math.floor(s / 60);
    return `${m} د ${s % 60} ث`;
  }

  // اسم الدولة بالعربية + علم emoji من رمز ISO
  function countryName(code) {
    if (!code) return 'غير معروف';
    try {
      const name = new Intl.DisplayNames(['ar'], { type: 'region' }).of(code);
      return name || code;
    } catch (_) { return code; }
  }
  function countryFlag(code) {
    if (!code || !/^[A-Z]{2}$/.test(code)) return '';
    return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
  }

  const esc = (s) => window.utils.escapeHtml(s == null ? '' : String(s));

  const page = {
    async mount(container, ctx) {
      container.innerHTML = TEMPLATE;
      window.utils.renderIcons(container);

      const fromInput = container.querySelector('#from-date');
      const toInput = container.querySelector('#to-date');
      const visitsContainer = container.querySelector('#visits-container');
      const exportBtn = container.querySelector('#export-btn');
      const quickChips = container.querySelectorAll('[data-quick]');

      let currentStats = null;
      let alive = true;
      const cleanup = [];
      page._cleanup = cleanup;

      function setRange(quick) {
        const now = new Date();
        let from, to;
        if (quick === 'today') {
          from = to = now;
        } else if (quick === 'week') {
          const day = now.getDay();
          from = new Date(now);
          from.setDate(now.getDate() - day);
          to = new Date(from);
          to.setDate(from.getDate() + 6);
        } else {
          from = new Date(now.getFullYear(), now.getMonth(), 1);
          to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        }
        fromInput.value = toISODate(from);
        toInput.value = toISODate(to);
        quickChips.forEach((c) => c.classList.toggle('is-active', c.dataset.quick === quick));
        refresh();
      }

      async function refresh() {
        if (!alive) return;
        if (!fromInput.value || !toInput.value) return;
        if (fromInput.value > toInput.value) {
          window.utils.toast('تاريخ البداية يجب أن يكون قبل تاريخ النهاية', 'error');
          return;
        }
        visitsContainer.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
        try {
          const stats = await window.visitsApi.getVisitsStats(fromInput.value, toInput.value);
          if (!alive) return;
          currentStats = stats;
          render(stats);
        } catch (err) {
          if (!alive) return;
          visitsContainer.innerHTML = `
            <div class="card">
              <div class="empty-state">
                <div class="empty-icon"><i data-lucide="triangle-alert"></i></div>
                <p class="text-danger">${esc(window.utils.formatError(err))}</p>
              </div>
            </div>
          `;
          window.utils.renderIcons(visitsContainer);
        }
      }

      // "متصلون الآن" فقط — استطلاع خفيف كل 30 ثانية دون إعادة رسم الصفحة
      async function refreshLive() {
        try {
          const n = await window.visitsApi.getVisitsLiveNow();
          const el = visitsContainer.querySelector('#live-now-val');
          if (el) el.textContent = String(n);
        } catch (_) {}
      }

      function kpiCard(icon, label, value, sub, extraClass) {
        return `
          <div class="stat-card">
            <div class="stat-card-head">
              <span class="stat-icon-chip ${extraClass || ''}"><i data-lucide="${icon}"></i></span>
              <span class="stat-label">${label}</span>
            </div>
            <div class="stat-value">${value}</div>
            ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
          </div>
        `;
      }

      function funnelHtml(f) {
        const steps = [
          { label: 'زيارة صفحة الحجز', value: Number(f.book_views) || 0 },
          { label: 'مشاهدة أرضية', value: Number(f.field_views) || 0 },
          { label: 'بدء حجز', value: Number(f.booking_starts) || 0 },
          { label: 'حجز مُنشأ', value: Number(f.bookings) || 0 }
        ];
        const max = Math.max(steps[0].value, 1);
        return steps.map((s, i) => {
          const pct = Math.round((s.value / max) * 100);
          const ofPrev = i > 0 && steps[i - 1].value > 0
            ? `${Math.round((s.value / steps[i - 1].value) * 100)}٪ من السابق`
            : '';
          return `
            <div style="display:flex;align-items:center;gap:12px;margin-block:10px">
              <div style="flex:0 0 130px;font-size:0.85rem;color:var(--text-secondary)">${esc(s.label)}</div>
              <div style="flex:1;background:var(--surface-2);border-radius:6px;height:26px;overflow:hidden">
                <div style="width:${Math.max(pct, s.value > 0 ? 4 : 0)}%;height:100%;border-radius:6px;background:var(--accent-500);opacity:${1 - i * 0.15}"></div>
              </div>
              <div style="flex:0 0 110px;font-size:0.85rem" class="tabular-nums">
                <strong>${s.value}</strong>
                ${ofPrev ? `<span style="color:var(--text-tertiary)"> · ${ofPrev}</span>` : ''}
              </div>
            </div>
          `;
        }).join('');
      }

      function render(stats) {
        const t = stats.totals || {};
        const hasData = (Number(t.views) || 0) > 0;

        if (!hasData) {
          visitsContainer.innerHTML = `
            <div class="card">
              <div class="empty-state">
                <div class="empty-icon"><i data-lucide="eye-off"></i></div>
                <h3>لا توجد زيارات</h3>
                <p>لم تُسجَّل زيارات لصفحة الحجز في هذا النطاق الزمني. شارك رابط صفحتك ليبدأ العدّ!</p>
              </div>
            </div>
          `;
          window.utils.renderIcons(visitsContainer);
          return;
        }

        const daily = stats.daily || [];
        const sources = stats.sources || [];
        const devices = stats.devices || [];
        const countries = stats.countries || [];
        const cities = stats.cities || [];
        const fields = stats.fields || [];

        visitsContainer.innerHTML = `
          <div class="stats-grid mb-md">
            ${kpiCard('eye', 'المشاهدات', t.views || 0, `${daily.length} يوم في النطاق`)}
            ${kpiCard('users', 'الزوّار', t.visitors || 0, 'زائر فريد', 'stat-icon-chip--accent')}
            ${kpiCard('mouse-pointer-click', 'الجلسات', t.sessions || 0)}
            <div class="stat-card">
              <div class="stat-card-head">
                <span class="stat-icon-chip stat-icon-chip--accent"><i data-lucide="activity"></i></span>
                <span class="stat-label">متصلون الآن</span>
              </div>
              <div class="stat-value"><span class="live-dot" aria-hidden="true"></span><span id="live-now-val">${stats.live_now || 0}</span></div>
              <div class="stat-sub">جلسات آخر 5 دقائق</div>
            </div>
            ${kpiCard('timer', 'متوسط مدة الزيارة', fmtDuration(t.avg_duration), 'تقديري')}
            ${kpiCard('corner-up-left', 'معدل الارتداد', `${t.bounce_rate || 0}٪`, 'جلسات بمشاهدة واحدة')}
            ${kpiCard('goal', 'نسبة التحويل', `${t.conversion_rate || 0}٪`, `${t.bookings || 0} حجز من ${t.sessions || 0} جلسة`, 'stat-icon-chip--accent')}
          </div>

          <div class="card mb-md">
            <div class="card-header">
              <h3>الزيارات اليومية</h3>
              <span class="card-header-meta">${daily.length} يوم</span>
            </div>
            <div class="card-body">
              <div id="visits-bar-chart" style="min-height:220px"></div>
            </div>
          </div>

          <div class="mb-md" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px">
            <div class="card">
              <div class="card-header"><h3>قُمع التحويل</h3></div>
              <div class="card-body">${funnelHtml(stats.funnel || {})}</div>
            </div>
            <div class="card">
              <div class="card-header"><h3>الأجهزة</h3></div>
              <div class="card-body"><div id="devices-donut"></div></div>
            </div>
          </div>

          <div class="mb-md" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px">
            <div class="card">
              <div class="card-header"><h3>مصادر الزيارات</h3></div>
              <div class="table-wrapper" style="box-shadow:none;border-radius:0">
                <table class="table tabular-nums">
                  <thead><tr><th>المصدر</th><th>مشاهدات</th><th>زوّار</th></tr></thead>
                  <tbody>
                    ${sources.map((s) => `
                      <tr>
                        <td>${s.source === 'مباشر' ? 'مباشر' : `<span dir="ltr">${esc(s.source)}</span>`}</td>
                        <td>${s.views}</td>
                        <td>${s.visitors}</td>
                      </tr>
                    `).join('') || '<tr><td colspan="3" class="text-tertiary">لا توجد بيانات</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>
            <div class="card">
              <div class="card-header"><h3>الدول والمدن</h3></div>
              <div class="table-wrapper" style="box-shadow:none;border-radius:0">
                <table class="table tabular-nums">
                  <thead><tr><th>الدولة</th><th>مشاهدات</th><th>زوّار</th></tr></thead>
                  <tbody>
                    ${countries.map((c) => `
                      <tr>
                        <td>${countryFlag(c.country)} ${esc(countryName(c.country))}</td>
                        <td>${c.views}</td>
                        <td>${c.visitors}</td>
                      </tr>
                    `).join('') || '<tr><td colspan="3" class="text-tertiary">لا توجد بيانات</td></tr>'}
                  </tbody>
                </table>
              </div>
              ${cities.length ? `
                <div class="card-body" style="padding-top:8px">
                  <div style="font-size:0.8rem;color:var(--text-tertiary);display:flex;flex-wrap:wrap;gap:6px">
                    ${cities.map((c) => `<span class="chip" style="pointer-events:none">${esc(c.city)} · ${c.views}</span>`).join('')}
                  </div>
                </div>
              ` : ''}
            </div>
          </div>

          <div class="card mb-md">
            <div class="card-header">
              <h3>أوقات الزيارات</h3>
              <span class="card-header-meta">حسب اليوم والساعة (بتوقيت الرياض)</span>
            </div>
            <div class="card-body">
              <div class="chart-heatmap-wrap"><div id="visits-heatmap"></div></div>
            </div>
          </div>

          <div class="card">
            <div class="card-header"><h3>أكثر الأرضيات مشاهدة</h3></div>
            <div class="table-wrapper" style="box-shadow:none;border-radius:0">
              <table class="table tabular-nums">
                <thead><tr><th>الأرضية</th><th>مشاهدات</th><th>حجوزات</th><th>تحويل</th></tr></thead>
                <tbody>
                  ${fields.map((f) => `
                    <tr>
                      <td>${esc(f.name)}</td>
                      <td>${f.views}</td>
                      <td>${f.bookings}</td>
                      <td>${f.views > 0 ? Math.round((f.bookings / f.views) * 100) : 0}٪</td>
                    </tr>
                  `).join('') || '<tr><td colspan="4" class="text-tertiary">لا توجد بيانات</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        `;

        // الرسوم
        const barEl = visitsContainer.querySelector('#visits-bar-chart');
        if (barEl && window.charts && window.charts.bar) {
          window.charts.bar({
            container: barEl,
            data: daily.map((d) => ({ label: dayLabel(d.date), value: Number(d.views) || 0 })),
            height: 220
          });
        }

        const donutEl = visitsContainer.querySelector('#devices-donut');
        if (donutEl && window.charts && window.charts.donut) {
          window.charts.donut({
            container: donutEl,
            data: devices.map((d) => ({
              label: DEVICE_LABELS[d.device] || d.device,
              value: Number(d.views) || 0,
              color: DEVICE_COLORS[d.device] || 'var(--accent-500)'
            })),
            centerLabel: String(t.views || 0),
            centerSub: 'مشاهدة'
          });
        }

        const heatEl = visitsContainer.querySelector('#visits-heatmap');
        if (heatEl && window.charts && window.charts.heatmap) {
          window.charts.heatmap({
            container: heatEl,
            days: HEATMAP_DAYS,
            hours: Array.from({ length: 24 }, (_, h) => String(h)),
            data: stats.heatmap || [],
            format: (v) => `${v} زيارة`
          });
        }

        window.utils.renderIcons(visitsContainer);
      }

      function exportCsv() {
        const daily = (currentStats && currentStats.daily) || [];
        if (!daily.length) {
          window.utils.toast('لا توجد بيانات للتصدير', 'warning');
          return;
        }
        const t = currentStats.totals || {};
        const rows = [
          ['التاريخ', 'المشاهدات', 'الزوّار'],
          ...daily.map((d) => [d.date, d.views, d.visitors]),
          [],
          ['الإجمالي', t.views || 0, t.visitors || 0],
          ['الجلسات', t.sessions || 0, ''],
          ['الحجوزات', t.bookings || 0, ''],
          ['نسبة التحويل ٪', t.conversion_rate || 0, ''],
          ['معدل الارتداد ٪', t.bounce_rate || 0, '']
        ];
        const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `زيارات-${fromInput.value}-إلى-${toInput.value}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        window.utils.toast('تم تصدير التقرير', 'success');
      }

      fromInput.addEventListener('change', () => {
        quickChips.forEach((c) => c.classList.remove('is-active'));
        refresh();
      });
      toInput.addEventListener('change', () => {
        quickChips.forEach((c) => c.classList.remove('is-active'));
        refresh();
      });
      quickChips.forEach((c) => c.addEventListener('click', () => setRange(c.dataset.quick)));
      exportBtn.addEventListener('click', exportCsv);

      cleanup.push(() => { alive = false; });

      // متصلون الآن: استطلاع كل 30 ثانية
      const liveTimer = setInterval(refreshLive, 30000);
      cleanup.push(() => clearInterval(liveTimer));

      // تحديث لحظي لأرقام التحويل عند تغيّر الحجوزات
      if (window.realtime) {
        cleanup.push(window.realtime.on('bookings:change', window.utils.debounce(refresh, 400)));
      }

      // افتراضي: الشهر الحالي
      setRange('month');
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages.visits = page;
})();
