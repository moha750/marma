// شاشة الإعداد الأوّل للمالك الجديد (مسجَّل بلا منشأة): يجمع اسم المنشأة وينشئها
// عبر RPC create_owner_tenant، ثم يرشد لإضافة أول ملعب. يُعرض من boot.js قبل الـ shell.
window.onboarding = (function () {
  function withBase(p) { return (window.__BASE__ || '') + p; }

  async function firstName() {
    try {
      const { data: { user } } = await window.sb.auth.getUser();
      const m = (user && user.user_metadata) || {};
      const full = (m.full_name || m.name || '').trim();
      return full ? full.split(/\s+/)[0] : '';
    } catch (_) { return ''; }
  }

  const esc = (s) => window.utils.escapeHtml(s);

  // مسودّة مؤقّتة تبقى ضمن جلسة التبويب فقط (تُمسح عند إغلاقه)، فلا تتسرّب لمستخدم آخر.
  const DRAFT_KEY = 'marma:onboarding:draft';
  function loadDraft() {
    try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}') || {}; }
    catch (_) { return {}; }
  }
  function saveDraft(d) {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ name: d.name, phone: d.phone })); } catch (_) {}
  }
  function clearDraft() {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch (_) {}
  }

  async function show() {
    const root = document.getElementById('app-root');
    if (!root) return;
    const first = await firstName();
    const hi = first ? `أهلاً ${esc(first)} 👋` : 'أهلاً بك في مَرمى 👋';

    // حالة المعالج: نجمع القيم عبر الخطوات ثم ننشئ دفعةً واحدة في النهاية.
    // نستعيد ما كُتب سابقاً (لو خرج المستخدم في المنتصف ورجع).
    const draft = loadDraft();
    const state = { name: draft.name || '', phone: draft.phone || '' };

    return new Promise((resolve) => {
      root.innerHTML = '<div class="onb-wrap"><div class="onb-card" id="onb-card"></div></div>';
      const card = root.querySelector('#onb-card');

      // رأس البطاقة: الشعار + مؤشّر الخطوات (نقطتان)
      function header(step) {
        return ''
          + '<img src="' + withBase('/assets/logo.svg') + '" alt="مَرمى" width="56" height="56" style="margin-bottom:var(--space-3)">'
          + '<div class="onb-steps" aria-hidden="true">'
          + '  <span class="onb-step-dot' + (step >= 1 ? ' is-active' : '') + '"></span>'
          + '  <span class="onb-step-dot' + (step >= 2 ? ' is-active' : '') + '"></span>'
          + '</div>';
      }

      // الخطوة 1: اسم المنشأة (الأقل حساسية والأكثر تحفيزاً)
      function renderName() {
        card.innerHTML = header(1)
          + '<h1 class="onb-title">' + hi + '</h1>'
          + '<p class="onb-sub">ما اسم منشأتك أو ملاعبك؟ (يظهر لعملائك عند الحجز)</p>'
          + '<form id="onb-form">'
          + '  <div class="form-group">'
          + '    <input type="text" class="form-control" id="onb-name" name="name" required maxlength="80" placeholder="مثال: ملاعب النخبة" value="' + esc(state.name) + '">'
          + '  </div>'
          + '  <button type="submit" class="btn btn--primary btn--block"><span class="btn-text">التالي</span></button>'
          + '</form>';
        const form = card.querySelector('#onb-form');
        const input = card.querySelector('#onb-name');
        setTimeout(() => input.focus(), 50);
        input.addEventListener('input', () => { state.name = input.value.trim(); saveDraft(state); });
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const v = input.value.trim();
          if (!v) return;
          state.name = v;
          saveDraft(state);
          renderPhone();
        });
      }

      // الخطوة 2: جوّال المالك (أكثر خصوصية — نؤجّله ونوضّح سببه)
      function renderPhone() {
        card.innerHTML = header(2)
          + '<h1 class="onb-title">خطوة أخيرة</h1>'
          + '<p class="onb-sub">ما رقم جوّالك؟ للتواصل معك بشأن الاشتراك والدعم — لا يظهر لعملائك.</p>'
          + '<form id="onb-form">'
          + '  <div class="form-group">'
          + '    <input type="tel" class="form-control" id="onb-phone" name="phone" required dir="ltr" inputmode="numeric" autocomplete="tel" maxlength="10" pattern="05[0-9]{8}" placeholder="05XXXXXXXX" value="' + esc(state.phone) + '">'
          + '  </div>'
          + '  <button type="submit" class="btn btn--primary btn--block" id="onb-submit"><span class="btn-text">إنشاء وإضافة أول ملعب</span></button>'
          + '  <button type="button" class="btn btn--ghost btn--block" id="onb-back" style="margin-top:var(--space-2)">رجوع</button>'
          + '</form>';
        const form = card.querySelector('#onb-form');
        const input = card.querySelector('#onb-phone');
        const submit = card.querySelector('#onb-submit');
        setTimeout(() => input.focus(), 50);
        // أرقام فقط، 10 خانات كحدّ أقصى (صيغة الجوّال السعودي 05XXXXXXXX)
        input.addEventListener('input', () => {
          input.value = input.value.replace(/\D/g, '').slice(0, 10);
          state.phone = input.value;
          saveDraft(state);
        });
        card.querySelector('#onb-back').addEventListener('click', () => {
          state.phone = input.value.trim();
          saveDraft(state);
          renderName();
        });
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const phone = input.value.trim();
          if (!/^05\d{8}$/.test(phone)) {
            window.utils.toast('أدخل رقم جوال سعودي صحيح يبدأ بـ05 (10 أرقام)', 'error');
            input.focus();
            return;
          }
          state.phone = phone;
          submit.disabled = true;
          submit.querySelector('.btn-text').textContent = 'جارٍ الإنشاء...';
          try {
            await window.sb.rpc('create_owner_tenant', { p_name: state.name, p_phone: state.phone });
            clearDraft(); // اكتمل الإعداد — لا حاجة للمسودّة
            // تدفّق مباشر إلى الإعداد الكامل للملعب (يفتح المودال تلقائيًّا في صفحة الملاعب)
            try { sessionStorage.setItem('marma:onboarding:pending', '1'); } catch (_) {}
            window.utils.toast('تمّ إنشاء منشأتك — بدأت تجربتك المجانية 🎉', 'success');
            window.location.href = withBase('/fields?onboarding=1');
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
            submit.disabled = false;
            submit.querySelector('.btn-text').textContent = 'إنشاء وإضافة أول ملعب';
          }
        });
      }

      // استأنف من خطوة الجوّال إن كان الاسم محفوظاً في المسودّة (رجع بعد خروج)
      if (state.name) renderPhone(); else renderName();
    });
  }

  return { show };
})();
