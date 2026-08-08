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

  // latn — مطابقةً لبقية الواجهة (انظر NUM في src/core/utils.js)
  const longDateFormatter = new Intl.DateTimeFormat('ar-EG', {
    numberingSystem: 'latn',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const weekdayFormatter = new Intl.DateTimeFormat('ar-EG', { weekday: 'long' });

  // ─── أدوات صغيرة ──────────────────────────────────────

  function fmtMoney(v) { return window.utils.formatCurrency(v || 0); }

  // يفصل «ر.س» عن الرقم: الوحدة تُرسم أصغر (kpi-unit) فلا تزاحم الرقم ولا
  // تدفعه خارج خليّةٍ عرضها ثلث الشاشة — كان «1,700 ر.س» يُقصّ إلى «1,700 ر...».
  function splitMoney(v) {
    const s = window.utils.formatCurrency(v || 0);
    const i = s.lastIndexOf(' ');
    return i === -1 ? { value: s, unit: '' } : { value: s.slice(0, i), unit: s.slice(i + 1) };
  }

  // تعدّد عربي صحيح: ١ مفرد · ٢ مثنّى · ٣-١٠ جمع · ١١+ تمييز مفرد منصوب
  function plural(n, one, two, few, many) {
    if (n === 1) return one;
    if (n === 2) return two;
    if (n >= 3 && n <= 10) return `${n} ${few}`;
    return `${n} ${many}`;
  }

  function statusChip(status, b) {
    if (status === 'pending')   return '<span class="chip-status chip-status--pending">بانتظار تأكيدك</span>';
    if (status === 'confirmed') return '<span class="chip-status chip-status--confirmed">حجز مؤكد</span>';
    if (status === 'completed') return '<span class="chip-status chip-status--completed">حجز مكتمل</span>';
    if (status === 'cancelled') {
      // تمييز إلغاء العميل (عبر صفحة «حجوزاتي») عن إلغاء الإدارة
      return b && b.cancelled_by === 'customer'
        ? '<span class="chip-status chip-status--cancelled">ألغى العميل حجزه</span>'
        : '<span class="chip-status chip-status--cancelled">حجز ملغي</span>';
    }
    if (status === 'no_show') return '<span class="chip-status chip-status--noshow">لم يحضر</span>';
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

  // الإشغال: مجموع slots المحجوزة فعلاً / مجموع slots اليوم عبر كل الأرضيات.
  // نعتمد is_booked (حجز حقيقي يغطّي الوقت) لا is_available — إذ أنّ is_available=false
  // يشمل أيضاً المواعيد المنقضية الفارغة، فكان يضخّم النسبة كلّما تقدّم اليوم.
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
          if (s.is_booked) booked++;
        });
      });
      if (total === 0) return null;
      return { total, booked, percent: Math.round((booked / total) * 100) };
    } catch (_) { return null; }
  }

  // ─── العرض ────────────────────────────────────────────

  function renderSkeletonStatCard() {
    return `
      <div class="kpi-cell">
        <div class="skeleton skeleton-line" style="width:52px;height:9px"></div>
        <div class="skeleton skeleton-line" style="width:78px;height:20px;margin-top:var(--space-2)"></div>
        <div class="skeleton skeleton-line" style="width:64px;height:8px;margin-top:var(--space-2)"></div>
      </div>
    `;
  }

  // خليّة مؤشّر — تسمية فوق، رقم، ثم سطر سياق وشريط اختياري.
  // البطاقة القديمة كانت ١٧٧px ارتفاعاً لرقمٍ واحد، وتنهار إلى عمود واحد تحت
  // ٦٤٠px فتصير ثلاث كتل متطابقة يملؤها الفراغ (٥٣٠px لثلاثة أرقام).
  function kpiCell({ label, value, unit, sub, bar, legend, tone }) {
    return `
      <div class="kpi-cell${tone ? ' kpi-cell--' + tone : ''}">
        <div class="kpi-label">${label}</div>
        <div class="kpi-value">${value}${unit ? `<span class="kpi-unit">${unit}</span>` : ''}</div>
        ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
        ${bar ? `<div class="stat-bar">${bar}</div>` : ''}
        ${legend ? `<div class="kpi-legend">${legend}</div>` : ''}
      </div>
    `;
  }

  // الترويسة بلا عنوانٍ ثانٍ: الشريط العلوي يعرض «لوحة التحكم» في breadcrumb
  // أصلاً (layout.setActive)، فتكرارها هنا يأكل ١٠٠px من أوّل شاشة على الجوال
  // ليقول ما هو مكتوب فوقه بسطر. يبقى التاريخ — وهو المعلومة الوحيدة الجديدة.
  function buildTemplate(isOwner, todayLabel) {
    return `
      <div class="page-header dash-header">
        <div>
          <div class="dash-date">${todayLabel}</div>
        </div>
        <div class="actions">
          <button class="btn btn--primary" id="quick-booking-btn">
            <i data-lucide="plus"></i> حجز جديد
          </button>
        </div>
      </div>

      <div id="push-banner-area"></div>

      <div id="pending-banner-area"></div>

      <div id="kpi-area">
        <div class="kpi-strip">
          ${renderSkeletonStatCard()}
          ${renderSkeletonStatCard()}
          ${renderSkeletonStatCard()}
        </div>
      </div>

      <div id="timeline-area"></div>

      <div id="tomorrow-area"></div>

      <div id="sparkline-area"></div>
    `;
  }

  // شريط الطلبات المعلّقة — صفٌّ واحد، لا قائمة.
  //
  // كان يسرد ثلاثة طلبات بتواريخها الكاملة في ٢٨٧px. وكانت تلك الثلاثة تظهر
  // مرّةً ثانية في «جدول اليوم» أو «غداً» تحتها مباشرة — فالمستخدم يقرأ الحجز
  // نفسه مرّتين ويظنّهما اثنين. الصفّ يقول العدد ويفتح القائمة المفلترة.
  //
  // ويقول «كل التواريخ» صراحةً: العدد هنا كل المعلّق مهما بَعُد موعده، بينما
  // «معلّق ٣» في بطاقة الحجوزات لليوم وحده — رقمان مختلفان بلا تفسير كانا
  // يبدوان تناقضاً.
  function renderPendingBanner(pending) {
    if (!pending.length) return '';
    const word = plural(pending.length, 'طلب واحد', 'طلبان', 'طلبات', 'طلباً');
    return `
      <a class="pending-bar" href="${window.utils.path('/bookings')}?status=pending">
        <span class="stat-icon-chip stat-icon-chip--warning"><i data-lucide="hourglass"></i></span>
        <span class="pending-bar-text">
          <strong>${word}</strong> بانتظار موافقتك
          <span class="pending-bar-scope">كل التواريخ</span>
        </span>
        <i data-lucide="chevron-left" class="pending-bar-go"></i>
      </a>
    `;
  }

  // KPI #1 — يُختلف بحسب الدور
  function renderHeroCard({ isOwner, stats }) {
    if (isOwner) {
      const unpaid = (stats.today_revenue || 0) - (stats.today_paid || 0);
      const m = splitMoney(stats.today_revenue);
      return kpiCell({
        label: 'إيرادات اليوم',
        value: m.value,
        unit: m.unit,
        // غير المدفوع هو الرقم الذي يستدعي فعلاً — فيُبرز حين يوجد بدل أن
        // يُدفن في نصٍّ رماديّ بجانب المدفوع
        sub: unpaid > 0
          ? `<span class="kpi-flag">${fmtMoney(unpaid)} غير محصّل</span>`
          : 'محصّل بالكامل'
      });
    }
    const count = stats.today_bookings || 0;
    return kpiCell({
      label: 'حجوزات اليوم',
      value: count,
      sub: count === 0 ? 'لا حجوزات بعد' : 'حجزاً مسجّلاً'
    });
  }

  // KPI #2 — الإشغال (مشترك للدورين)
  function renderUtilizationCard(util) {
    if (!util) {
      return kpiCell({
        label: 'الإشغال اليوم',
        value: '—',
        sub: 'لا جداول عمل لليوم'
      });
    }
    return kpiCell({
      label: 'الإشغال اليوم',
      value: util.percent,
      unit: '%',
      sub: `${util.booked} من ${util.total} موعداً`,
      bar: `<span class="stat-bar-seg stat-bar-seg--success" style="width:${util.percent}%"></span>`
    });
  }

  // KPI #3 — حجوزات اليوم مع مزيج الحالات (للمالك)، أو نظرة الأسبوع (للموظف)
  function renderThirdCard({ isOwner, stats, todayMix, weekCount }) {
    if (!isOwner) {
      return kpiCell({ label: 'هذا الأسبوع', value: weekCount, sub: 'حجزاً خلال 7 أيام' });
    }
    const total = stats.today_bookings || 0;
    if (!total) {
      return kpiCell({ label: 'حجوزات اليوم', value: 0, sub: 'لا حجوزات بعد' });
    }
    const r = 100 / total;
    const seg = (n, kind) => n ? `<span class="stat-bar-seg stat-bar-seg--${kind}" style="width:${n * r}%"></span>` : '';
    const dot = (n, label, color) => n ? `<span><span class="dot" style="background:${color}"></span>${label} ${n}</span>` : '';
    return kpiCell({
      label: 'حجوزات اليوم',
      value: total,
      bar: seg(todayMix.confirmed, 'success') + seg(todayMix.pending, 'warning')
         + seg(todayMix.completed, 'muted')  + seg(todayMix.cancelled, 'danger'),
      legend: dot(todayMix.confirmed, 'مؤكد', 'var(--success)')
            + dot(todayMix.pending,   'معلّق', 'var(--warning)')
            + dot(todayMix.completed, 'مكتمل', 'var(--border-strong)')
            + dot(todayMix.cancelled, 'ملغي',  'var(--danger)')
    });
  }

  // منحنى الإيراد — مع طرفين مسمّيين.
  //
  // المنحنى بلا محور ولا تسمية: خطٌّ يصعد ويهبط لا يقول أيّ طرفٍ هو اليوم.
  // والقارئ العربي يبدأ من اليمين، فكان يقرأ الزمن معكوساً ويستنتج اتجاهاً
  // مقلوباً لإيراده. القلب في sparkline.js أصلح المسار، والتسميتان تجعلانه
  // غير قابل لسوء القراءة أصلاً.
  function renderSparklineRow(spark) {
    if (!spark || !spark.length) return '';
    const total = spark.reduce((a, b) => a + b, 0);
    const peak = Math.max(...spark);
    return `
      <div class="card mb-md spark-card">
        <div class="spark-head">
          <div>
            <div class="spark-title">إيرادات آخر 14 يوماً</div>
            <div class="spark-total">${fmtMoney(total)}</div>
          </div>
          <div class="spark-peak">ذروة يومية ${fmtMoney(peak)}</div>
        </div>
        <div id="rev-spark-big" class="spark-canvas"></div>
        <div class="spark-axis">
          <span>قبل 14 يوماً</span>
          <span>اليوم</span>
        </div>
      </div>
    `;
  }

  function timelineRow(b, extraClass) {
    return `
      <div class="timeline-row is-clickable${extraClass || ''}" data-id="${b.id}" data-status="${b.status}">
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
          ${statusChip(window.utils.effectiveBookingStatus(b), b)}
          <span class="timeline-price">${window.utils.formatPrice(b.total_price)}</span>
        </div>
      </div>
    `;
  }

  // Timeline اليوم — القادم مفتوحاً، والمنقضي مطويّاً.
  //
  // كان يعرض اليوم كاملاً: في السابعة مساءً تقرأ ستّ حجوزاتٍ انتهت قبل أن تصل
  // إلى ما تبقّى. واللوحة تجيب «ماذا الآن» لا «ماذا كان» — فالمنقضي يبقى
  // متاحاً بضغطة، ولا يحتلّ الشاشة.
  function renderTodayTimeline(todayBookings) {
    if (!todayBookings.length) {
      return `
        <div class="card mb-md">
          <div class="card-header"><h3>جدول اليوم</h3></div>
          <div class="empty-state" style="padding:var(--space-6)">
            <div class="empty-icon"><i data-lucide="clock"></i></div>
            <p>لا توجد حجوزات لليوم بعد. شارك رابط الحجز أو أنشئ حجزاً يدوياً.</p>
          </div>
        </div>
      `;
    }
    const sorted = [...todayBookings].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    const now = Date.now();
    const past     = sorted.filter((b) => new Date(b.end_time).getTime() < now);
    const upcoming = sorted.filter((b) => new Date(b.end_time).getTime() >= now);

    // انقضى اليوم كلّه ⇒ لا معنى لطيّ كل شيء خلف زرّ
    const allDone = upcoming.length === 0;

    return `
      <div class="card mb-md">
        <div class="card-header">
          <h3>جدول اليوم</h3>
          <span class="card-header-meta">${allDone ? `${sorted.length} موعداً · انتهت` : `${upcoming.length} متبقٍّ من ${sorted.length}`}</span>
        </div>

        ${past.length && !allDone ? `
          <button type="button" class="timeline-past-toggle" id="past-toggle" aria-expanded="false">
            <i data-lucide="chevron-down"></i>
            <span>${plural(past.length, 'موعد واحد', 'موعدان', 'مواعيد', 'موعداً')} ${past.length <= 2 ? 'انقضى' : 'انقضت'}</span>
          </button>
          <div class="timeline-list is-collapsed" id="past-list">
            ${past.map((b) => timelineRow(b, ' timeline-row--past')).join('')}
          </div>
        ` : ''}

        <div class="timeline-list">
          ${(allDone ? sorted : upcoming).map((b) => timelineRow(b, allDone ? ' timeline-row--past' : '')).join('')}
        </div>
      </div>
    `;
  }

  // «غداً» — مطويّ افتراضاً.
  //
  // كان يعرض خمسة صفوف في ٤٢٥px، وهو على بُعد شاشتين من أعلى الصفحة — أي أن
  // كلفته مؤكّدة وقراءته نادرة. الآن سطرٌ يقول العدد وأوّل موعد، ويُفتح بضغطة.
  function renderTomorrow(tomorrowBookings, tomorrowDate) {
    const dayLabel = weekdayFormatter.format(tomorrowDate);
    if (!tomorrowBookings.length) {
      return `
        <div class="tomorrow-bar is-empty">
          <span class="tomorrow-bar-day">غداً (${dayLabel})</span>
          <span class="tomorrow-bar-meta">لا حجوزات مجدولة</span>
        </div>
      `;
    }
    const sorted = [...tomorrowBookings].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    const first = window.utils.formatTime(sorted[0].start_time);
    const n = sorted.length;
    return `
      <div class="tomorrow-wrap mb-md">
        <button type="button" class="tomorrow-bar" id="tomorrow-toggle" aria-expanded="false">
          <i data-lucide="chevron-down" class="tomorrow-bar-caret"></i>
          <span class="tomorrow-bar-day">غداً (${dayLabel})</span>
          <span class="tomorrow-bar-meta">${plural(n, 'حجز واحد', 'حجزان', 'حجوزات', 'حجزاً')} · يبدأ ${first}</span>
        </button>
        <div class="card timeline-list is-collapsed" id="tomorrow-list">
          ${sorted.map((b) => `
            <div class="timeline-row is-clickable timeline-row--compact" data-id="${b.id}" data-status="${b.status}">
              <div class="timeline-time">
                <span class="timeline-time-from">${window.utils.formatTime(b.start_time)}</span>
              </div>
              <div class="timeline-main">
                <div class="timeline-customer">${escapeName(b.customers && b.customers.full_name)}</div>
                <div class="timeline-field">${escapeName(b.fields && b.fields.name)}</div>
              </div>
              <div class="timeline-side">
                ${statusChip(window.utils.effectiveBookingStatus(b), b)}
              </div>
            </div>
          `).join('')}
        </div>
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
      const s = window.utils.effectiveBookingStatus(b);
      if (mix[s] != null) mix[s]++;
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

      // ─── تحديث بلا اقتلاع ────────────────────────────────
      //
      // اللوحة تُحدَّث لحظياً عند أي تغيير حجز. وإعادة كتابة innerHTML في كل
      // مرّة تُنتج ثلاث خسائر: وميض، وفقدان موضع التمرير، وانطواء ما فتحه
      // المستخدم للتوّ. وأكثر الأحداث لا تغيّر شيئاً مما هو معروض أصلاً
      // (تعديل حجزٍ الأسبوع القادم مثلاً) — فيدفع ثمن إعادةٍ لا أثر لها.
      //
      // فالكتابة لا تقع إلا إن اختلف الناتج فعلاً، وما فُتح يبقى مفتوحاً.

      // حالة الطيّ مملوكة للصفحة لا للـ DOM: الـ DOM يُستبدل، وهي تبقى
      const disclosed = { 'past-list': false, 'tomorrow-list': false };

      // آخر قيمة معروفة لِما يصل في الموجة الثانية. بدونها يرسم كل تحديث
      // لحظيّ «—» مكان نسبة الإشغال ثم يصحّحها بعد لحظة — أي أنّ الإصلاح
      // نفسه كان سيصنع وميضاً جديداً. أوّل تركيب وحده يبدأ بلا قيمة.
      let lastUtil = undefined;
      let lastWeekCount = 0;

      // المقارنة مع آخر ما كتبناه، لا مع الـ DOM الحيّ:
      // renderIcons يستبدل كل <i data-lucide> بـ <svg> بعد الكتابة مباشرة،
      // فالـ innerHTML الحيّ لا يطابق الناتج الجديد أبداً — وكان الفحص يمرّ
      // دائماً بلا فائدة.
      const lastHtml = new WeakMap();

      function setHtml(el, html) {
        if (lastHtml.get(el) === html) return false;   // لا شيء تغيّر ⇒ لا وميض
        lastHtml.set(el, html);
        el.innerHTML = html;
        return true;
      }

      // يعيد لأقسام الكشف حالتها بعد أي رسم
      function applyDisclosure(area, btnId, listId) {
        const btn = area.querySelector('#' + btnId);
        const list = area.querySelector('#' + listId);
        if (!btn || !list) return;
        const open = disclosed[listId];
        list.classList.toggle('is-collapsed', !open);
        btn.classList.toggle('is-open', open);
        btn.setAttribute('aria-expanded', String(open));
      }

      // نقر أي صفّ يفتح مودال التعديل
      function bindTimeline(area, source) {
        area.querySelectorAll('.timeline-row[data-id]').forEach((row) => {
          row.addEventListener('click', () => {
            if (window.native) window.native.haptic('LIGHT');
            const b = source.find((x) => x.id === row.dataset.id);
            if (b) window.bookingModal.open({ booking: b, onSaved: refresh });
          });
        });
      }

      function bindDisclosure(area, btnId, listId) {
        const btn = area.querySelector('#' + btnId);
        const list = area.querySelector('#' + listId);
        if (!btn || !list) return;
        applyDisclosure(area, btnId, listId);
        btn.addEventListener('click', () => {
          disclosed[listId] = !disclosed[listId];
          applyDisclosure(area, btnId, listId);
          if (window.native) window.native.haptic('LIGHT');
        });
      }

      const bindPastToggle     = (area) => bindDisclosure(area, 'past-toggle', 'past-list');
      const bindTomorrowToggle = (area) => bindDisclosure(area, 'tomorrow-toggle', 'tomorrow-list');

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

          // التحميل على موجتين لا موجة واحدة.
          //
          // كانت الصفحة كلها تنتظر Promise.all واحداً فيه اتجاه ١٤ يوماً
          // واستعلامَ مواعيدٍ لكلّ أرضية — نحو عشر ذهابات وإياب. والهيكل العظمي
          // يغطّي منطقة المؤشرات وحدها، فيبقى «جدول اليوم» — أنفع ما في
          // الصفحة — بياضاً تامّاً حتى يعود أبطأ نداء.
          //
          // الموجة الأولى: ما يُرسم فوق الطيّة. والثانية: ما دونها.
          const [stats, todayBookings, pending] = await Promise.all([
            window.api.getDashboardStats(),
            window.api.listBookings({ from: todayStart, to: todayEnd, limit: 200 }),
            window.api.listPendingBookings()
          ]);
          if (!alive) return;

          const mix = todayBookingsMix(todayBookings);

          let painted = false;

          // ── 1) شريط الطلبات المعلّقة (يختفي عند صفر)
          painted = setHtml(pendingArea, renderPendingBanner(pending)) || painted;

          // ── 2) المؤشرات — الإشغال والأسبوع يلحقان في الموجة الثانية
          function paintKpis(util, weekCount) {
            return setHtml(kpiArea, `
              <div class="kpi-strip">
                ${renderHeroCard({ isOwner, stats })}
                ${renderUtilizationCard(util)}
                ${renderThirdCard({ isOwner, stats, todayMix: mix, weekCount })}
              </div>
            `);
          }
          painted = paintKpis(lastUtil, lastWeekCount) || painted;

          // ── 3) Timeline اليوم — يظهر الآن، لا بعد عشرة نداءات
          if (setHtml(timelineArea, renderTodayTimeline(todayBookings))) {
            bindTimeline(timelineArea, todayBookings);
            bindPastToggle(timelineArea);
            painted = true;
          }
          if (painted) window.utils.renderIcons(container);

          // ── الموجة الثانية ───────────────────────────
          const [tomorrowBookings, weekBookings, spark, util] = await Promise.all([
            window.api.listBookings({ from: tomorrowStart, to: tomorrowEnd, limit: 200 }),
            isOwner ? Promise.resolve([]) : window.api.listBookings({ from: weekStart, to: weekEnd, limit: 200 }),
            isOwner ? fetchRevenueTrend() : Promise.resolve(null),
            fetchUtilization(today)
          ]);
          if (!alive) return;

          const hasSpark = spark && spark.length >= 2 && spark.some((v) => v > 0);

          lastUtil = util;
          lastWeekCount = weekBookings.length;
          painted = paintKpis(lastUtil, lastWeekCount) || painted;

          // ── 4) غداً
          if (setHtml(tomorrowArea, renderTomorrow(tomorrowBookings, tomorrow))) {
            bindTimeline(tomorrowArea, tomorrowBookings);
            bindTomorrowToggle(tomorrowArea);
            painted = true;
          }

          // ── 5) Sparkline (مالك فقط، يُخفى عند انعدام البيانات)
          if (setHtml(sparkArea, (isOwner && hasSpark) ? renderSparklineRow(spark) : '')) {
            painted = true;
            if (isOwner && hasSpark) {
              const big = sparkArea.querySelector('#rev-spark-big');
              if (big) window.charts.sparkline({ container: big, data: spark, fill: true, height: 48, strokeWidth: 2 });
            }
          }

          if (painted) window.utils.renderIcons(container);
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
