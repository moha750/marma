// مرشد المساعدة — يؤشّر على الزرّ الحقيقي في الشاشة الحقيقية.
//
// الشرح المكتوب والفيديو كلاهما يفشل عند نفس النقطة: يصف مكاناً، ولا يقف فيه.
// المالك يقرأ «افتح تعديل اليوم» ثم يرفع رأسه إلى شاشةٍ فيها عشرون زرّاً. وهنا
// نضع الحلقة على الزرّ نفسه — فلا يبقى بين الوصف والفعل مسافة.
//
// ثلاث قواعد حكمت البناء:
//   · الخطوة تنتظر عنصرها. أكثر الخطوات المهمّة تقع داخل نافذة لم تُفتح بعد،
//     فالمرشد يترقّب DOM حتى يظهر العنصر بدل أن يستسلم عند غيابه.
//   · الحلقة لا تعترض النقر. الغطاء كلّه pointer-events:none إلا الفقاعة —
//     فالمستخدم يفعل الخطوة بيده وهي مضاءة، لا يتفرّج عليها.
//   · للمرشد نهايةٌ صادقة. آخر خطوةٍ فيه «ما زلت محتاج مساعدة» تفتح الباب
//     للدعم — لأن الشرح الذي لا يعترف بعجزه يترك المالك حيث بدأ.
window.helpCoach = (function () {
  const WAIT_MS = 6000;   // كم ننتظر ظهور عنصر خطوةٍ قبل أن نعدّها متعذّرة
  const POLL_MS = 120;

  // ── الأدلّة ───────────────────────────────────────────────────────────
  // مكتوبةٌ بلسان المالك لا بلسان الواجهة: «وقت الفتح والإغلاق» لا
  // «working_periods». وanchor مسارٌ يجب أن يكون المستخدم فيه ليبدأ الدليل.
  const GUIDES = {
    'schedule-time': {
      title: 'تعديل وقت الفتح والإغلاق',
      icon: 'clock',
      path: '/schedule',
      steps: [
        { sel: '#sch-fields', body: 'اختر الأرضية التي تريد تعديل أوقاتها. لكل أرضية جدولها الخاص.' },
        { sel: '#sch-week [data-edit]', body: 'اضغط «تعديل» على اليوم الذي تريد تغييره.' },
        { sel: '#day-wins', body: 'هنا وقت الفتح والإغلاق. غيّرهما كما تريد.' },
        { sel: '#day-add', body: 'لو كان الملعب يفتح فترتين (صباح ومساء)، أضف فترة ثانية من هنا.', optional: true },
        { sel: '#day-save', body: 'اضغط «حفظ اليوم» — ويظهر التغيير في الجدول فوراً.' },
        { sel: '#sch-apply-all', body: 'وإن كانت كل الأيام متشابهة، طبّق هذا اليوم عليها كلّها بضغطة.', optional: true }
      ]
    },
    'field-images': {
      title: 'إضافة صور للملعب',
      icon: 'image-plus',
      path: '/fields',
      steps: [
        { sel: '[data-action="edit"]', body: 'اضغط زرّ التعديل (القلم) على الأرضية التي تريد إضافة صورها.' },
        { sel: '#field-gallery', body: 'هذا معرض الصور. الصورة الأولى هي التي تظهر للعميل كغلاف.' },
        { sel: '.field-gallery__add, [data-role="add-image"]', body: 'اضغط «إضافة صورة» واختر صورةً من جوّالك — تُحفظ فوراً بلا حاجة لزرّ حفظ.' }
      ]
    }
  };

  let overlay = null;
  let current = null;   // { key, steps, index, cancelled }

  // ── انتظار العنصر ────────────────────────────────────────────────────
  // استجوابٌ دوري لا MutationObserver: العنصر قد يوجد في DOM ثم يُعاد رسمه،
  // وقد يظهر داخل نافذةٍ تُركَّب على دفعات. والسؤال الذي يهمّنا ليس «هل تغيّر
  // DOM؟» بل «هل صار العنصر مرئياً الآن؟» — وهذا لا يُجيب عنه إلا القياس.
  function waitFor(selector, timeout) {
    const deadline = Date.now() + (timeout || WAIT_MS);
    return new Promise((resolve) => {
      (function poll() {
        if (current && current.cancelled) return resolve(null);
        const el = document.querySelector(selector);
        if (el) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return resolve(el);
        }
        if (Date.now() > deadline) return resolve(null);
        setTimeout(poll, POLL_MS);
      })();
    });
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'coach';
    overlay.innerHTML = `
      <div class="coach__ring" hidden></div>
      <div class="coach__bubble" role="dialog" aria-live="polite">
        <div class="coach__step"></div>
        <p class="coach__body"></p>
        <div class="coach__actions">
          <button type="button" class="btn btn--primary btn--sm" data-coach="next">التالي</button>
          <button type="button" class="btn btn--ghost btn--sm" data-coach="stop">إغلاق</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      const b = e.target.closest('[data-coach]');
      if (!b) return;
      if (b.getAttribute('data-coach') === 'stop') stop();
      else advance();
    });
    return overlay;
  }

  function place(el, step, n, total) {
    const o = ensureOverlay();
    const ring = o.querySelector('.coach__ring');
    const bubble = o.querySelector('.coach__bubble');
    o.querySelector('.coach__step').textContent = `خطوة ${n} من ${total}`;
    o.querySelector('.coach__body').textContent = step.body;

    const r = el.getBoundingClientRect();
    const pad = 6;
    ring.hidden = false;
    ring.style.top    = `${r.top - pad}px`;
    ring.style.left   = `${r.left - pad}px`;
    ring.style.width  = `${r.width + pad * 2}px`;
    ring.style.height = `${r.height + pad * 2}px`;

    // الفقاعة تحت العنصر ما لم يضق ما تحته — والقياس بعد الرسم لأن ارتفاعها
    // يتبع نصّها لا العكس.
    // إحداثيات المنفذ مباشرةً (left/top) لا المنطقية (inset-inline): القياس
    // آتٍ من getBoundingClientRect وهو بالمنفذ، وخلطهما في صفحةٍ rtl يقلب
    // الفقاعة إلى الجهة الأخرى من الشاشة.
    bubble.style.visibility = 'hidden';
    bubble.style.top = '0px';
    bubble.style.left = '0px';
    requestAnimationFrame(() => {
      const bh = bubble.offsetHeight;
      const bw = bubble.offsetWidth;
      const below = r.bottom + 12;
      const top = (below + bh < window.innerHeight - 8) ? below : Math.max(8, r.top - bh - 12);
      let left = r.left + r.width / 2 - bw / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
      bubble.style.top = `${top}px`;
      bubble.style.left = `${left}px`;
      bubble.style.visibility = 'visible';
    });

    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  async function show() {
    if (!current) return;
    const { steps, index } = current;
    if (index >= steps.length) return finish();

    const step = steps[index];
    const el = await waitFor(step.sel, step.wait);
    if (!current || current.cancelled) return;

    if (!el) {
      // خطوةٌ اختيارية غائبة (زرّ لا يظهر إلا للمالك، معرضٌ فارغ): تخطَّ بصمت.
      // وغير الاختيارية إن غابت فالشاشة ليست ما توقّعناه — نعرض المخرج بدل
      // أن نُصرّ على تأشيرٍ في الفراغ.
      if (step.optional) { current.index++; return show(); }
      return finish({ stuck: true });
    }

    place(el, step, index + 1, steps.length);

    // النقر على العنصر نفسه يتقدّم — الخطوة تُنفَّذ لا تُقرأ
    const onHit = () => { el.removeEventListener('click', onHit); advance(); };
    el.addEventListener('click', onHit, { once: true });
    current.detach = () => el.removeEventListener('click', onHit);
  }

  function advance() {
    if (!current) return;
    if (current.detach) { current.detach(); current.detach = null; }
    current.index++;
    show();
  }

  // ── النهاية ──────────────────────────────────────────────────────────
  // نهايتان: «تمّت» و«ما زلت محتاج مساعدة». والثانية ليست اعتذاراً — هي سبب
  // وجود الطبقة الثانية: من لم ينفع معه الشرح يُصلَح له.
  function finish(opts) {
    const stuck = !!(opts && opts.stuck);
    const key = current && current.key;
    stop();
    const guide = GUIDES[key] || {};
    const ctrl = window.utils.openModal({
      title: stuck ? 'تعذّر إكمال الشرح' : 'خلصنا',
      body: `
        <p>${stuck
          ? 'ما وصلنا للخطوة التالية — يبدو أن الشاشة تغيّرت.'
          : 'لو ما زال شيء غير واضح، الدعم يقدر يدخل حسابك ويعدّله أمامك.'}</p>
        <p class="text-sm text-secondary">الدعم لا يدخل إلا بإذنك، ولمدّة 30 دقيقة تنتهي وحدها، وتقدر تنهيها في أي لحظة.</p>`,
      footer: `
        <button type="button" class="btn btn--ghost" data-action="cancel">تمام</button>
        <button type="button" class="btn btn--primary" data-action="help">اطلب مساعدة الدعم</button>`
    });
    ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
    ctrl.modal.querySelector('[data-action="help"]').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        await window.supportBanner.requestHelp(guide.title ? `عالق في: ${guide.title}` : null);
        ctrl.close();
        window.utils.toast('وصل طلبك — الدعم بيدخل ويصلح لك', 'success');
      } catch (err) {
        window.utils.toast(window.utils.formatError(err), 'error');
        e.target.disabled = false;
      }
    });
  }

  function stop() {
    if (current) {
      current.cancelled = true;
      if (current.detach) current.detach();
    }
    current = null;
    if (overlay) { overlay.remove(); overlay = null; }
  }

  // ── البدء ────────────────────────────────────────────────────────────
  // الدليل يعمل على شاشته وحدها. ومن بدأه من مكانٍ آخر نأخذه إلى الشاشة أوّلاً
  // ثم نبدأ — لا نعرض له خطوةً تؤشّر على عنصرٍ في صفحةٍ لا يراها.
  function start(key) {
    const guide = GUIDES[key];
    if (!guide) return;
    stop();
    const here = window.location.pathname;
    const target = window.utils.path(guide.path);
    if (here !== target) {
      try { sessionStorage.setItem('marma:coach:pending', key); } catch (_) {}
      if (window.router && window.router.navigateToPath) window.router.navigateToPath(target);
      else window.location.href = target;
      return;
    }
    current = { key, steps: guide.steps, index: 0, cancelled: false };
    ensureOverlay();
    show();
  }

  // يستأنف دليلاً بدأ من صفحةٍ أخرى — يُستدعى بعد رسم كل صفحة
  function resumeIfPending() {
    let key = null;
    try { key = sessionStorage.getItem('marma:coach:pending'); } catch (_) {}
    if (!key) return;
    try { sessionStorage.removeItem('marma:coach:pending'); } catch (_) {}
    const guide = GUIDES[key];
    if (!guide) return;
    if (window.location.pathname !== window.utils.path(guide.path)) return;
    start(key);
  }

  // أزرار «؟» في رؤوس الصفحات: التفويض من document يعني أن الصفحة تكتب
  // data-help ولا توصّل مستمعاً — وهي تُعيد رسم رأسها عند كل تحديث، فمستمعٌ
  // موصولٌ بالعنصر كان سيضيع مع أوّل إعادة رسم.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-help]');
    if (!btn) return;
    e.preventDefault();
    start(btn.getAttribute('data-help'));
  });

  // الاستئناف معلَّقٌ على «رُسمت صفحة» لا على مهلةٍ مقدَّرة: المهلة إمّا تسبق
  // الرسم فتؤشّر على فراغ، وإمّا تتأخّر عنه فيرى المالك شاشةً صامتة ثم تقفز.
  window.addEventListener('marma:page-mounted', () => resumeIfPending());

  function list() {
    return Object.keys(GUIDES).map((k) => ({ key: k, title: GUIDES[k].title, icon: GUIDES[k].icon }));
  }

  // ── ورقة المساعدة ────────────────────────────────────────────────────
  // مدخلٌ واحد ثابت في القائمة، لأن من يتعثّر لا يعرف اسم الصفحة التي يتعثّر
  // فيها. والأدلّة أوّلاً وطلب الدعم آخراً — بهذا الترتيب: أرخص الحلول أوّلاً.
  function openSheet() {
    const items = list().map((g) => `
      <button type="button" class="help-sheet-item" data-guide="${g.key}">
        <i data-lucide="${g.icon}"></i>
        <span>${window.utils.escapeHtml(g.title)}</span>
        <span class="help-sheet-item__go"><i data-lucide="chevron-left"></i></span>
      </button>`).join('');

    const ctrl = window.drawer.open({
      title: 'محتاج مساعدة؟',
      subtitle: 'اختر ما تريد عمله ونمشي معك خطوة خطوة',
      size: 'sm',
      body: `
        <div class="help-sheet-list">
          ${items}
          <button type="button" class="help-sheet-item" data-guide="__support">
            <i data-lucide="life-buoy"></i>
            <span>اطلب من الدعم يدخل ويصلحها لي</span>
            <span class="help-sheet-item__go"><i data-lucide="chevron-left"></i></span>
          </button>
        </div>
        <p class="text-xs text-secondary" style="margin-block-start:var(--space-4)">
          الدعم لا يدخل حسابك إلا بطلبك، ولمدّة 30 دقيقة تنتهي وحدها، وتقدر تنهيها في أي لحظة.
        </p>`
    });
    window.utils.renderIcons(ctrl.body);

    ctrl.body.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-guide]');
      if (!btn) return;
      const key = btn.getAttribute('data-guide');
      if (key !== '__support') { ctrl.close(); return start(key); }
      btn.disabled = true;
      try {
        await window.supportBanner.requestHelp('طلب مساعدة من داخل التطبيق');
        ctrl.close();
        window.utils.toast('وصل طلبك — الدعم بيدخل ويصلح لك', 'success');
      } catch (err) {
        window.utils.toast(window.utils.formatError(err), 'error');
        btn.disabled = false;
      }
    });
  }

  return { start, stop, list, openSheet, resumeIfPending, guides: GUIDES };
})();
