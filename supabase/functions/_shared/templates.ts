// قوالب HTML للبريد — مبنية بهوية مَرمى من styles/tokens.css
//
// قواعد التصميم:
//   • table-based layout — لتوافق مع كل عملاء البريد (Gmail/Outlook/Apple Mail)
//   • inline styles فقط — لا CSS خارجي ولا @media reliable
//   • RTL: dir="rtl" على <html> + text-align: right
//   • خط: IBM Plex Sans Arabic مع fallback لخطوط النظام
//   • العلامة كنص (لا SVG) لتجنب مشاكل العرض في Outlook
//
// الألوان مأخوذة من styles/tokens.css:
//   --accent-500: #0F9D58  (الفعل)
//   --accent-600: #0B7D45
//   --surface-1:  #FFFFFF
//   --surface-2:  #F4F4EF
//   --text-primary:   #14160F
//   --text-secondary: #555651
//   --border-subtle:  #EAEAE4

const FONT_STACK = "'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, Arial, sans-serif";
const ACCENT = "#0F9D58";
const ACCENT_DARK = "#0B7D45";
const TEXT_PRIMARY = "#14160F";
const TEXT_SECONDARY = "#555651";
const SURFACE_BODY = "#F4F4EF";
const SURFACE_CARD = "#FFFFFF";
const BORDER_SUBTLE = "#EAEAE4";

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface ShellParams {
  preheader: string;
  bodyHtml: string;
}

function shell({ preheader, bodyHtml }: ShellParams): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>مَرمى</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${SURFACE_BODY};font-family:${FONT_STACK};">
  <span style="display:none;font-size:0;line-height:0;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${SURFACE_BODY};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${SURFACE_CARD};border:1px solid ${BORDER_SUBTLE};border-radius:12px;overflow:hidden;">
          <tr>
            <td align="center" style="padding:28px 32px 12px;border-bottom:1px solid ${BORDER_SUBTLE};">
              <div dir="rtl" style="font-family:${FONT_STACK};font-size:28px;font-weight:700;color:${ACCENT};letter-spacing:-0.5px;line-height:1;">مَرمى</div>
              <div dir="rtl" style="font-family:${FONT_STACK};font-size:12px;font-weight:500;color:${TEXT_SECONDARY};margin-top:6px;">إدارة ملاعب كرة القدم</div>
            </td>
          </tr>
          <tr>
            <td dir="rtl" style="padding:32px;font-family:${FONT_STACK};color:${TEXT_PRIMARY};font-size:15px;line-height:1.7;text-align:right;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td dir="rtl" align="center" style="padding:20px 32px;background:${SURFACE_BODY};border-top:1px solid ${BORDER_SUBTLE};font-family:${FONT_STACK};font-size:12px;color:${TEXT_SECONDARY};line-height:1.6;">
              تم إرسال هذه الرسالة من نظام مَرمى.<br>
              إن لم تكن تتوقع هذه الرسالة، يمكنك تجاهلها بأمان.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function ctaButton(label: string, href: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
      <tr>
        <td align="center" style="border-radius:8px;background:${ACCENT};">
          <a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:13px 28px;font-family:${FONT_STACK};font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px;background:${ACCENT};">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>`;
}

function detailRow(label: string, value: string): string {
  return `
    <tr>
      <td dir="rtl" style="padding:8px 0;font-family:${FONT_STACK};font-size:13px;color:${TEXT_SECONDARY};width:35%;vertical-align:top;">${escapeHtml(label)}</td>
      <td dir="rtl" style="padding:8px 0;font-family:${FONT_STACK};font-size:14px;color:${TEXT_PRIMARY};font-weight:500;">${escapeHtml(value)}</td>
    </tr>`;
}

// ─── 1) تأكيد البريد عند التسجيل ────────────────────────────

export interface SignupConfirmationParams {
  fullName: string;
  verifyUrl: string;
}

export function signupConfirmation({ fullName, verifyUrl }: SignupConfirmationParams) {
  const greeting = fullName ? `أهلاً ${fullName}،` : "أهلاً بك،";
  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-family:${FONT_STACK};font-size:22px;font-weight:700;color:${TEXT_PRIMARY};line-height:1.3;">مرحباً بك في مَرمى</h1>
    <p style="margin:0 0 12px;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 16px;">شكراً لانضمامك. لإكمال إنشاء حسابك وتفعيل تجربتك المجانية، يرجى تأكيد بريدك الإلكتروني بالضغط على الزر أدناه.</p>
    ${ctaButton("تأكيد البريد الإلكتروني", verifyUrl)}
    <div style="margin-top:24px;padding:16px;background:${SURFACE_BODY};border-radius:8px;border:1px solid ${BORDER_SUBTLE};">
      <div style="font-weight:600;color:${TEXT_PRIMARY};margin-bottom:6px;">تجربة مجانية لمدة 3 أيام</div>
      <div style="font-size:13px;color:${TEXT_SECONDARY};">ستحصل على ملعب واحد لتجربة كامل ميزات النظام. بعد انتهاء التجربة يمكنك الاشتراك بـ 200 ريال شهرياً.</div>
    </div>
    <p style="margin:24px 0 0;font-size:13px;color:${TEXT_SECONDARY};">إن لم يعمل الزر، انسخ الرابط التالي والصقه في المتصفح:</p>
    <p style="margin:8px 0 0;font-size:12px;color:${ACCENT_DARK};word-break:break-all;direction:ltr;text-align:left;">${escapeHtml(verifyUrl)}</p>`;

  return {
    subject: "تأكيد بريدك الإلكتروني — مَرمى",
    html: shell({ preheader: "أكّد بريدك لتفعيل حسابك في مَرمى وابدأ تجربتك المجانية", bodyHtml }),
  };
}

// ─── 2) إشعار حجز جديد للمالك ────────────────────────────────

export interface NewBookingNotificationParams {
  ownerName: string;
  tenantName: string;
  fieldName: string;
  customerName: string;
  customerPhone: string;
  startTime: string;  // ISO
  endTime: string;    // ISO
  totalPrice: number;
  dashboardUrl: string;
}

export function newBookingNotification(p: NewBookingNotificationParams) {
  const greeting = p.ownerName ? `أهلاً ${p.ownerName}،` : "أهلاً،";
  const start = new Date(p.startTime);
  const end = new Date(p.endTime);

  const dateLabel = start.toLocaleDateString("ar-SA-u-nu-latn", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const timeLabel = `${start.toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit", hour12: true })} — ${end.toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit", hour12: true })}`;
  const priceLabel = `${p.totalPrice.toLocaleString("ar-SA-u-nu-latn")} ر.س`;

  const bodyHtml = `
    <div style="display:inline-block;padding:4px 10px;background:#FCEFD9;color:#C77700;border-radius:999px;font-size:12px;font-weight:600;margin-bottom:12px;">بانتظار التأكيد</div>
    <h1 style="margin:0 0 16px;font-family:${FONT_STACK};font-size:22px;font-weight:700;color:${TEXT_PRIMARY};line-height:1.3;">حجز جديد على ${escapeHtml(p.tenantName)}</h1>
    <p style="margin:0 0 20px;">${escapeHtml(greeting)} وصلك طلب حجز جديد عبر الرابط العام. راجع التفاصيل وأكّد الحجز.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${SURFACE_BODY};border:1px solid ${BORDER_SUBTLE};border-radius:8px;padding:16px 20px;margin-bottom:16px;">
      ${detailRow("الملعب", p.fieldName)}
      ${detailRow("التاريخ", dateLabel)}
      ${detailRow("الوقت", timeLabel)}
      ${detailRow("العميل", p.customerName)}
      ${detailRow("الجوال", p.customerPhone)}
      ${detailRow("المبلغ", priceLabel)}
    </table>
    ${ctaButton("افتح لوحة الحجوزات", p.dashboardUrl)}`;

  return {
    subject: `حجز جديد — ${p.fieldName} (${p.customerName})`,
    html: shell({ preheader: `طلب حجز جديد من ${p.customerName} على ${p.fieldName}`, bodyHtml }),
  };
}

// ─── 3) دعوة موظف ───────────────────────────────────────────

export interface StaffInvitationParams {
  recipientName: string;
  tenantName: string;
  signupUrl: string;
  expiresAt: string;  // ISO
}

export function staffInvitation(p: StaffInvitationParams) {
  const greeting = p.recipientName ? `أهلاً ${p.recipientName}،` : "أهلاً،";
  const expires = new Date(p.expiresAt);
  const expiresLabel = expires.toLocaleDateString("ar-SA-u-nu-latn", {
    year: "numeric", month: "long", day: "numeric",
  });

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-family:${FONT_STACK};font-size:22px;font-weight:700;color:${TEXT_PRIMARY};line-height:1.3;">دعوة للانضمام إلى ${escapeHtml(p.tenantName)}</h1>
    <p style="margin:0 0 12px;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 20px;">تمت دعوتك للانضمام كموظف في <strong>${escapeHtml(p.tenantName)}</strong> على نظام مَرمى لإدارة حجوزات الملعب. اضغط الزر أدناه لإنشاء حسابك.</p>
    ${ctaButton("قبول الدعوة وإنشاء حساب", p.signupUrl)}
    <div style="margin-top:24px;padding:14px 16px;background:${SURFACE_BODY};border-radius:8px;border:1px solid ${BORDER_SUBTLE};font-size:13px;color:${TEXT_SECONDARY};">
      <strong style="color:${TEXT_PRIMARY};">ملاحظة:</strong> هذه الدعوة صالحة حتى ${escapeHtml(expiresLabel)}.
    </div>
    <p style="margin:24px 0 0;font-size:13px;color:${TEXT_SECONDARY};">إن لم يعمل الزر، انسخ الرابط التالي والصقه في المتصفح:</p>
    <p style="margin:8px 0 0;font-size:12px;color:${ACCENT_DARK};word-break:break-all;direction:ltr;text-align:left;">${escapeHtml(p.signupUrl)}</p>`;

  return {
    subject: `دعوة للانضمام إلى ${p.tenantName} على مَرمى`,
    html: shell({ preheader: `${p.tenantName} يدعوك للانضمام كموظف على مَرمى`, bodyHtml }),
  };
}
