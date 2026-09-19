// ثوابت التسعير — المصدر الوحيد للحقيقة.
// أي تغيير في النموذج التجاري يبدأ من هنا.
//
// النموذج (سعر موحّد شامل):
//   - تجربة 30 يومًا: مجاناً، كل المميزات مفتوحة بلا حدود
//   - الاشتراك: 99 ر.س/شهر شامل كل شيء — أرضيات وموظفون بلا حدّ
//   - لا رسوم لكل وحدة إضافية (UNIT_PRICE = 0)، فالترقية لا تكلّف شيئاً
//   - عملاء التأسيس (أول 10) مجمّدون على 66 ر.س، محفوظة على الخادم في
//     tenants.monthly_price؛ هذا الملف يحمل السعر المعلن فقط.

window.pricing = (function () {
  const BASE_PRICE = 99;             // الاشتراك الشهري الشامل
  const UNIT_PRICE = 0;              // لا رسوم لأي وحدة إضافية (أرضية أو موظف)
  const DURATION_DAYS = 30;          // مدة دورة الاشتراك
  const TRIAL_DAYS = 30;             // يطابق create_owner_tenant في قاعدة البيانات

  const INCLUDED = { fields: 1, staff: 1 };
  const TRIAL    = { fields: 1, staff: 0 };

  // يحسب المبلغ الشهري بناءً على عدد الأرضيات والموظفين
  function calcPrice(fields, staff) {
    const f = Math.max(1, Number(fields) || 1);
    const s = Math.max(0, Number(staff)  || 0);
    const extraFields = Math.max(0, f - INCLUDED.fields);
    const extraStaff  = Math.max(0, s - INCLUDED.staff);
    return BASE_PRICE + (extraFields + extraStaff) * UNIT_PRICE;
  }

  // ملخّص فقرات الفاتورة (لعرضها للمستخدم قبل الإرسال)
  function breakdown(fields, staff) {
    const f = Math.max(1, Number(fields) || 1);
    const s = Math.max(0, Number(staff)  || 0);
    const extraFields = Math.max(0, f - INCLUDED.fields);
    const extraStaff  = Math.max(0, s - INCLUDED.staff);
    const lines = [
      { label: 'الباقة الأساسية', amount: BASE_PRICE }
    ];
    // الأسطر الإضافية تُعرض فقط إن كان لها مبلغ فعلي — بالسعر الشامل لا تظهر
    const extraFieldsAmount = extraFields * UNIT_PRICE;
    const extraStaffAmount  = extraStaff  * UNIT_PRICE;
    if (extraFieldsAmount > 0) {
      lines.push({ label: `+${extraFields} أرضية إضافية`, amount: extraFieldsAmount });
    }
    if (extraStaffAmount > 0) {
      lines.push({ label: `+${extraStaff} موظف إضافي`, amount: extraStaffAmount });
    }
    return { lines, total: calcPrice(f, s) };
  }

  // ترقية فورية (proration): سعر الوحدات المضافة للأيام المتبقّية فقط (بلا تمديد).
  //   السعر = الوحدات المضافة × سعر الوحدة × (الأيام المتبقّية ÷ مدة الدورة) — مُقرَّب لأقرب ريال.
  //   بالسعر الشامل (UNIT_PRICE = 0) النتيجة صفر دائماً: الترقية مجانية.
  function upgradeCost(addedUnits, remainingDays) {
    const u = Math.max(0, Number(addedUnits)    || 0);
    const d = Math.max(0, Number(remainingDays) || 0);
    return Math.round(u * UNIT_PRICE * d / DURATION_DAYS);
  }

  // ملخّص فاتورة الترقية (سطر واحد + الإجمالي) — يطابق ما يحسبه الخادم.
  function upgradeBreakdown(addedFields, addedStaff, remainingDays) {
    const af = Math.max(0, Number(addedFields)  || 0);
    const as = Math.max(0, Number(addedStaff)   || 0);
    const d  = Math.max(0, Number(remainingDays) || 0);
    const units = af + as;
    const total = upgradeCost(units, d);
    const parts = [];
    if (af > 0) parts.push(`${af} أرضية`);
    if (as > 0) parts.push(`${as} موظف`);
    const lines = [
      { label: `${parts.join(' + ') || 'وحدات'} إضافية × ${d} يوم متبقٍ (من ${DURATION_DAYS})`, amount: total }
    ];
    return { lines, total, days: d, units };
  }

  return {
    BASE_PRICE,
    UNIT_PRICE,
    DURATION_DAYS,
    TRIAL_DAYS,
    INCLUDED,
    TRIAL,
    calcPrice,
    breakdown,
    upgradeCost,
    upgradeBreakdown
  };
})();
