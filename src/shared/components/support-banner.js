// شريط جلسة «الدخول نيابةً» — يعلو كل شيء، ويظهر على الشاشتين معاً.
//
// لماذا شريطٌ دائمٌ لا إشعارٌ يمرّ: الإذن الذي لا يُرى لا يُسحَب. مالكٌ وافق قبل
// عشرين دقيقة ثم انشغل يجب أن يجد الحقيقة أمام عينه — «أحدٌ يعدّل في حسابك
// الآن» — وبجانبها زرّ يُنهيها. والإشعار العابر يفعل عكس ذلك تماماً: يُعلِم
// مرّةً ثم يختفي، فتبقى الجلسة حيّةً في الظلّ.
//
// والشريط نفسه يخدم الجانب الآخر: المشرف داخل حساب غيره يجب ألّا ينسى أنه ليس
// في حسابه. لونٌ صارخ واسم الملعب ومؤقّتٌ ينزل — ثلاثتها ضدّ الخطأ لا ضدّ سوء
// النيّة، والخطأ أكثر وقوعاً.
//
// العدّ التنازلي يُرسَم من expires_at لا من مؤقّتٍ محلي: التبويب الذي نام نصف
// ساعة يستيقظ على الحقيقة، لا على رقمٍ توقّف حيث تركه.
window.supportBanner = (function () {
  const TICK_MS = 20000;

  let slotEl = null;
  let shell = 'owner';     // 'owner' = قوقعة التطبيق · 'admin' = لوحة المشرف
  let session = null;      // آخر حالة معروفة
  let tickTimer = null;
  let wasSupport = false;  // هل كنّا داخل جلسة نيابة في آخر رسم؟
  let settled = false;     // هل جرت قراءةٌ أولى؟ (انظر refresh)
  let busy = false;

  function minutesLeft(s) {
    if (!s || !s.expires_at) return 0;
    return Math.ceil((new Date(s.expires_at).getTime() - Date.now()) / 60000);
  }

  function leftLabel(s) {
    const m = minutesLeft(s);
    if (m <= 0) return 'انتهت الآن';
    if (m === 1) return 'تبقّت دقيقة';
    if (m === 2) return 'تبقّت دقيقتان';
    return `تبقّى ${m} دقيقة`;
  }

  // ── ما يُعرض في كل حال ────────────────────────────────────────────────
  // لكل حالةٍ نصٌّ واحد وأزرارها. الفصل هنا لا في CSS: من يقرأ هذه الدالّة يرى
  // الحالات الخمس كلّها في شاشةٍ واحدة.
  function view(s) {
    const esc = window.utils.escapeHtml;
    if (s.viewer === 'support') {
      return {
        kind: 'support',
        icon: 'user-cog',
        text: `أنت داخل حساب <strong>${esc(s.tenant_name || 'ملعب')}</strong> نيابةً — ${leftLabel(s)}`,
        actions: [{ act: 'end', label: 'أنهِ الجلسة' }]
      };
    }
    if (s.status === 'active') {
      return {
        kind: 'active',
        icon: 'user-cog',
        text: `الدعم يعدّل في حسابك الآن — ${leftLabel(s)}`,
        actions: [{ act: 'end', label: 'أنهِ الآن' }]
      };
    }
    if (s.status === 'pending') {
      const why = s.reason ? `: ${esc(s.reason)}` : '';
      // الموظّف يرى الطلب ولا يحسمه — الحساب ليس حسابه. وإخفاؤه عنه أسوأ:
      // يبقى يسأل «متى يجي الدعم؟» ولا يعرف أن الكرة عند المالك.
      return s.can_respond
        ? {
            kind: 'pending',
            icon: 'shield-question',
            text: `الدعم يطلب الدخول لحسابك${why}`,
            actions: [
              { act: 'approve', label: 'موافق' },
              { act: 'deny', label: 'رفض', quiet: true }
            ]
          }
        : {
            kind: 'pending',
            icon: 'shield-question',
            text: `الدعم يطلب الدخول${why} — بانتظار موافقة المالك`,
            actions: []
          };
    }
    if (s.status === 'invited') {
      return {
        kind: 'invited',
        icon: 'life-buoy',
        text: 'طلبك للمساعدة مفتوح — الدعم قد يدخل حسابك ليصلح لك',
        actions: [{ act: 'end', label: 'ألغِ الطلب', quiet: true }]
      };
    }
    return null;
  }

  function render() {
    if (!slotEl) return;
    const v = session ? view(session) : null;
    if (!v) { slotEl.innerHTML = ''; return; }
    slotEl.innerHTML = `
      <div class="support-banner support-banner--${v.kind}" role="status">
        <span class="support-banner__icon"><i data-lucide="${v.icon}"></i></span>
        <span class="support-banner__text">${v.text}</span>
        <span class="support-banner__actions">
          ${v.actions.map((a) => `
            <button type="button" class="support-banner__btn${a.quiet ? ' is-quiet' : ''}"
                    data-support-act="${a.act}">${window.utils.escapeHtml(a.label)}</button>
          `).join('')}
        </span>
      </div>`;
    window.utils.renderIcons(slotEl);
  }

  async function act(action) {
    if (!session || busy) return;
    busy = true;
    slotEl.querySelectorAll('[data-support-act]').forEach((b) => { b.disabled = true; });
    try {
      if (action === 'approve')      await window.supportApi.respondToSupport(session.id, true);
      else if (action === 'deny')    await window.supportApi.respondToSupport(session.id, false);
      else if (action === 'end')     await window.supportApi.endSession(session.id);
      if (action === 'approve') window.utils.toast('فُتحت الجلسة — الدعم يعدّل الآن', 'success');
      if (action === 'deny')   window.utils.toast('رُفض الطلب', 'info');
      if (action === 'end')    window.utils.toast('أُنهيت الجلسة', 'success');
    } catch (err) {
      window.utils.toast(window.utils.formatError(err), 'error');
    } finally {
      busy = false;
      await refresh();
    }
  }

  // ── مزامنة الحالة ─────────────────────────────────────────────────────
  // التحوّلان اللذان يستوجبان إعادة تحميل كاملة يخصّان المشرف وحده، لأن نطاق
  // بياناته كلّه ينقلب معهما:
  //   لا جلسة → جلسة: كل استعلامٍ حُمّل قبل لحظة كان يرى العدم، فالقوقعة نفسها
  //                    بُنيت على ملفٍّ لا وجود له. إعادة البناء أنظف من ترقيعه.
  //   جلسة → لا جلسة: انتهت النافذة أو أنهاها المالك — والبقاء في قوقعةٍ صارت
  //                    فارغة يعني صفحاتٍ تفشل بلا سبب مفهوم. نعيده للوحته.
  async function refresh() {
    let next = null;
    try { next = await window.supportApi.currentSession(); }
    catch (_) { return; }                  // فشل شبكة عابر: أبقِ ما هو معروض

    const isSupport = !!(next && next.viewer === 'support');

    // القراءة الأولى تُسجّل ولا تُحرّك. بدون هذا الحدّ يقع الأسوأ: مشرفٌ يفتح
    // القوقعة وجلسته حيّة أصلاً ⇒ «لا جلسة → جلسة» تُقرأ تحوّلاً فيُعاد التحميل،
    // ثم تُقرأ ثانيةً بعد التحميل… حلقةٌ لا تنتهي. والقوقعة في هذه الحال بُنيت
    // على الجلسة أصلاً (auth.loadProfile قرأها)، فلا شيء يستوجب إعادة بناء.
    if (!settled) {
      settled = true;
      session = next; wasSupport = isSupport;
      render();
      return;
    }

    // والتحوّلان يخصّان قوقعة التطبيق وحدها. لوحة المشرف لا تُبنى على ملعب
    // أصلاً — بياناتها كلّها دوالّ definer — فلا شيء فيها ينقلب مع الجلسة،
    // وإعادة تحميلها عند كل فتحٍ وإغلاق إزعاجٌ بلا مقابل.
    if (shell === 'owner' && isSupport && !wasSupport) {
      // فُعّلت الجلسة ونحن داخل قوقعة بُنيت بلا ملفّ
      session = next; wasSupport = true;
      window.location.reload();
      return;
    }
    if (shell === 'owner' && !isSupport && wasSupport) {
      wasSupport = false;
      window.utils.toast('انتهت جلسة النيابة', 'info');
      // الحزمة الأصلية لا خادم فيها ولا إعادة كتابة لـ /admin/* — الملفّ مباشرةً
      window.location.replace(window.native && window.native.isNative
        ? '/admin.html'
        : window.utils.path('/admin/overview'));
      return;
    }
    session = next;
    wasSupport = isSupport;
    render();
  }

  function startTicking() {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      if (!session) return;
      // بلغت النهاية ⇒ اسأل الخادم بدل أن تُخمّن (قد تكون أُنهيت يدوياً كذلك)
      if (minutesLeft(session) <= 0) refresh();
      else render();
    }, TICK_MS);
  }

  function mount(slot, opts) {
    slotEl = slot;
    shell = (opts && opts.shell) || 'owner';
    if (!slotEl || !window.supportApi) return;
    slotEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-support-act]');
      if (btn) act(btn.getAttribute('data-support-act'));
    });
    if (window.realtime) window.realtime.on('support:change', () => refresh());
    // العودة من الخلفية بعد ساعة: ما على الشاشة قد يكون جلسةً ماتت
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh();
    });
    startTicking();
    refresh();
  }

  // يستدعيها مرشد المساعدة حين يعجز الشرح: «ما زلت محتاج مساعدة»
  async function requestHelp(reason) {
    const id = await window.supportApi.requestHelp(reason);
    await refresh();
    return id;
  }

  return { mount, refresh, requestHelp, current: () => session };
})();
