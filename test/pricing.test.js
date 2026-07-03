// اختبار منطق التسعير — يعمل بـ node بلا تبعيات:  npm test
// يحمّل src/features/subscriptions/pricing.js داخل window وهمي ويؤكّد النتائج.
// يجب أن يبقى متطابقاً مع حساب الخادم في request_subscription.
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

// ── الشهر الكامل (تجديد/جديد) ──
eq(P.calcPrice(1, 1), 200, 'الأساسية 1+1 = 200');
eq(P.calcPrice(1, 0), 200, 'موظف 0 لا يُخصم تحت المتضمّن');
eq(P.calcPrice(2, 1), 250, '2 أرضية = 200 + 50');
eq(P.calcPrice(5, 3), 500, '5 أرضية + 3 موظف = 200 + 6×50');
eq(P.calcPrice(1, 5), 400, '1 أرضية + 5 موظف = 200 + 4×50');

// ── الترقية التفاضلية (proration) — تطابق الخادم: round(units × 50 × days ÷ 30) ──
eq(P.upgradeCost(1, 30), 50, 'وحدة · دورة كاملة = 50');
eq(P.upgradeCost(1, 15), 25, 'وحدة · نصف دورة = 25');
eq(P.upgradeCost(2, 15), 50, 'وحدتان · نصف دورة = 50');
eq(P.upgradeCost(1, 18), 30, 'وحدة · 18 يوم = 30');
eq(P.upgradeCost(1, 1), 2, 'وحدة · يوم واحد = 2 (تقريب 1.67)');
eq(P.upgradeCost(3, 10), 50, '3 وحدات · 10 أيام = 50');
eq(P.upgradeCost(0, 30), 0, 'صفر وحدات = 0');
eq(P.upgradeCost(5, 0), 0, 'صفر أيام = 0');

// ── تطابق الملخّص مع الإجمالي ──
eq(P.upgradeBreakdown(1, 1, 15).total, P.upgradeCost(2, 15), 'breakdown.total = upgradeCost(مجموع)');
eq(P.upgradeBreakdown(2, 0, 30).total, 100, '2 أرضية · دورة كاملة = 100');
eq(P.upgradeBreakdown(0, 1, 30).total, 50, 'موظف واحد · دورة كاملة = 50');
eq(P.upgradeBreakdown(1, 1, 15).units, 2, 'عدد الوحدات المضافة = 2');

if (failed) { console.error(`\n${failed} اختبار فشل ❌`); process.exit(1); }
console.log('\nكل اختبارات التسعير نجحت ✅');
