// تأكيد الحجز عبر واتساب — رسالة جاهزة تُفتح في محادثة العميل بنقرة واحدة.
// مشترك بين قائمة الحجوزات ونافذة الحجز حتى تكون التجربة واحدة من أي مكان يُؤكَّد منه الحجز.
window.bookingWhatsApp = (function () {
  // اسم المنشأة من سياق الـ layout إن لم يُمرَّر صراحةً
  function resolveVenueName(venueName) {
    if (venueName) return venueName;
    const ctx = window.layout && window.layout.getContext ? window.layout.getContext() : null;
    return (ctx && ctx.tenant && ctx.tenant.name) || '';
  }

  // رقم العميل بصيغة دولية (السعودية افتراضاً): 05XXXXXXXX → 9665XXXXXXXX
  function toIntlPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('966')) return digits;
    if (digits.startsWith('0'))   return '966' + digits.slice(1);
    return '966' + digits;
  }

  // نص رسالة تأكيد الحجز التي تُرسَل للعميل
  function buildMessage(b, venueName) {
    const venue     = resolveVenueName(venueName);
    const customer  = b.customers ? b.customers.full_name : '';
    const fieldName = b.fields ? b.fields.name : '';
    const lines = [];
    lines.push(`مرحباً ${customer || ''} 👋`.trim());
    lines.push(`تم تأكيد حجزك${venue ? ' في ' + venue : ''} ✅`);
    lines.push('');
    if (fieldName) lines.push(`🏟️ الأرضية: ${fieldName}`);
    lines.push(`📅 التاريخ: ${window.utils.formatDate(b.start_time)}`);
    lines.push(`🕐 الوقت: ${window.utils.formatTime(b.start_time)} - ${window.utils.formatTime(b.end_time)}`);
    lines.push(`⏱️ المدة: ${window.utils.formatDuration(window.utils.hoursBetween(b.start_time, b.end_time))}`);
    if (b.total_price != null && Number(b.total_price) > 0) {
      lines.push(`💰 الإجمالي: ${window.utils.formatCurrency(b.total_price)}`);
      const owed = window.utils.bookingOwed(b);
      if (owed != null && owed > 0) lines.push(`💳 المتبقّي عند الحضور: ${window.utils.formatCurrency(owed)}`);
      else lines.push('✅ مدفوع بالكامل');
    }
    lines.push('');
    lines.push('نتطلّع لرؤيتك! لأي استفسار لا تتردّد بالتواصل معنا.');
    return lines.join('\n');
  }

  // رابط واتساب جاهز برسالة التأكيد — null إذا لا يوجد رقم للعميل
  function buildUrl(b, venueName) {
    const intl = toIntlPhone(b.customers && b.customers.phone);
    if (!intl) return null;
    return `https://wa.me/${intl}?text=${encodeURIComponent(buildMessage(b, venueName))}`;
  }

  // تسجيل أن التأكيد أُرسل (تتبّع ثانوي — لا نُزعج الموظف إن فشل، فالرسالة فُتحت أصلاً)
  function markSent(booking) {
    return window.api.markWhatsAppConfirmed(booking.id).catch((e) => {
      console.warn('markWhatsAppConfirmed failed:', e);
    });
  }

  // بعد تأكيد الحجز: مودال يقترح إرسال رسالة واتساب للعميل.
  // الفتح يتمّ بنقرة الموظف على الرابط داخل المودال (داخل user gesture) فلا يحجبه المتصفح.
  // onSent: callback اختياري يُستدعى بعد تسجيل الإرسال (لتحديث القائمة).
  function offerConfirmation(booking, venueName, onSent) {
    const url = buildUrl(booking, venueName);
    if (!url) return; // لا رقم للعميل — لا شيء نرسله
    const name = booking.customers ? booking.customers.full_name : 'العميل';

    const body = document.createElement('div');
    body.innerHTML = `
      <div style="text-align:center">
        <div style="width:56px;height:56px;border-radius:50%;background:var(--success-tint);display:flex;align-items:center;justify-content:center;margin:0 auto var(--space-3)">
          <i data-lucide="check" style="color:var(--success);width:28px;height:28px"></i>
        </div>
        <p style="margin:0 0 var(--space-2)">تم تأكيد الحجز بنجاح.</p>
        <p class="text-muted text-sm" style="margin:0">أرسل رسالة تأكيد جاهزة إلى <strong>${window.utils.escapeHtml(name)}</strong> عبر واتساب.</p>
      </div>
    `;

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:8px;width:100%';
    footer.innerHTML = `
      <a class="btn btn--wa" style="flex:1;justify-content:center" href="${window.utils.escapeHtml(url)}" target="_blank" rel="noopener">
        <i data-lucide="message-circle"></i> تأكيد الحجز للعميل عبر واتساب
      </a>
      <button type="button" class="btn btn--ghost" data-action="later">لاحقاً</button>
    `;

    const ctrl = window.utils.openModal({ title: 'تأكيد الحجز', body, footer });
    footer.querySelector('[data-action="later"]').addEventListener('click', ctrl.close);
    footer.querySelector('a.btn--wa').addEventListener('click', () => {
      markSent(booking).then(() => { if (typeof onSent === 'function') onSent(); });
      setTimeout(ctrl.close, 0);
    });
  }

  return { buildUrl, buildMessage, markSent, offerConfirmation };
})();
