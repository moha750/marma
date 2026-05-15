// ثوابت التسعير — المصدر الوحيد للحقيقة.
// أي تغيير في النموذج التجاري يبدأ من هنا.
//
// النموذج:
//   - تجربة 3 أيام: مجاناً، 1 أرضية، 0 موظف
//   - الباقة الأساسية: 200 ر.س/شهر تشمل 1 أرضية + 1 موظف
//   - كل أرضية أو موظف إضافي: +50 ر.س/شهر

window.pricing = (function () {
  const BASE_PRICE = 200;            // الباقة الأساسية
  const UNIT_PRICE = 50;             // كل وحدة إضافية (أرضية أو موظف)
  const DURATION_DAYS = 30;          // مدة دورة الاشتراك
  const TRIAL_DAYS = 3;

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
      { label: `الباقة الأساسية (${INCLUDED.fields} أرضية + ${INCLUDED.staff} موظف)`, amount: BASE_PRICE }
    ];
    if (extraFields > 0) {
      lines.push({ label: `+${extraFields} أرضية إضافية`, amount: extraFields * UNIT_PRICE });
    }
    if (extraStaff > 0) {
      lines.push({ label: `+${extraStaff} موظف إضافي`, amount: extraStaff * UNIT_PRICE });
    }
    return { lines, total: calcPrice(f, s) };
  }

  return {
    BASE_PRICE,
    UNIT_PRICE,
    DURATION_DAYS,
    TRIAL_DAYS,
    INCLUDED,
    TRIAL,
    calcPrice,
    breakdown
  };
})();
