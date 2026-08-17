// جولة أوّل الاستخدام — ستّ شرائح تُعرض فوق صفحة الدخول على مساحة الجوال
// وداخل التطبيق الأصلي، وتنتهي بإنشاء حساب.
//
// القرار الحاكم: متى تُعرض؟
// المحور ليس «كم مرّة» بل «من يسأل». المفتاح المعتمَد هو marma:known-user —
// «هل احتضن هذا الجهاز جلسةً مصادَقة يوماً؟» — لا «هل رأى الجولة؟». السبب:
//   · signOut لا يمسّ localStorage، فالموظّف الذي يخرج كل ليلة والكاونتر المشترك
//     محميّان تماماً: أوّل دخول لهما يُسكت الجولة إلى الأبد.
//   · والمحتمَل الذي لم يدخل قطّ يراها كلّما عاد — وهو بالضبط من كُتبت له. وهذا
//     يهمّ في التطبيق أكثر من الوِب: لا صفحة هبوط في الحزمة الأصلية (قاعدة أبل
//     3.1.1)، فالجولة هي المنبر الترويجي الوحيد المسموح فيه.
// ويُكمِلها مدخل يدوي دائم في صفحة الدخول: «تلقائياً مرّة، ومتاحة دائماً».
//
// الحارس المتزامن في <head> صفحة الدخول هو من يقرّر (يضع __TOUR_OK__ ويُخفي
// النموذج بـ html.tour-pending) — لأن جسم الصفحة يُرسم قبل أن يُحمَّل هذا الملف.
// دور init() هنا: تنفيذ القرار ثم رفع الحجاب في كل الأحوال.
//
// الحركة كلّها في styles/components/tour.css داخل @keyframes — لا حركة من هنا.
window.tour = (function () {
  // مسار مستند: base path للنشر الفرعي + docPath للحزمة الأصلية (Capacitor يخدم
  // index.html لأي مسار بلا امتداد، فـ'/auth/signup' كان سيفتح قوقعة التطبيق).
  function withBase(p) {
    const resolved = window.native ? window.native.docPath(p) : p;
    return (window.__BASE__ || '') + resolved;
  }

  const SEEN_KEY = 'marma:tour:v1';       // الرقم مقصود: تغيّر الوعود ⇒ v2 يعيد تأهيل الجميع
  const SNOOZE_KEY = 'marma:tour:snooze'; // «ليس الآن» ≠ «قرأتها»
  const SESSION_KEY = 'marma:tour:session';
  const SNOOZE_MS = 24 * 60 * 60 * 1000;

  const SLIDES = [
    {
      headline: 'ملعبك يحجز وأنت نايم',
      sub: 'رابط واحد تنشره في حسابك — والعميل يختار موعده ويرسل طلبه بنفسه.'
    },
    {
      headline: 'الطلب يوصلك، والقرار بيدك',
      sub: 'إشعار على جوالك بأي طلب جديد — وتقبله أو ترفضه من صفّ الحجز نفسه.'
    },
    {
      headline: 'ما تنسى تبلّغ أحد',
      sub: 'رسالة تأكيد جاهزة بضغطة — والنظام يعلّم على من لم يُبلَّغ بعد.'
    },
    {
      headline: 'تعرف مين باقي عليه',
      sub: 'شريط ملوّن على كل حجز له سعر، وتحصيل كامل المبلغ من نافذة الدفعة.'
    },
    {
      headline: 'تعرف يومك من نظرة',
      sub: 'إيرادات اليوم، ونسبة الإشغال، وكم موعداً بقي — محسوبة قبل أن تسأل.'
    },
    {
      headline: 'عميلك يرجع لك',
      sub: 'بطاقة أختام باسم ملعبك في محفظة جوّاله — والختم لا يُمنح إلا بموافقتك.'
    }
  ];

  let root = null;
  let index = 0;
  let closeLayer = null;
  let lastFocus = null;
  let keyHandler = null;
  let resizeHandler = null;

  // ===== عزل البؤرة =====
  // الطبقة معتمة تماماً (‎.tour تحمل background: var(--surface-0))، لكن نموذج
  // الدخول تحتها يبقى في دورة Tab: بلا عزل يقع أوّل Tab على زرّ Google، وEnter
  // يُطلق تحويل OAuth كاملاً والمستخدم لا يرى ما ضغط. وaria-modal="true" يَعِد
  // بعزلٍ لقارئ الشاشة وحده ولا يمسّ البؤرة إطلاقاً.
  //
  // العلاج طبقتان: inert يُخرج ما خلف الجولة من دورة Tab ومن شجرة الوصول معاً؛
  // وحلقة الحبس على Tab شبكةُ أمان للـWebView التي لا تدعمه.
  function backdrop() {
    return document.querySelector('.auth-page');
  }

  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

  function focusablesIn(el) {
    return [...el.querySelectorAll(FOCUSABLE)].filter((n) => {
      if (n.closest('[aria-hidden="true"]')) return false;   // المسرح وشرائحه المخفيّة
      if (!(n.offsetWidth || n.offsetHeight || n.getClientRects().length)) return false;
      // visibility: hidden يُبقي صندوق التخطيط فيمرّ من الفحص أعلاه، لكن
      // المتصفّح لا يُبئّره. وزرّ «رجوع» مخفيٌّ هكذا على الشريحة الأولى — فلولا
      // هذا السطر لَحسبناه آخر محطّة، وفلتت البؤرة إلى المستند عند تجاوز
      // ما قبله فعلياً.
      return getComputedStyle(n).visibility !== 'hidden';
    });
  }

  function trapKeys(e) {
    if (!root) return;
    if (e.key === 'Escape') { e.preventDefault(); dismiss(); return; }
    if (e.key !== 'Tab') return;
    const items = focusablesIn(root);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    // البؤرة خارج الطبقة (أو على جذرها) ⇒ أعِدها إلى داخلها
    if (!root.contains(document.activeElement)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // الجولة تُعرض على صفحتَي الدخول والتسجيل. على الدخول يقود الزرّ الختامي إلى
  // التسجيل؛ وعلى التسجيل لا وجهة تُقصد — النموذج تحت الطبقة مباشرةً، فيغلقها.
  function onSignupPage() {
    return /signup/.test(window.location.pathname);
  }

  function unveil() {
    document.documentElement.classList.remove('tour-pending');
  }

  function write(key, value, store) {
    try { (store || localStorage).setItem(key, value); } catch (_) {}
  }

  // ===== التركيب =====

  function build() {
    const el = document.createElement('div');
    el.className = 'tour';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'جولة تعريفية بمَرمى');

    // المسرح رسمٌ توضيحي: يُخفى عن قارئ الشاشة كلّه. بدونه تُقرأ حالتا «قبل»
    // و«بَعد» المتراكبتان معاً فتخرج أرقام متناقضة («غير مدفوع 150» و«مدفوع»
    // في نفس النَفَس). الرسالة كلّها في .tour-copy.
    // والعنوان يحمل tabindex="-1" كي تنتقل إليه البؤرة عند كل شريحة، فيُعلَن
    // المحتوى الجديد بلا aria-live.
    const slides = SLIDES.map((s, i) => ''
      + '<section class="tour-slide" data-slide="' + (i + 1) + '" role="group"'
      + ' aria-label="شريحة ' + (i + 1) + ' من ' + SLIDES.length + '" aria-hidden="true">'
      + '  <div class="tour-stage" aria-hidden="true">' + (window.tourStages[i] || '') + '</div>'
      + '  <div class="tour-copy">'
      + '    <h2 class="tour-headline" tabindex="-1">' + s.headline + '</h2>'
      + '    <p class="tour-sub">' + s.sub + '</p>'
      + '  </div>'
      + '</section>').join('');

    // النقاط زخرفية: الموضع يُنطق من aria-label الشريحة نفسها.
    const dots = SLIDES.map((_, i) =>
      '<span class="tour-dot" data-dot="' + i + '"></span>').join('');

    el.innerHTML = ''
      + '<div class="tour-head">'
      + '  <button type="button" class="tour-skip" id="tour-skip">تخطّي</button>'
      + '</div>'
      // ترتيب الصفّ: رجوع · نقاط · تقدّم — والأخير في نهاية السطر، أي الزاوية
      // السفلى اليسرى في RTL: جهة التقدّم في القراءة العربية.
      // السهم arrow-left لا arrow-right لنفس السبب.
      + '<div class="tour-viewport">' + slides + '</div>'
      + '<div class="tour-foot">'
      + '  <button type="button" class="tour-back" id="tour-back">رجوع</button>'
      + '  <div class="tour-dots" aria-hidden="true">' + dots + '</div>'
      + '  <button type="button" class="tour-next" id="tour-next" aria-label="التالي">'
      + '    <span class="tour-next-text"></span><i data-lucide="arrow-left"></i>'
      + '  </button>'
      + '</div>';

    return el;
  }

  // ===== تحجيم المسرح =====
  // المسارح مرسومة كلّها على شبكة 300px عرضاً، وأطولها 330px. نكبّرها لتملأ ما
  // تسمح به الشاشة فعلاً بدل أن تطفو صغيرةً في وسطها.
  //
  // مُعامل واحد لكل الشرائح لا مُعامل لكل شريحة: لو حُسب لكلٍّ على حدة لاختلف
  // الوزن البصري بين شريحة وأخرى فبدت الجولة مهتزّة. فنقيس بأطول مسرح ونلتزمه.
  const STAGE_W = 300;
  const STAGE_H_MAX = 330;

  function fit() {
    if (!root) return;
    const vp = root.querySelector('.tour-viewport');
    const copy = root.querySelector('.tour-slide.is-active .tour-copy');
    if (!vp) return;
    const gap = parseFloat(getComputedStyle(root.querySelector('.tour-slide')).gap) || 0;
    const availW = vp.clientWidth;
    const availH = vp.clientHeight - (copy ? copy.offsetHeight : 0) - gap;
    // العرض يحكم على الجوال الضيّق، والارتفاع يمنع التضخّم على الشاشات الطويلة.
    const raw = Math.min(availW / STAGE_W, availH / STAGE_H_MAX);
    const scale = Math.max(0.55, Math.min(1.6, raw));
    root.style.setProperty('--tour-scale', String(Math.round(scale * 1000) / 1000));
  }

  // ===== التنقّل =====

  // كل دخول إلى شريحة تشغيلٌ من الإطار صفر — لا استئناف من المنتصف.
  // بدون إطار الإعادة هذا تُستأنف الحلقة الموقوفة حيث تركها المستخدم، فيصل إلى
  // شريحة رسالتُها نصف مكتوبة. والحالة تُكتب قبل أن تصير الشريحة مرئية لا بعدها.
  function activate(i) {
    const slides = root.querySelectorAll('.tour-slide');
    slides.forEach((el, k) => {
      el.classList.toggle('is-active', k === i);
      el.setAttribute('aria-hidden', k === i ? 'false' : 'true');
    });

    const el = slides[i];
    el.classList.add('is-resetting');
    void el.offsetWidth;              // إجبار reflow — بدونه لا تُعاد الـ keyframes
    el.classList.remove('is-resetting');

    root.querySelectorAll('.tour-dot').forEach((d, k) => {
      d.classList.toggle('is-active', k === i);
      d.classList.toggle('is-done', k < i);
    });

    // الشريحة الأخيرة وحدها يمتدّ زرّها ويحمل نصّاً — قبلها هو سهمٌ في الزاوية.
    const last = i === SLIDES.length - 1;
    const label = last ? (onSignupPage() ? 'ابدأ الآن' : 'أنشئ حسابك') : 'التالي';
    const next = root.querySelector('#tour-next');
    next.querySelector('.tour-next-text').textContent = label;
    next.setAttribute('aria-label', label);
    root.classList.toggle('is-last', last);
    root.querySelector('#tour-back').classList.toggle('is-visible', i > 0);

    index = i;

    // ارتفاع النصّ يختلف بين شريحة وأخرى، فيُعاد القياس عند كل تبديل.
    fit();

    // البؤرة إلى عنوان الشريحة: يُسمع المحتوى الجديد عند كل تبديل، وتبقى
    // البؤرة داخل الطبقة. (لا preventScroll لأن المنصّة قد تكون قابلة للتمرير
    // على الشاشات القصيرة، فالتمرير إلى العنوان مطلوب لا ضار.)
    const head = el.querySelector('.tour-headline');
    if (head) { try { head.focus(); } catch (_) {} }
  }

  function next() {
    if (window.native && window.native.haptic) window.native.haptic();
    if (index < SLIDES.length - 1) { activate(index + 1); return; }
    // الشريحة الأخيرة تذهب إلى إنشاء الحساب مباشرةً — من أكمل ستّ شرائح ليس
    // عائداً ينسى كلمة مروره. وإن كان عليها أصلاً فالنموذج تحت الطبقة.
    write(SEEN_KEY, String(Date.now()));
    if (onSignupPage()) { close(); return; }
    window.location.href = withBase('/auth/signup');
  }

  function back() {
    if (index > 0) activate(index - 1);
  }

  // تخطٍّ صريح = «لا أريد هذا»، فيُكتب علم الإكمال.
  function skip() {
    write(SEEN_KEY, String(Date.now()));
    close();
  }

  // إغلاق بلا قرار (زرّ الرجوع العتادي) = «ليس الآن»، فيُؤجَّل يوماً فقط.
  function dismiss() {
    write(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    close();
  }

  function close() {
    if (closeLayer && window.utils && window.utils.popLayer) {
      window.utils.popLayer(closeLayer);
    }
    closeLayer = null;
    if (keyHandler) { document.removeEventListener('keydown', keyHandler, true); keyHandler = null; }
    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
      window.removeEventListener('orientationchange', resizeHandler);
      resizeHandler = null;
    }
    const bg = backdrop();
    if (bg) { try { bg.inert = false; } catch (_) {} }
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    unveil();
    // أعِد البؤرة إلى حيث كانت — الرابط اليدوي عادةً — كي لا تسقط إلى body.
    if (lastFocus && document.contains(lastFocus)) { try { lastFocus.focus(); } catch (_) {} }
    lastFocus = null;
  }

  // ===== الواجهة العامّة =====

  function open(opts) {
    if (root) return;
    const manual = !!(opts && opts.manual);

    root = build();
    document.body.appendChild(root);

    root.querySelector('#tour-next').addEventListener('click', next);
    root.querySelector('#tour-back').addEventListener('click', back);
    root.querySelector('#tour-skip').addEventListener('click', skip);

    if (window.utils && window.utils.renderIcons) window.utils.renderIcons(root);

    // عزل ما خلف الطبقة عن البؤرة وعن قارئ الشاشة
    lastFocus = document.activeElement;
    const bg = backdrop();
    if (bg) { try { bg.inert = true; } catch (_) {} }
    keyHandler = trapKeys;
    document.addEventListener('keydown', keyHandler, true);

    // دوران الجهاز وظهور شريط المتصفّح يغيّران المساحة المتاحة — والمسرح يتبعها.
    resizeHandler = fit;
    window.addEventListener('resize', resizeHandler);
    window.addEventListener('orientationchange', resizeHandler);

    // زرّ الرجوع العتادي في أندرويد يُغلق التطبيق من أي شاشة بلا معالج —
    // native.js يسجّل معالجه في كل صفحة تُحمّله، وصفحة الدخول منها.
    // وهو في أندرويد وسيلة «ارجع خطوة» لا «اخرج»: فيرجع شريحةً، ولا يُنهي
    // الجولة إلا من الشريحة الأولى حيث لا خطوة قبلها.
    if (window.utils && window.utils.pushLayer) {
      closeLayer = () => { if (index > 0) back(); else dismiss(); };
      window.utils.pushLayer(closeLayer);
    }

    // علم جلسة التبويب للتطبيق الأصلي وحده — يقرؤه حارس <head> هناك فقط لحماية
    // سلسلة الإقلاع من التركيب المزدوج. وعلى الوِب لا يُكتب أصلاً كي لا يكتم
    // الجولة عند إعادة التحميل. والفتح اليدوي لا يُعلَّم بحال: من طلبها بنفسه
    // قد يطلبها ثانيةً.
    if (!manual && window.native && window.native.isNative) {
      write(SESSION_KEY, '1', sessionStorage);
    }

    activate(0);
  }

  // تُستدعى من صفحة الدخول دائماً. ترفع الحجاب في كل مسار — بما فيه «لن تُعرض»
  // و«فشل التركيب» — فلا يبقى نموذج الدخول مخفيّاً بحال.
  function init() {
    try {
      if (window.__TOUR_OK__ === true) open({ manual: false });
    } catch (_) {
      if (root && root.parentNode) root.parentNode.removeChild(root);
      root = null;
    } finally {
      unveil();
    }
  }

  return { init, open, close };
})();
