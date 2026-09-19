// اختبار منطق التسعير — يعمل بـ node بلا تبعيات:  npm test
// يحمّل src/features/subscriptions/pricing.js داخل window وهمي ويؤكّد النتائج.
// يجب أن يبقى متطابقاً مع حساب الخادم في request_subscription.
//
// النموذج المُختبَر: سعر موحّد 99 ر.س/شهر شامل كل شيء — أرضيات وموظفون بلا حدّ،
// وسعر الوحدة الإضافية صفر، فالترقية لا تكلّف شيئاً.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(join(__dirname, '..', 'src', 'features', 'subscriptions', 'pricing.js'), 'utf8');
const win = {};
// eslint-disable-next-line no-new-func
new Function('window', code)(win);
const P = win.pricing;

let failed = 0;
function eq(actual, expected, label) {
  if (actual === expected) { console.log(`✅ ${label}`); }
  else { failed++; console.error(`❌ ${label}: توقّع ${expected} — النتيجة ${actual}`); }
}

// ── الثوابت المعلنة ──
eq(P.BASE_PRICE, 99, 'السعر المعلن = 99');
eq(P.UNIT_PRICE, 0,  'لا رسوم لأي وحدة إضافية');
eq(P.TRIAL_DAYS, 30, 'التجربة 30 يوماً — تطابق create_owner_tenant');

// ── الشهر الكامل (تجديد/جديد): 99 مهما بلغت الأعداد ──
eq(P.calcPrice(1, 1),    99, 'أرضية + موظف = 99');
eq(P.calcPrice(1, 0),    99, 'بلا موظفين = 99');
eq(P.calcPrice(2, 1),    99, '2 أرضية = 99 (بلا إضافة)');
eq(P.calcPrice(5, 3),    99, '5 أرضية + 3 موظف = 99');
eq(P.calcPrice(1, 5),    99, 'أرضية + 5 موظف = 99');
eq(P.calcPrice(50, 50),  99, '50 أرضية + 50 موظف = 99 — بلا حدّ');
eq(P.calcPrice(0, 0),    99, 'أعداد صفرية تسقط للحدّ الأدنى = 99');

// ── الترقية التفاضلية (proration) — صفر دائماً: لا شيء يُشترى بالوحدة ──
eq(P.upgradeCost(1, 30), 0, 'وحدة · دورة كاملة = 0');
eq(P.upgradeCost(1, 15), 0, 'وحدة · نصف دورة = 0');
eq(P.upgradeCost(9, 30), 0, '9 وحدات · دورة كاملة = 0');
eq(P.upgradeCost(0, 30), 0, 'صفر وحدات = 0');
eq(P.upgradeCost(5, 0),  0, 'صفر أيام = 0');

// ── تطابق الملخّص مع الإجمالي ──
eq(P.upgradeBreakdown(1, 1, 15).total, P.upgradeCost(2, 15), 'breakdown.total = upgradeCost(مجموع)');
eq(P.upgradeBreakdown(2, 0, 30).total, 0, '2 أرضية · دورة كاملة = 0');
eq(P.upgradeBreakdown(0, 1, 30).total, 0, 'موظف واحد · دورة كاملة = 0');
eq(P.upgradeBreakdown(1, 1, 15).units, 2, 'عدد الوحدات المضافة = 2');

// ── ملخّص الفاتورة الشهرية: سطر واحد باسم الباقة، بلا أسطر صفرية ──
eq(P.breakdown(1, 1).total, 99, 'breakdown.total = 99');
eq(P.breakdown(9, 9).total, 99, 'breakdown.total = 99 مهما بلغت الأعداد');
eq(P.breakdown(1, 1).lines.length, 1, 'سطر واحد فقط (1+1)');
eq(P.breakdown(9, 9).lines.length, 1, 'سطر واحد فقط — لا «أرضية إضافية» بصفر');
eq(P.breakdown(9, 9).lines[0].amount, 99, 'مبلغ السطر = 99');
eq(P.breakdown(9, 9).lines.some((l) => l.amount === 0), false, 'لا سطر بمبلغ صفر');

if (failed) { console.error(`\n${failed} اختبار فشل ❌`); process.exit(1); }
console.log('\nكل اختبارات التسعير نجحت ✅');
