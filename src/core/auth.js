// إدارة المصادقة وحماية الصفحات
// يعتمد على window.sb و window.utils

window.auth = (function () {
  let currentProfile = null;
  let currentStatus = null;       // ذاكرة مؤقتة لحالة الاشتراك
  let currentIsAdmin = null;      // ذاكرة مؤقتة لـ super-admin

  // يضيف base path (لـ GitHub Pages /marma/) إلى المسار المطلق
  // في dev أو custom domain يبقى المسار كما هو.
  //
  // وفي التطبيق الأصلي يمرّ المسار كذلك على native.docPath: Capacitor يخدم
  // index.html لأي مسار بلا امتداد، فـ '/auth/login' كان سيفتح قوقعة التطبيق بدل
  // صفحة الدخول — وهذه الدالة هي مصبّ كل ملاحة مستندات في هذا الملف، فإصلاحها
  // هنا يُصلح المسارات الستّة معاً.
  function withBase(path) {
    const resolved = window.native ? window.native.docPath(path) : path;
    return (window.__BASE__ || '') + resolved;
  }

  // خطأ عابر (شبكة) لا يعني أن الجلسة باطلة — لا يجوز تسجيل الخروج عنده
  function isTransientError(err) {
    if (!err) return false;
    if (typeof err.status === 'number' && err.status !== 0) return false; // رد فعلي من الخادم
    const m = (err.message || '').toLowerCase();
    return err.name === 'TypeError' || /failed to fetch|networkerror|network request failed|load failed/.test(m);
  }

  // هل الخطأ يثبت أن الجلسة/الحساب باطلان فعلًا؟ فقط عندها يجوز إتلاف الجلسة.
  // كل ما عداه (5xx أثناء نشر تحديث، إعادة تحميل مخطط PostgREST بعد migration،
  // انقطاع لحظي من الحافة) عابرٌ مهما كان شكله — كان يُعامَل خطأً كخطأ مصادقة
  // فيُسجّل خروج المالك عند كل رفعة تحديث.
  function isAuthDeadError(err) {
    if (!err) return false;
    if (err.status === 401) return true;                      // رمز وصول/تحديث باطل
    const code = err.code || '';
    if (code === 'PGRST301' || code === 'PGRST302') return true; // JWT مرفوض من PostgREST
    if (code === 'PGRST116') return true;                     // لا صف profile → حساب غير سليم
    const m = (err.message || '').toLowerCase();
    return /jwt|refresh token|invalid claim|token is expired/.test(m);
  }

  // يضمن جلسة صالحة: يقرأ المخزّنة ويحدّثها استباقيًا إن انتهت/قاربت الانتهاء.
  // هذا يمنع «الخروج بعد خمول»: عند فتح التطبيق برمز وصول منتهٍ نحدّثه بدل أن
  // يفشل أول طلب فيُسجّل الخروج. يُرجع null فقط لو لا جلسة أو رمز التحديث باطل.
  async function ensureSession() {
    const { data: { session }, error } = await window.sb.auth.getSession();
    if (error) { console.error('فشل قراءة الجلسة:', error); return null; }
    if (!session) return null;
    const expMs = (session.expires_at || 0) * 1000;
    // حدّث لو انتهى أو يقارب (هامش 60 ثانية)
    if (expMs && expMs < Date.now() + 60000) {
      const { data, error: rErr } = await window.sb.auth.refreshSession();
      if (rErr) {
        // خطأ شبكة عابر → أبقِ الجلسة الحالية (سيُحدَّث لاحقًا)؛ خطأ مصادقة → باطلة
        return isTransientError(rErr) ? session : null;
      }
      return (data && data.session) || session;
    }
    return session;
  }

  // التحقق من الجلسة. ترجع session (محدَّثة عند اللزوم) أو null إذا غير مسجل
  async function getSession() {
    try {
      return await ensureSession();
    } catch (err) {
      // فشل غير متوقّع: لا نُبطل الجلسة — نرجع المخزّنة كما هي إن وُجدت
      console.error('فشل التحقق من الجلسة:', err);
      try { const { data } = await window.sb.auth.getSession(); return data.session || null; }
      catch (_) { return null; }
    }
  }

  // جلب الملف الشخصي مع بيانات الملعب والاشتراك
  async function loadProfile() {
    if (currentProfile) return currentProfile;
    // نعتمد على جلسة محلية مُتحقَّقة (ومحدَّثة عند اللزوم) بدل طلب getUser() شبكي
    // يُستدعى في كل تحميل — كان فشله العابر يقود لتسجيل خروج خاطئ بعد الخمول.
    const session = await ensureSession();
    const user = session && session.user;
    if (!user) {
      throw new Error('UNAUTHENTICATED');
    }
    const { data, error } = await window.sb
      .from('profiles')
      .select('id, tenant_id, full_name, role, tenants(id, name, trial_ends_at, subscription_ends_at, subscription_status, description, cover_image_url, logo_url, show_manage_banner)')
      .eq('id', user.id)
      .single();
    if (error) {
      console.error('فشل جلب الملف الشخصي:', error);
      throw error;
    }
    currentProfile = data;
    return data;
  }

  // جلب حالة الاشتراك من السيرفر (RPC مخصص)
  async function loadSubscriptionStatus({ force } = {}) {
    if (currentStatus && !force) return currentStatus;
    const { data, error } = await window.sb.rpc('get_my_subscription_status');
    if (error) throw error;
    currentStatus = data || null;
    return currentStatus;
  }

  // التحقق من أن المستخدم super-admin
  async function checkIsSuperAdmin({ force } = {}) {
    if (currentIsAdmin !== null && !force) return currentIsAdmin;
    const { data, error } = await window.sb
      .from('app_admins')
      .select('user_id')
      .limit(1);
    if (error) {
      console.error('فشل التحقق من super-admin:', error);
      currentIsAdmin = false;
      return false;
    }
    currentIsAdmin = Array.isArray(data) && data.length > 0;
    return currentIsAdmin;
  }

  // حماية صفحة - تُستدعى في بداية أي صفحة محمية
  async function requireAuth(redirectTo = '/auth/login') {
    const session = await getSession();
    if (!session) {
      window.location.replace(withBase(redirectTo));
      throw new Error('UNAUTHENTICATED');
    }
    try {
      const profile = await loadProfile();
      return { user: session.user, profile, tenant: profile.tenants };
    } catch (err) {
      // لا نُتلف الجلسة إلا عند دليل قاطع على بطلانها (401/JWT/لا profile).
      // أي فشل آخر — شبكة، 5xx لحظة نشر تحديث، إعادة تحميل مخطط PostgREST بعد
      // migration — عابر: وجّه للدخول مع إبقاء الجلسة، وredirectIfAuthenticated
      // في صفحة الدخول يعيد المستخدم تلقائيًّا فور تعافي الخادم.
      if (isAuthDeadError(err)) {
        try { if (window.push && window.push.teardown) await window.push.teardown(); } catch (_) {}
        await window.sb.auth.signOut();
      }
      window.location.replace(withBase(redirectTo));
      throw err;
    }
  }

  // التحقق من أن المستخدم مالك، وإلا التوجيه
  async function requireOwner(redirectTo = '/dashboard') {
    const ctx = await requireAuth();
    if (ctx.profile.role !== 'owner') {
      window.utils.toast('هذه الصفحة متاحة لمالك الملعب فقط', 'warning');
      window.location.replace(withBase(redirectTo));
      throw new Error('FORBIDDEN');
    }
    return ctx;
  }

  // التحقق من أن tenant نشط (داخل التجربة أو الاشتراك أو فترة السماح)
  // يضيف status إلى context المُرجَع
  // مرر redirectTo=false للحصول على الخطأ فقط بدون توجيه (يستخدمه SPA boot)
  async function requireActiveTenant(redirectTo = '/subscription') {
    const ctx = await requireAuth();
    const status = await loadSubscriptionStatus();
    if (!status || !status.is_active) {
      if (redirectTo) window.location.replace(withBase(redirectTo));
      throw new Error('SUBSCRIPTION_EXPIRED');
    }
    return Object.assign({}, ctx, { status });
  }

  // حماية صفحات admin
  async function requireSuperAdmin(redirectTo = '/auth/login') {
    const session = await getSession();
    if (!session) {
      window.location.replace(withBase(redirectTo));
      throw new Error('UNAUTHENTICATED');
    }
    const isAdmin = await checkIsSuperAdmin();
    if (!isAdmin) {
      window.utils.toast('هذه الصفحة للمشرف العام فقط', 'error');
      window.location.replace(withBase('/'));
      throw new Error('NOT_SUPER_ADMIN');
    }
    return { user: session.user, isSuperAdmin: true };
  }

  // يحدد الوجهة الصحيحة بعد تسجيل الدخول (مع base path):
  // - إذا له profile (مالك أو موظف) → /[base]/dashboard
  // - إذا لا profile لكن super-admin → /[base]/admin/overview
  // - غير ذلك → null (يجب تسجيل الخروج)
  async function getPostLoginDestination() {
    const { data: { user } } = await window.sb.auth.getUser();
    if (!user) return null;
    const { data: profile } = await window.sb
      .from('profiles').select('id, tenant_id, role').eq('id', user.id).maybeSingle();
    if (profile) {
      // مالك بدون أرضيات → onboarding لإضافة الملعب الأول
      if (profile.role === 'owner' && profile.tenant_id) {
        const { count } = await window.sb
          .from('fields')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', profile.tenant_id);
        if (!count) {
          try { sessionStorage.setItem('marma:onboarding:pending', '1'); } catch (_) {}
          return withBase('/fields?onboarding=1');
        }
      }
      return withBase('/dashboard');
    }
    const isAdmin = await checkIsSuperAdmin({ force: true });
    if (isAdmin) return withBase('/admin/overview');
    // مالك جديد بلا منشأة (بريد أو OAuth) → ندخله التطبيق، وإقلاعه يعرض شاشة الإعداد
    return withBase('/dashboard');
  }

  // هل يحتاج المستخدم لإعداد أوّل (مسجَّل، بلا profile، وليس مشرفًا)؟
  async function needsOwnerOnboarding() {
    const session = await getSession();
    if (!session) return false;
    const { data: profile } = await window.sb
      .from('profiles').select('id').eq('id', session.user.id).maybeSingle();
    if (profile) return false;
    const isAdmin = await checkIsSuperAdmin();
    return !isAdmin;
  }

  // إعادة توجيه المستخدمين المسجلين بعيداً عن صفحات login/signup
  async function redirectIfAuthenticated() {
    const session = await getSession();
    if (!session) return;
    const dest = await getPostLoginDestination();
    if (dest) {
      window.location.replace(dest);
    } else {
      await window.sb.auth.signOut();
      window.utils && window.utils.toast && window.utils.toast('حسابك غير مرتبط بأي ملعب', 'error');
    }
  }

  // دخول/تسجيل عبر مزوّد OAuth.
  //
  // على الويب: تحويلٌ عادي ثم عودة لنفس الصفحة.
  //
  // في التطبيق الأصلي لا يجوز أن يحدث ذلك داخل الـ webview: قوقل تحجب OAuth في
  // العروض المضمّنة صراحةً وترد disallowed_useragent — فيبقى زرّ «المتابعة بحساب
  // Google» زرًّا لا يعمل، وميزةٌ معطّلة سببُ رفضٍ في المراجعة قبل أن تكون عيباً
  // للمستخدم. والحلّ المعتمد: نفتح صفحة المزوّد في متصفّح النظام (Safari View
  // Controller / Chrome Custom Tab)، ويعود بنا رابطٌ مخصّص إلى التطبيق فنبادل
  // الرمز بجلسة. نفس تدفّق PKCE الحالي — يتغيّر مكان تنفيذه لا آليّته.
  const NATIVE_REDIRECT = 'help.marma.app://auth/callback';

  async function signInWithProvider(provider) {
    const isNativeApp = !!(window.native && window.native.isNative);

    if (!isNativeApp) {
      const { error } = await window.sb.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin + window.location.pathname }
      });
      if (error && window.utils) window.utils.toast(window.utils.formatError(error), 'error');
      return;
    }

    const { data, error } = await window.sb.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: NATIVE_REDIRECT,
        // لا تُحوّل الـ webview بنفسك — نحن نفتح الرابط في متصفّح النظام
        skipBrowserRedirect: true
      }
    });
    if (error || !data || !data.url) {
      if (window.utils) window.utils.toast(window.utils.formatError(error || new Error('تعذّر بدء تسجيل الدخول')), 'error');
      return;
    }

    const Browser = window.native.plugin('Browser');
    if (!Browser) {
      window.location.href = data.url;   // احتياط بعيد الاحتمال
      return;
    }

    // العودة تصل كحدث appUrlOpen — نلتقطها مرّة واحدة ونبادل الرمز بجلسة
    const App = window.native.plugin('App');
    let listener = null;
    const finish = async (url) => {
      try {
        const parsed = new URL(url);
        // الرمز قد يأتي في الاستعلام (PKCE) — وقد يحمل الرابط خطأً من المزوّد
        const code = parsed.searchParams.get('code');
        const errDesc = parsed.searchParams.get('error_description') || parsed.searchParams.get('error');
        if (errDesc) {
          if (window.utils) window.utils.toast(decodeURIComponent(errDesc), 'error');
          return;
        }
        if (!code) return;
        const { error: exErr } = await window.sb.auth.exchangeCodeForSession(code);
        if (exErr) {
          if (window.utils) window.utils.toast(window.utils.formatError(exErr), 'error');
          return;
        }
        const dest = await getPostLoginDestination();
        window.location.replace(dest || withBase('/dashboard'));
      } finally {
        try { await Browser.close(); } catch (_) {}
        if (listener && listener.remove) { try { await listener.remove(); } catch (_) {} }
      }
    };

    if (App) {
      listener = await App.addListener('appUrlOpen', ({ url }) => {
        if (typeof url === 'string' && url.startsWith('help.marma.app://auth')) finish(url);
      });
    }

    try {
      await Browser.open({ url: data.url, presentationStyle: 'popover' });
    } catch (err) {
      if (window.utils) window.utils.toast(window.utils.formatError(err), 'error');
      if (listener && listener.remove) { try { await listener.remove(); } catch (_) {} }
    }
  }
  function signInWithGoogle() { return signInWithProvider('google'); }
  function signInWithApple() { return signInWithProvider('apple'); }

  // معالجة العودة من OAuth: يبدّل code بجلسة (PKCE) وينظّف الرابط. يُرجع true عند النجاح.
  async function handleOAuthCallback() {
    const url = new URL(window.location.href);
    const errDesc = url.searchParams.get('error_description') || url.searchParams.get('error');
    const code = url.searchParams.get('code');
    if (errDesc) {
      if (window.utils) window.utils.toast(decodeURIComponent(errDesc), 'error');
      window.history.replaceState({}, '', url.pathname);
      return false;
    }
    if (!code) return false;
    const { error } = await window.sb.auth.exchangeCodeForSession(code);
    window.history.replaceState({}, '', url.pathname);
    if (error) {
      if (window.utils) window.utils.toast(window.utils.formatError(error), 'error');
      return false;
    }
    return true;
  }

  async function signOut(redirectTo = '/auth/login') {
    // ألغِ اشتراك push للجهاز قبل إنهاء الجلسة (حذف صف DB يتطلب جلسة حيّة) —
    // وإلا بقي الجهاز يستقبل إشعارات الحساب بعد الخروج. fail-silent: أي فشل
    // هنا لا يعطّل الخروج أبدًا.
    try { if (window.push && window.push.teardown) await window.push.teardown(); } catch (_) {}
    if (window.realtime) await window.realtime.stop();
    await window.sb.auth.signOut();
    currentProfile = null;
    currentStatus = null;
    currentIsAdmin = null;
    if (window.store) window.store.clearAll();
    window.location.replace(withBase(redirectTo));
  }

  return {
    getSession,
    loadProfile,
    loadSubscriptionStatus,
    checkIsSuperAdmin,
    requireAuth,
    requireOwner,
    requireActiveTenant,
    requireSuperAdmin,
    redirectIfAuthenticated,
    getPostLoginDestination,
    needsOwnerOnboarding,
    signInWithGoogle,
    signInWithApple,
    handleOAuthCallback,
    signOut
  };
})();
