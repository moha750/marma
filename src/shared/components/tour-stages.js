// مسارح شرائح الجولة — نسخ مصغّرة من شاشات مَرمى الحقيقية.
//
// لماذا ملفّ منفصل عن tour.js: هذه ليست منطقاً بل محتوى — ماركب مأخوذ من صفحات
// المنتج بأصنافها الفعلية (‎.bp-slot · .pending-bar · .pay-band · .kpi-strip ·
// .wcard-dot). فحين تتغيّر تلك الشاشات يُعدَّل هذا الملف وحده، ويبقى مُشغّل
// الجولة بمعزل عن ذلك.
//
// القاعدة التي بُني عليها كل مسرح: أعِد استعمال أصناف مَرمى الحقيقية، لا تبنِ
// نظام تصميم ثانياً. وكل تبديل حالة طبقتان متراكبتان (‎.tour-swap > .tour-layer)
// تتبادلان الشفافية داخل @keyframes — لا عنصر واحد يتلوّن، ولا تبديل أصناف من
// JS: chip.css و card.css تضعان transition على background، فتبديلٌ من JS كان
// سيُمَوِّه الارتداد فيُقرأ «النظام يسحب ما فعله».
//
// الأنماط والتوقيت في styles/components/tour.css.
window.tourStages = [
  // ===== الشريحة 1 — صفحة الحجز العامة =====
  `<div class="bp-slots" aria-hidden="true">
  <div class="bp-slots-grid">

    <button type="button" class="bp-slot" tabindex="-1">
      <span class="bp-slot-time">5:00 م</span>
      <span class="bp-slot-price">150 ر.س</span>
    </button>

    <button type="button" class="bp-slot is-busy" disabled tabindex="-1">
      <span class="bp-slot-time">6:00 م</span>
      <span class="bp-slot-price">محجوز</span>
    </button>

    <div class="tour-swap tour-swap--slot">
      <button type="button" class="bp-slot is-selected tour-layer tour-layer--after" tabindex="-1">
        <span class="bp-slot-time">7:00 م</span>
        <span class="bp-slot-price">150 ر.س</span>
      </button>
      <button type="button" class="bp-slot tour-layer tour-layer--before" tabindex="-1">
        <span class="bp-slot-time">7:00 م</span>
        <span class="bp-slot-price">150 ر.س</span>
      </button>
      <span class="tour-tap"></span>
    </div>

    <button type="button" class="bp-slot" tabindex="-1">
      <span class="bp-slot-time">8:00 م</span>
      <span class="bp-slot-price">120 ر.س</span>
    </button>

  </div>
</div>

<div class="bp-action-bar" data-state="ready" aria-hidden="true">

  <div class="tour-swap tour-swap--info">
    <div class="bp-action-summary tour-layer tour-layer--after">
      <div class="bp-action-price">
        <span class="bp-action-price-amt">150</span>
        <small>ر.س</small>
      </div>
      <div class="bp-action-meta">
        <span class="bp-action-meta-row"><i data-lucide="calendar"></i>15 أغسطس 2026</span>
        <span class="bp-action-meta-row"><i data-lucide="clock"></i>7:00 م → 8:00 م</span>
      </div>
    </div>
    <div class="bp-action-empty tour-layer tour-layer--before">
      <i data-lucide="arrow-up"></i>
      <span>اختر موعدك من الأعلى</span>
    </div>
  </div>

  <div class="tour-swap tour-swap--cta">
    <button type="button" class="btn btn--primary btn--lg bp-action-cta tour-layer tour-layer--before" disabled tabindex="-1">
      <span>متابعة</span>
      <i data-lucide="arrow-left"></i>
    </button>
    <button type="button" class="btn btn--primary btn--lg bp-action-cta tour-layer tour-layer--after" tabindex="-1">
      <span>متابعة</span>
      <i data-lucide="arrow-left"></i>
    </button>
  </div>

</div>`,

  // ===== الشريحة 2 — إشعار الطلب والقرار من الصفّ =====
  `<div class="tour-frame" aria-hidden="true">
  <div class="tour-canvas">

    <!-- إشعار النظام — نصّه من send-booking-push/index.ts:149-157 -->
    <div class="tour-push">
      <span class="stat-icon-chip stat-icon-chip--accent"><i data-lucide="bell"></i></span>
      <span class="tour-push-text">
        <span class="tour-push-app">مَرمى · الآن</span>
        <strong class="tour-push-title">حجز جديد</strong>
        <span class="tour-push-body">فهد الدوسري · الأرضية الشمالية · الخميس 9:00 م</span>
      </span>
    </div>

    <!-- شريط الطلبات المعلّقة — home.js:197-210 -->
    <span class="pending-bar">
      <span class="stat-icon-chip stat-icon-chip--warning"><i data-lucide="hourglass"></i></span>
      <span class="pending-bar-text">
        <span class="tour-swap tour-count"><strong class="tour-count-a">طلب واحد</strong><strong class="tour-count-b">طلبان</strong><strong class="tour-count-c">طلب واحد</strong></span> بانتظار موافقتك
        <span class="pending-bar-scope">كل التواريخ</span>
      </span>
      <i data-lucide="chevron-left" class="pending-bar-go"></i>
    </span>

    <!-- كرت الحجز — list.js:421-499 في وضع الكروت -->
    <div class="table-wrapper cards-only as-cards">
      <table class="table table--cards">
        <tbody>
          <tr data-status="pending">
            <td>13 أغسطس 2026 - 9:00 م</td>
            <td data-label="الأرضية">الأرضية الشمالية</td>
            <td data-label="العميل">فهد الدوسري</td>
            <td class="card-tag">
              <span class="tour-swap tour-swap--end"><span class="chip-status chip-status--pending tour-chip-a">بانتظار تأكيدك</span><span class="chip-status chip-status--confirmed tour-chip-b">حجز مؤكد</span></span>
            </td>
            <td class="actions-cell">
              <div class="actions-inline">
                <span class="btn btn--xs btn--accent-quiet tour-approve">
                  <i data-lucide="check"></i><span class="btn-label">قبول الحجز</span>
                  <span class="tour-tap-dot"></span>
                  <span class="tour-tap-ring"></span>
                </span>
                <span class="btn btn--xs btn--danger-quiet">
                  <i data-lucide="x"></i><span class="btn-label">رفض الحجز</span>
                </span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- مودال «تأكيد الحجز» — booking-whatsapp.js:61-91 عبر utils.openModal (utils.js:348) -->
    <div class="modal-backdrop tour-modal">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3>تأكيد الحجز</h3>
          <span class="modal-close"><i data-lucide="x"></i></span>
        </div>
        <div class="modal-body">
          <div style="text-align:center">
            <div style="width:56px;height:56px;border-radius:50%;background:var(--success-tint);display:flex;align-items:center;justify-content:center;margin:0 auto var(--space-3)">
              <i data-lucide="check" style="color:var(--success);width:28px;height:28px"></i>
            </div>
            <p style="margin:0 0 var(--space-2)">تم تأكيد الحجز بنجاح.</p>
            <p class="text-muted text-sm" style="margin:0">أرسل رسالة تأكيد جاهزة إلى <strong>فهد الدوسري</strong> عبر واتساب.</p>
          </div>
        </div>
        <div class="modal-footer">
          <div style="display:flex;gap:8px;width:100%">
            <span class="btn btn--wa" style="flex:1;justify-content:center">
              <i data-lucide="message-circle"></i> تأكيد الحجز للعميل عبر واتساب
            </span>
            <span class="btn btn--ghost">لاحقاً</span>
          </div>
        </div>
      </div>
    </div>

  </div>
</div>`,

  // ===== الشريحة 3 — رسالة واتساب وتتبّع التبليغ =====
  `<div class="tour-card">
  <div class="table-wrapper cards-only as-cards">
    <table class="table table--cards">
      <tbody>
        <tr data-status="confirmed">
          <td>9 أغسطس 2026 - 9:00 م</td>
          <td class="card-note">
            <span class="tour-swap tour-swap--band">
              <span class="wa-pending tour-before" aria-hidden="true"><i data-lucide="alert-circle"></i> لم يُؤكَّد الحجز للعميل بعد</span>
              <span class="wa-confirmed tour-after"><i data-lucide="badge-check"></i> تم التواصل وتأكيد الحجز · قبل 3 ساعات</span>
            </span>
          </td>
          <td data-label="الأرضية">الأرضية الشمالية</td>
          <td data-label="العميل">فهد</td>
          <td data-label="الحالة" class="card-tag"><span class="chip-status chip-status--confirmed">حجز مؤكد</span></td>
          <td class="actions-cell">
            <div class="actions-inline">
              <span class="tour-swap tour-swap--btn">
                <span class="btn btn--xs btn--wa tour-before" aria-hidden="true"><i data-lucide="message-circle"></i><span class="btn-label">أكّد الموعد للعميل</span></span>
                <span class="btn btn--xs btn--wa-quiet tour-after"><i data-lucide="message-circle"></i><span class="btn-label">تواصل واتساب</span></span>
                <span class="tour-tap" aria-hidden="true"></span>
              </span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="tour-wa" aria-hidden="true">
    <span class="tour-wa-line tour-wa-line--1">مرحباً فهد 👋</span>
    <span class="tour-wa-line tour-wa-line--2">تم تأكيد حجزك في ملاعب النخبة ✅</span>
    <span class="tour-wa-line tour-wa-line--3">🏟️ الأرضية: الأرضية الشمالية</span>
    <span class="tour-wa-line tour-wa-line--4">🕐 الوقت: 9:00 م</span>
    <span class="tour-wa-line tour-wa-line--5">💳 المتبقّي عند الحضور: 150 ر.س</span>
  </div>
</div>`,

  // ===== الشريحة 4 — حالة الدفع والتحصيل =====
  `<div class="tour-screen">

  <div class="stats-grid mb-md">
    <div class="stat-card">
      <div class="stat-card-head">
        <span class="stat-icon-chip"><i data-lucide="clipboard-list"></i></span>
        <span class="stat-label">عدد الحجوزات</span>
      </div>
      <div class="stat-value">6</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-head">
        <span class="stat-icon-chip stat-icon-chip--accent"><i data-lucide="banknote"></i></span>
        <span class="stat-label">إجمالي الإيرادات</span>
      </div>
      <div class="stat-value">1,700 ر.س</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-head">
        <span class="stat-icon-chip stat-icon-chip--accent"><i data-lucide="circle-check"></i></span>
        <span class="stat-label">المدفوع</span>
      </div>
      <div class="stat-value text-success tour-swap tour-swap--snap tour-commit">
        <span class="tour-layer tour-layer--was">1,275 ر.س</span>
        <span class="tour-layer tour-layer--now">1,425 ر.س</span>
      </div>
      <div class="stat-sub tour-swap tour-swap--snap">
        <span class="tour-layer tour-layer--was">المتبقي 425 ر.س</span>
        <span class="tour-layer tour-layer--now">المتبقي 275 ر.س</span>
      </div>
    </div>
  </div>

  <div class="table-wrapper cards-only as-cards">
    <table class="table table--cards">
      <thead>
        <tr>
          <th>التاريخ والوقت</th>
          <th>السعر</th>
          <th>المدفوع</th>
          <th>الحالة</th>
          <th class="actions-cell"></th>
        </tr>
      </thead>
      <tbody>
        <tr data-status="confirmed">
          <td data-label="التاريخ والوقت">15 أغسطس 2026 - 8:00 م</td>
          <td data-label="السعر" class="tabular-nums">150 ر.س</td>
          <td data-label="المدفوع" class="tabular-nums cell-paid">
            <span class="tour-swap tour-swap--snap">
              <span class="tour-layer tour-layer--was">0 ر.س</span>
              <span class="tour-layer tour-layer--now">150 ر.س</span>
            </span>
            <span class="tour-swap">
              <span class="pay-band is-unpaid tour-layer tour-layer--was"><i data-lucide="circle-alert"></i> غير مدفوع · يتبقّى 150 ر.س</span>
              <span class="pay-band is-paid tour-layer tour-layer--now"><i data-lucide="check-check"></i> مدفوع</span>
            </span>
          </td>
          <td data-label="الحالة" class="card-tag"><span class="chip-status chip-status--confirmed">حجز مؤكد</span></td>
          <td class="actions-cell">
            <div class="tour-swap">
              <div class="actions-inline tour-layer tour-layer--was">
                <button type="button" class="btn btn--xs btn--accent-quiet" tabindex="-1" title="تسجيل دفعة">
                  <i data-lucide="banknote"></i><span class="btn-label">تحصيل</span>
                </button>
                <button type="button" class="btn btn--xs btn--ghost" tabindex="-1" title="تعديل">
                  <i data-lucide="pencil"></i><span class="btn-label">تعديل الحجز</span>
                </button>
              </div>
              <div class="actions-inline tour-layer tour-layer--now">
                <button type="button" class="btn btn--xs btn--ghost" tabindex="-1" title="تعديل">
                  <i data-lucide="pencil"></i><span class="btn-label">تعديل الحجز</span>
                </button>
              </div>
            </div>
            <span class="tour-tap tour-tap--collect" aria-hidden="true"></span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="modal-backdrop tour-modal" aria-hidden="true">
    <div class="modal" role="dialog" aria-modal="true" aria-label="تسجيل دفعة">
      <div class="modal-header">
        <h3>تسجيل دفعة</h3>
        <button type="button" class="modal-close" aria-label="إغلاق" tabindex="-1"><i data-lucide="x"></i></button>
      </div>
      <div class="modal-body">
        <div class="tour-paybox">
          <div class="tour-payrow"><span class="text-muted">الإجمالي</span><span class="tabular-nums">150 ر.س</span></div>
          <div class="tour-payrow"><span class="text-muted">المدفوع سابقاً</span><span class="tabular-nums">0 ر.س</span></div>
          <div class="tour-paysep"></div>
          <div class="tour-payrow"><span class="text-muted">المتبقّي</span><span class="tabular-nums tour-payrow__strong">150 ر.س</span></div>
        </div>
        <div class="tour-tapwrap">
          <button type="button" class="btn btn--primary btn--block" tabindex="-1">
            <i data-lucide="check-check"></i> تحصيل كامل المبلغ (150 ر.س)
          </button>
          <span class="tour-tap tour-tap--full" aria-hidden="true"></span>
        </div>
      </div>
    </div>
  </div>

</div>`,

  // ===== الشريحة 5 — لوحة اليوم =====
  `<div class="tour-fit">
  <div class="tour-scene" aria-hidden="true">

    <div class="tour-kpi">

      <div class="kpi-strip tour-layer tour-layer--skel">
        <div class="kpi-cell">
          <div class="skeleton skeleton-line" style="width:52px;height:9px"></div>
          <div class="skeleton skeleton-line" style="width:78px;height:20px;margin-top:var(--space-2)"></div>
          <div class="skeleton skeleton-line" style="width:64px;height:8px;margin-top:var(--space-2)"></div>
        </div>
        <div class="kpi-cell">
          <div class="skeleton skeleton-line" style="width:52px;height:9px"></div>
          <div class="skeleton skeleton-line" style="width:78px;height:20px;margin-top:var(--space-2)"></div>
          <div class="skeleton skeleton-line" style="width:64px;height:8px;margin-top:var(--space-2)"></div>
        </div>
        <div class="kpi-cell">
          <div class="skeleton skeleton-line" style="width:52px;height:9px"></div>
          <div class="skeleton skeleton-line" style="width:78px;height:20px;margin-top:var(--space-2)"></div>
          <div class="skeleton skeleton-line" style="width:64px;height:8px;margin-top:var(--space-2)"></div>
        </div>
      </div>

      <div class="kpi-strip tour-layer tour-layer--live">
        <div class="kpi-cell">
          <div class="kpi-label">إيرادات اليوم</div>
          <div class="kpi-value">1,700<span class="kpi-unit">ر.س</span></div>
          <div class="kpi-sub"><span class="kpi-flag">275 ر.س غير محصّل</span></div>
        </div>

        <div class="kpi-cell">
          <div class="kpi-label">الإشغال اليوم</div>
          <div class="tour-swap">
            <div class="kpi-value tour-before">—</div>
            <div class="kpi-value tour-after">44<span class="kpi-unit">%</span></div>
          </div>
          <div class="tour-swap">
            <div class="kpi-sub tour-before">لا جداول عمل لليوم</div>
            <div class="kpi-sub tour-after">7 من 16 موعداً</div>
          </div>
          <div class="stat-bar tour-after-bar">
            <span class="stat-bar-seg stat-bar-seg--success" style="width:44%"></span>
          </div>
        </div>

        <div class="kpi-cell">
          <div class="kpi-label">حجوزات اليوم</div>
          <div class="kpi-value">7</div>
          <div class="stat-bar">
            <span class="stat-bar-seg stat-bar-seg--success" style="width:42.857142857142854%"></span>
            <span class="stat-bar-seg stat-bar-seg--muted" style="width:57.14285714285714%"></span>
          </div>
          <div class="kpi-legend">
            <span><span class="dot" style="background:var(--success)"></span>مؤكد 3</span>
            <span><span class="dot" style="background:var(--border-strong)"></span>مكتمل 4</span>
          </div>
        </div>
      </div>

    </div>

    <div class="card mb-md tour-today">
      <div class="card-header">
        <h3>جدول اليوم</h3>
        <span class="card-header-meta">3 متبقٍّ من 7</span>
      </div>

      <button type="button" class="timeline-past-toggle" tabindex="-1" aria-expanded="false">
        <i data-lucide="chevron-down"></i>
        <span>4 مواعيد انقضت</span>
      </button>

      <div class="timeline-list">
        <div class="timeline-row is-clickable" data-status="confirmed">
          <div class="timeline-time">
            <span class="timeline-time-from">6:00 م</span>
            <span class="timeline-time-sep">→</span>
            <span class="timeline-time-to">7:00 م</span>
          </div>
          <div class="timeline-main">
            <div class="timeline-customer">محمد العتيبي</div>
            <div class="timeline-field">الملعب الرئيسي</div>
          </div>
          <div class="timeline-side">
            <span class="chip-status chip-status--confirmed">حجز مؤكد</span>
            <span class="timeline-price">250 ر.س</span>
          </div>
        </div>
        <div class="timeline-row is-clickable" data-status="confirmed">
          <div class="timeline-time">
            <span class="timeline-time-from">8:00 م</span>
            <span class="timeline-time-sep">→</span>
            <span class="timeline-time-to">9:00 م</span>
          </div>
          <div class="timeline-main">
            <div class="timeline-customer">فريق الصقور</div>
            <div class="timeline-field">الملعب رقم 2</div>
          </div>
          <div class="timeline-side">
            <span class="chip-status chip-status--confirmed">حجز مؤكد</span>
            <span class="timeline-price">250 ر.س</span>
          </div>
        </div>
        <div class="timeline-row is-clickable" data-status="confirmed">
          <div class="timeline-time">
            <span class="timeline-time-from">9:00 م</span>
            <span class="timeline-time-sep">→</span>
            <span class="timeline-time-to">10:00 م</span>
          </div>
          <div class="timeline-main">
            <div class="timeline-customer">ماجد الحربي</div>
            <div class="timeline-field">الملعب الرئيسي</div>
          </div>
          <div class="timeline-side">
            <span class="chip-status chip-status--confirmed">حجز مؤكد</span>
            <span class="timeline-price">300 ر.س</span>
          </div>
        </div>
      </div>
    </div>

  </div>
</div>`,

  // ===== الشريحة 6 — بطاقة الولاء والختم بموافقتك =====
  `<!-- بطاقة المحفظة — بنية .wcard كما في card.js:60-74 (وجه العميل)، وكتلة العدّاد
     من program.js:628-634 لأنها وحدها تحمل <bdi dir="ltr"> الذي يمنع قلب «7 / 10».
     الألوان هي افتراضات card.js:39-41 نفسها. -->
<div class="wcard" style="--wc-bg:#0F3D2E;--wc-fg:#FFFFFF;--wc-label:#C9D6CF">
  <div class="wcard-top">
    <div class="wcard-logo"><span>م</span></div>
    <div class="wcard-org">
      <div class="wcard-org-name">ملاعب النخبة</div>
      <div class="wcard-org-by">بواسطة مَرمى</div>
    </div>
    <div class="wcard-header">
      <div class="wcard-mini-label">الأختام</div>
      <div class="wcard-mini-value">
        <span class="tour-count">
          <bdi dir="ltr" class="tour-count--was" aria-hidden="true">6 / 10</bdi>
          <bdi dir="ltr" class="tour-count--now">7 / 10</bdi>
        </span>
      </div>
    </div>
  </div>

  <!-- ١٠ نقاط: ستّ ممتلئة، ثم السابعة بطبقتيها، ثم ثلاث فارغة.
       الشريط ينزف إلى الحافّتين بهامش سالب = ‎--wc-pad (loyalty.css:261). -->
  <div class="wcard-strip wcard-strip--stamps">
    <span class="wcard-dot is-filled"></span>
    <span class="wcard-dot is-filled"></span>
    <span class="wcard-dot is-filled"></span>
    <span class="wcard-dot is-filled"></span>
    <span class="wcard-dot is-filled"></span>
    <span class="wcard-dot is-filled"></span>
    <span class="tour-dot7">
      <span class="wcard-dot"></span>
      <span class="wcard-dot is-filled"></span>
      <span class="tour-ring" aria-hidden="true"></span>
    </span>
    <span class="wcard-dot"></span>
    <span class="wcard-dot"></span>
    <span class="wcard-dot"></span>
  </div>
</div>

<!-- موضع محجوز الارتفاع: الصفّ ينطوي داخله فلا ترتفع البطاقة ولا يقفز النصّ -->
<div class="tour-slot">
  <div class="stamp-reqs">
    <div class="stamp-req">
      <div class="stamp-req-main">
        <div class="stamp-req-name">فهد الدوسري</div>
        <div class="stamp-req-meta">
          <span><i data-lucide="goal"></i>الأرضية الشمالية</span>
          <span><i data-lucide="calendar"></i>12 أغسطس</span>
        </div>
      </div>
      <div class="stamp-req-count">
        <bdi dir="ltr">6 / 10</bdi>
        <small>الرصيد الآن</small>
      </div>
      <div class="stamp-req-actions">
        <button type="button" tabindex="-1" class="btn btn--primary btn--sm tour-approve">
          <i data-lucide="check"></i><span>وافق</span>
          <span class="tour-tap" aria-hidden="true"></span>
        </button>
        <button type="button" tabindex="-1" class="btn btn--danger-quiet btn--sm">
          <i data-lucide="x"></i><span>ارفض</span>
        </button>
      </div>
    </div>
  </div>

  <!-- حالة الفراغ الحقيقية من stamps.js:48-52 — هي ما يرسمه النظام حين يخلو الصفّ -->
  <div class="empty-state">
    <div class="empty-icon"><i data-lucide="check-check"></i></div>
    <h3>لا طلبات معلّقة</h3>
  </div>
</div>`
];
