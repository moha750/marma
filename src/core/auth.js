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

  // التحقق من الجلسة. ترجع session أو null إذا غير مسجل
  async function getSession() {
    const { data: { session }, error } = await window.sb.auth.getSession();
    if (error) {
      console.error('فشل التحقق من الجلسة:', error);
      return null;
    }
    return session;
  }

  // جلب الملف الشخصي مع بيانات الملعب والاشتراك
  async function loadProfile() {
    if (currentProfile) return currentProfile;
    const { data: { user }, error: userErr } = await window.sb.auth.getUser();
    if (userErr || !user) {
      throw userErr || new Error('UNAUTHENTICATED');
    }
    const { data, error } = await window.sb
      .from('profiles')
      .select('id, tenant_id, full_name, role, tenants(id, name, city, phone, trial_ends_at, subscription_ends_at, subscription_status)')
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
  // - إذا لا profile لكن super-admin → /[base]/admin/subscriptions
  // - غير ذلك → null (يجب تسجيل الخروج)
  async function getPostLoginDestination() {
    const { data: { user } } = await window.sb.auth.getUser();
    if (!user) return null;
    const { data: profile } = await window.sb
      .from('profiles').select('id').eq('id', user.id).maybeSingle();
    if (profile) return withBase('/dashboard');
    const isAdmin = await checkIsSuperAdmin({ force: true });
    if (isAdmin) return withBase('/admin/subscriptions');
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
