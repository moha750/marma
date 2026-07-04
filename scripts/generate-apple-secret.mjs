// يولّد "سرّ العميل" (client secret JWT) لـ Sign in with Apple — محليًّا بلا تبعيات.
// المفتاح الخاص (.p8) يبقى على جهازك ولا يُرفع (محميّ في .gitignore).
//
// الاستخدام:
//   1) ضع ملف .p8 (AuthKey_XXXX.p8) في جذر المشروع، أو اضبط P8_FILE بمساره الكامل.
//   2) مرّر معرّفاتك عبر متغيّرات البيئة (لا تُثبَّت في المستودع):
//        APPLE_TEAM_ID=xxxxxxxxxx APPLE_KEY_ID=xxxxxxxxxx \
//        APPLE_SERVICES_ID=your.services.id APPLE_P8=./AuthKey_XXXX.p8 \
//        node scripts/generate-apple-secret.mjs
//      أو عدّل قيم fallback أدناه محليًّا (لا ترفع تعديلك).
//   3) انسخ الـ JWT المطبوع إلى Supabase → Auth → Providers → Apple → Secret Key (for OAuth).
//
// ملاحظة: سرّ أبل صالح 6 أشهر كحدّ أقصى — أعد تشغيل هذا السكربت لتجديده قبل انتهائه.

import { readFileSync } from 'node:fs';
import { createPrivateKey, sign as cryptoSign } from 'node:crypto';

// ── معرّفاتك: من متغيّرات البيئة أوّلًا، وإلّا عدّل placeholders محليًّا ──
const TEAM_ID     = process.env.APPLE_TEAM_ID     || 'YOUR_TEAM_ID';       // Team ID (10 أحرف)
const KEY_ID      = process.env.APPLE_KEY_ID      || 'YOUR_KEY_ID';        // Key ID (10 أحرف، بجانب المفتاح)
const SERVICES_ID = process.env.APPLE_SERVICES_ID || 'your.services.id';   // Services ID (Client ID)
const P8_FILE     = process.env.APPLE_P8          || './AuthKey_YOUR_KEY_ID.p8'; // مسار ملف المفتاح .p8
// ──────────────────────────────────────────────────────

if ([TEAM_ID, KEY_ID, SERVICES_ID].some((v) => v.startsWith('YOUR_') || v === 'your.services.id')) {
  console.error('\n❌ لم تُضبَط المعرّفات. مرّرها عبر متغيّرات البيئة (APPLE_TEAM_ID …) أو عدّل قيم fallback.\n');
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const exp = now + 180 * 24 * 60 * 60; // 180 يوماً (أقصى ما تسمح به أبل)

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const header  = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' };
const payload = { iss: TEAM_ID, iat: now, exp, aud: 'https://appleid.apple.com', sub: SERVICES_ID };

const signingInput = b64url(header) + '.' + b64url(payload);

let privateKey;
try {
  privateKey = createPrivateKey(readFileSync(P8_FILE));
} catch (err) {
  console.error('\n❌ تعذّر قراءة ملف .p8 من:', P8_FILE);
  console.error('   تأكّد من المسار واسم الملف.\n', err.message);
  process.exit(1);
}

// توقيع ES256 بصيغة JOSE (raw R||S) — لا DER
const signature = cryptoSign('sha256', Buffer.from(signingInput), {
  key: privateKey,
  dsaEncoding: 'ieee-p1363'
}).toString('base64url');

const jwt = signingInput + '.' + signature;

console.log('\n✅ Apple client secret (JWT) — الصقه في Supabase → Apple → Secret Key (for OAuth):\n');
console.log(jwt);
console.log('\nصالح حتى:', new Date(exp * 1000).toLocaleString('ar'), '\n');
