// إدارة المصادقة وحماية الصفحات
// يعتمد على window.sb و window.utils

window.auth = (function () {
  let currentProfile = null;
  let currentStatus = null;       // ذاكرة مؤقتة لحالة الاشتراك
  let currentIsAdmin = null;      // ذاكرة مؤقتة لـ super-admin

  // يضيف base path (لـ GitHub Pages /marma/) إلى المسار المطلق
  // في dev أو custom domain يبقى المسار كما هو
  function withBase(path) {
    return (window.__BASE__ || '') + path;
  }

  // خطأ عابر (شبكة) لا يعني أن الجلسة باطلة — لا يجوز تسجيل الخروج عنده
  function isTransientError(err) {
    if (!err) return false;
    if (typeof err.status === 'number' && err.status !== 0) return false; // رد فعلي من الخادم
    const m = (err.message || '').toLowerCase();
    return err.name === 'TypeError' || /failed to fetch|networkerror|network request failed|load failed/.test(m);
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
      .select('id, tenant_id, full_name, role, tenants(id, name, trial_ends_at, subscription_ends_at, subscription_status, description, cover_image_url)')
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
      // خطأ عابر (شبكة): لا تُتلف الجلسة — وجّه للدخول مع الإبقاء عليها ليعود
      // المستخدم تلقائيًّا عند توفّر الشبكة (redirectIfAuthenticated يُعيده).
      if (isTransientError(err)) {
        window.location.replace(withBase(redirectTo));
        throw err;
      }
      // خطأ مصادقة حقيقي أو حساب غير سليم: نظّف وسجّل الخروج
      await window.sb.auth.signOut();
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
    return null;
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

  async function signOut(redirectTo = '/auth/login') {
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
    signOut
  };
})();
