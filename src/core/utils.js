// أدوات مساعدة عامة

// تنسيق التاريخ والوقت بالعربي (صيغة 12 ساعة دائماً)
const dateFormatter = new Intl.DateTimeFormat('ar-EG', {
  year: 'numeric',
  month: 'long',
  day: 'numeric'
});

const dateShortFormatter = new Intl.DateTimeFormat('ar-EG', {
  year: 'numeric',
  month: 'short',
  day: 'numeric'
});

const currencyFormatter = new Intl.NumberFormat('ar-EG', {
  numberingSystem: 'latn',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

const relTimeFormatter = new Intl.RelativeTimeFormat('ar', { numeric: 'auto' });

// تحويل ساعات/دقائق إلى نص 12 ساعة بالعربية: "4:00 م"
function toTime12(h, m) {
  const period = h >= 12 ? 'م' : 'ص';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

// helper: تحويل عناصر <i data-lucide="..."> إلى SVG. آمن للاستدعاء حتى لو لم تُحمَّل المكتبة.
function renderIcons(root) {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    try {
      window.lucide.createIcons(root ? { nameAttr: 'data-lucide', icons: window.lucide.icons } : undefined);
    } catch (_) {
      window.lucide.createIcons();
    }
  }
}

// يضيف base path (مثل '/marma') إلى مسار نظيف. آمن إذا base فارغ.
// مثال: path('/dashboard') → '/marma/dashboard' في prod، '/dashboard' في dev.
// idempotent: path('/marma/dashboard') ترجع نفس القيمة.
function pathWithBase(p) {
  const base = window.__BASE__ || '';
  if (!base || !p) return p;
  if (p === base || p.startsWith(base + '/')) return p;
  return base + p;
}

window.utils = {
  renderIcons,
  path: pathWithBase,

  formatDate(value) {
    if (!value) return '';
    return dateFormatter.format(new Date(value));
  },

  // الوقت من Date object → "4:00 م"
  formatTime(value) {
    if (!value) return '';
    const d = new Date(value);
    return toTime12(d.getHours(), d.getMinutes());
  },

  // الوقت من نص "HH:MM" أو "HH:MM:SS" → "4:00 م"
  formatTimeOfDay(timeStr) {
    if (!timeStr) return '';
    const [hStr, mStr] = String(timeStr).split(':');
    return toTime12(parseInt(hStr, 10) || 0, parseInt(mStr, 10) || 0);
  },

  formatDateTime(value) {
    if (!value) return '';
    const d = new Date(value);
    return `${dateShortFormatter.format(d)} - ${toTime12(d.getHours(), d.getMinutes())}`;
  },

  // توقيت نسبي بالعربية: «الآن»، «قبل ٥ دقائق»، «قبل ساعة»... وللأقدم من شهر يعرض التاريخ
  timeAgo(value) {
    if (!value) return '';
    const diffMs = Date.now() - new Date(value).getTime();
    const sec = Math.round(diffMs / 1000);
    if (sec < 45) return 'الآن';
    const min = Math.round(sec / 60);
    if (min < 60) return relTimeFormatter.format(-min, 'minute');
    const hr = Math.round(min / 60);
    if (hr < 24) return relTimeFormatter.format(-hr, 'hour');
    const day = Math.round(hr / 24);
    if (day < 30) return relTimeFormatter.format(-day, 'day');
    return this.formatDate(value);
  },

  // تحويل تاريخ ISO إلى صيغة datetime-local
  toDatetimeLocal(value) {
    if (!value) return '';
    const d = new Date(value);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  // تنسيق العملة (ريال سعودي)
  formatCurrency(value) {
    const n = Number(value) || 0;
    return `${currencyFormatter.format(n)} ر.س`;
  },

  // سعر اختياري: null/undefined = «عند التواصل»، 0 = «مجاني»، غير ذلك = مبلغ
  formatPrice(value) {
    if (value === null || value === undefined || value === '') return 'عند التواصل';
    if (Number(value) === 0) return 'مجاني';
    return this.formatCurrency(value);
  },

  // ====== حالة الحجز المشتقّة ======
  // المتبقّي على الحجز — null إذا لا يوجد سعر متتبَّع («عند التواصل»)، 0 إذا مجاني
  bookingOwed(b) {
    if (b.total_price == null) return null;
    const total = Number(b.total_price);
    if (total <= 0) return 0;
    return Math.round((total - Number(b.paid_amount || 0)) * 100) / 100;
  },

  // مُسدَّد بالكامل — أو لا يوجد ما يُحصَّل أصلاً (مجاني/عند التواصل)
  isBookingSettled(b) {
    const owed = this.bookingOwed(b);
    return owed == null || owed <= 0;
  },

  // انتهى وقت الحجز فعلاً
  isBookingPast(b) {
    return new Date(b.end_time).getTime() < Date.now();
  },

  // الحالة الفعلية المعروضة: حجز مؤكد انتهى وقته وسُدِّد بالكامل ⇒ «مكتمل» تلقائياً.
  // ملاحظة: حجز ماضٍ غير مُسدَّد يبقى «مؤكد» عمداً ليظلّ مطالِباً بالتحصيل.
  effectiveBookingStatus(b) {
    if (b.status === 'confirmed' && this.isBookingPast(b) && this.isBookingSettled(b)) {
      return 'completed';
    }
    return b.status;
  },

  // قاموس الترجمة للمزايا (مفاتيح كانونية ↔ تسميات عربية)
  AMENITY_LABELS: {
    showers: 'دش',
    parking: 'موقف سيارات',
    lights: 'إضاءة ليلية',
    lockers: 'خزائن',
    wifi: 'واي-فاي',
    shaded: 'مظلّل',
    cafeteria: 'كافتيريا',
    prayer_room: 'مصلّى',
    seating: 'جلسات للمشجعين'
  },

  // أيقونة Lucide لكل ميزة (لعرض منظّم في نافذة الأرضية)
  AMENITY_ICONS: {
    showers: 'shower-head',
    parking: 'square-parking',
    lights: 'lightbulb',
    lockers: 'lock',
    wifi: 'wifi',
    shaded: 'umbrella',
    cafeteria: 'coffee',
    prayer_room: 'moon-star',
    seating: 'armchair'
  },

  // قاموس الترجمة لأنواع الأرضيات
  SURFACE_LABELS: {
    natural_grass: 'عشب طبيعي',
    artificial_grass: 'عشب صناعي',
    indoor: 'صالة مغلقة',
    court: 'ملعب صلب'
  },

  // تنسيق المدة بصيغة مألوفة: «1:30 ساعة»، «45 دقيقة»، «2 ساعة» — بدل العشرية «1.5 س»
  formatDuration(hours) {
    const totalMin = Math.round(Number(hours) * 60);
    if (totalMin <= 0) return '0 دقيقة';
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return `${m} دقيقة`;
    if (m === 0) return `${h} ساعة`;
    return `${h}:${String(m).padStart(2, '0')} ساعة`;
  },

  // حساب الفرق بالساعات بين تاريخين
  hoursBetween(start, end) {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    return ms / (1000 * 60 * 60);
  },

  // حماية من XSS عند الإدراج في innerHTML
  escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  // debounce للبحث في الوقت الفعلي
  debounce(fn, ms = 300) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  },

  // قراءة معامل من URL
  getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  },

  // التحقق من صيغة رقم الجوال السعودي (يبدأ بـ 05 و10 أرقام)
  isValidSaudiPhone(phone) {
    return /^05\d{8}$/.test(String(phone || '').trim());
  },

  // يقيّد input ليقبل أرقام فقط بحد أقصى 10. استدعِه بعد إنشاء العنصر.
  bindPhoneInput(inputEl) {
    if (!inputEl) return;
    inputEl.setAttribute('inputmode', 'numeric');
    inputEl.setAttribute('maxlength', '10');
    inputEl.setAttribute('pattern', '05[0-9]{8}');
    if (!inputEl.getAttribute('placeholder')) inputEl.setAttribute('placeholder', '05XXXXXXXX');
    inputEl.setAttribute('title', 'يجب أن يبدأ الرقم بـ 05 ويتكون من 10 أرقام');
    inputEl.addEventListener('input', () => {
      inputEl.value = inputEl.value.replace(/\D/g, '').slice(0, 10);
    });
  },

  // ====== Toast notifications ======
  toast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    const icons = { success: 'check', error: 'x', warning: 'triangle-alert', info: 'info' };
    const iconName = icons[type] || 'info';
    toast.innerHTML = `<i data-lucide="${iconName}"></i><span>${this.escapeHtml(message)}</span>`;
    container.appendChild(toast);
    renderIcons(toast);
    setTimeout(() => {
      toast.style.transition = 'opacity 0.2s';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 200);
    }, 4000);
  },

  // ====== Modal generic ======
  // يفتح modal، يعيد دالة close
  openModal({ title, body, footer, onClose, size }) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const sizeClass = size ? ` modal--${size}` : '';
    backdrop.innerHTML = `
      <div class="modal${sizeClass}" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3>${this.escapeHtml(title || '')}</h3>
          <button type="button" class="modal-close" aria-label="إغلاق"><i data-lucide="x"></i></button>
        </div>
        <div class="modal-body"></div>
        ${footer ? '<div class="modal-footer"></div>' : ''}
      </div>
    `;
    const modal = backdrop.querySelector('.modal');
    const bodyEl = backdrop.querySelector('.modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else if (body instanceof Node) bodyEl.appendChild(body);

    if (footer) {
      const footerEl = backdrop.querySelector('.modal-footer');
      if (typeof footer === 'string') footerEl.innerHTML = footer;
      else if (footer instanceof Node) footerEl.appendChild(footer);
    }

    const close = () => {
      backdrop.remove();
      if (typeof onClose === 'function') onClose();
    };
    // الإغلاق عبر الأزرار فقط (زر × في الترويسة أو أزرار التذييل).
    // عمداً لا نُغلق بالنقر خارج النافذة ولا بمفتاح Escape، حتى لا يُفقَد إدخالٌ بالخطأ.
    backdrop.querySelector('.modal-close').addEventListener('click', close);
    document.body.appendChild(backdrop);
    renderIcons(backdrop);
    return { close, modal, bodyEl };
  },

  // مودال تأكيد عام
  // ملاحظة: نستخدم settled flag لأن ctrl.close() يُشغّل onClose الذي يُحلّ
  // الـ Promise قبل أن نحلّه بـ true في زر "تأكيد". بدون هذا الحارس،
  // الـ Promise يُحلّ بـ false دائماً.
  confirm({ title = 'تأكيد', message, confirmText = 'تأكيد', cancelText = 'إلغاء', danger = false } = {}) {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const footerHtml = `
        <button type="button" class="btn btn--ghost" data-action="cancel">${this.escapeHtml(cancelText)}</button>
        <button type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-action="confirm">${this.escapeHtml(confirmText)}</button>
      `;
      const ctrl = this.openModal({
        title,
        body: `<p>${this.escapeHtml(message)}</p>`,
        footer: footerHtml,
        onClose: () => settle(false)
      });
      ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', () => {
        settle(false);
        ctrl.close();
      });
      ctrl.modal.querySelector('[data-action="confirm"]').addEventListener('click', () => {
        settle(true);
        ctrl.close();
      });
    });
  },

  // تحويل خطأ Supabase إلى رسالة عربية
  formatError(err) {
    if (!err) return 'حدث خطأ غير متوقع';
    const msg = err.message || err.error_description || String(err);

    // خطأ تعارض الحجوزات (EXCLUSION constraint)
    if (msg.includes('no_overlapping_bookings') || err.code === '23P01') {
      return 'هذا الموعد متعارض مع حجز موجود على نفس الأرضية';
    }
    // UNIQUE constraint
    if (err.code === '23505' || msg.includes('duplicate key')) {
      if (msg.includes('customers_tenant_id_phone_key')) {
        return 'يوجد عميل بنفس رقم الجوال';
      }
      return 'هذه البيانات موجودة مسبقاً';
    }
    // CHECK constraint
    if (err.code === '23514') {
      if (msg.includes('end_time') && msg.includes('start_time')) {
        return 'وقت النهاية يجب أن يكون بعد وقت البداية';
      }
      if (msg.includes('paid_amount')) {
        return 'المبلغ المدفوع يجب أن يكون بين 0 والمبلغ الإجمالي';
      }
      return 'القيمة المُدخلة غير صالحة';
    }
    // FK constraint
    if (err.code === '23503') {
      return 'لا يمكن إتمام العملية: توجد بيانات مرتبطة';
    }
    // رسائل أخطاء التسجيل من trigger
    if (msg.includes('INVITE_NOT_FOUND')) return 'رمز الدعوة غير صحيح';
    if (msg.includes('INVITE_ALREADY_USED')) return 'هذه الدعوة تم استخدامها مسبقاً';
    if (msg.includes('INVITE_EXPIRED')) return 'انتهت صلاحية هذه الدعوة';
    if (msg.includes('TENANT_NAME_REQUIRED')) return 'اسم الملعب مطلوب';
    if (msg.includes('FULL_NAME_REQUIRED')) return 'الاسم الكامل مطلوب';

    // أخطاء الاشتراك
    if (msg.includes('TENANT_INACTIVE')) return 'انتهت صلاحية اشتراكك. يرجى تجديد الاشتراك للاستمرار';
    if (msg.includes('SUBSCRIPTION_PENDING_EXISTS')) return 'يوجد طلب اشتراك معلق بالفعل بانتظار الموافقة';
    if (msg.includes('SUBSCRIPTION_NOT_FOUND')) return 'طلب الاشتراك غير موجود';
    if (msg.includes('SUBSCRIPTION_ALREADY_REVIEWED')) return 'تمت مراجعة هذا الطلب مسبقاً';
    if (msg.includes('PLAN_NOT_AVAILABLE')) return 'الخطة غير متاحة';
    if (msg.includes('PAYMENT_REFERENCE_REQUIRED')) return 'رقم مرجع التحويل مطلوب';
    if (msg.includes('NOT_OWNER')) return 'هذه العملية متاحة لمالك الملعب فقط';
    if (msg.includes('NOT_SUPER_ADMIN')) return 'هذه العملية للمشرف العام فقط';
    if (msg.includes('UNAUTHENTICATED')) return 'يجب تسجيل الدخول أولاً';

    // حدود الأرضيات والموظفين
    if (msg.includes('FIELD_LIMIT_REACHED')) return 'بلغت الحد الأقصى المسموح من الأرضيات لباقتك. ارفع الباقة من صفحة الاشتراك';
    if (msg.includes('STAFF_LIMIT_REACHED')) return 'بلغت الحد الأقصى المسموح من الموظفين لباقتك. ارفع الباقة من صفحة الاشتراك';
    if (msg.includes('INVALID_UNIT_COUNT')) return 'عدد الأرضيات أو الموظفين غير صالح';

    // رسائل auth شائعة
    if (msg.includes('Invalid login credentials')) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
    if (msg.includes('User already registered')) return 'هذا البريد الإلكتروني مسجل مسبقاً';
    if (msg.includes('Email not confirmed')) return 'يرجى تأكيد البريد الإلكتروني أولاً';
    if (msg.includes('Password should be')) return 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
    const securityWait = msg.match(/you can only request this after (\d+) seconds?/i);
    if (securityWait) return `لأسباب أمنية، يمكنك إعادة الإرسال بعد ${securityWait[1]} ثانية`;
    if (msg.includes('rate limit')) return 'محاولات كثيرة، يرجى الانتظار قليلاً';

    return msg;
  }
};
