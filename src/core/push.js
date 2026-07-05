// إدارة Push Notifications من جانب العميل.
//
// واجهة عامة على window.push:
//   isSupported()    → bool — يدعم المتصفح Push + Notifications API؟
//   permission()     → 'default' | 'granted' | 'denied'
//   isSubscribed()   → Promise<bool> — هل الجهاز مشترك حالياً؟
//   subscribe()      → Promise<{ ok, error?, reason? }> — بنية المستخدم (يمسح علامة الإيقاف)
//   unsubscribe()    → Promise<{ ok, error? }> — إيقاف بنية المستخدم (يثبّت علامة الإيقاف)
//   teardown()       → تنظيف عند تسجيل الخروج: يلغي اشتراك الجهاز وصف DB
//                      دون المساس بتفضيل المستخدم — حتى لا يستقبل الجهاز
//                      إشعارات حساب خرج منه صاحبه.
//   ensureSync()     → بعد الدخول: يعيد تسجيل الجهاز للحساب الحالي (عبر RPC
//                      claim_push_subscription الذي ينقل الملكية عند تبديل
//                      الحسابات)، ويعيد إنشاء الاشتراك بصمت إن كان الإذن ممنوحًا
//                      (يحدث بعد teardown الخروج) — ما لم يوقفه المستخدم بنفسه.
//
// أحداث على window:
//   push:subscribed
//   push:unsubscribed
//   push:denied

(function () {
  const VAPID_PUBLIC_KEY =
    (window.APP_CONFIG && window.APP_CONFIG.VAPID_PUBLIC_KEY) || '';

  function isSupported() {
    return (
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  function permission() {
    if (!('Notification' in window)) return 'denied';
    return Notification.permission; // 'default' | 'granted' | 'denied'
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = window.atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
    return out;
  }

  function arrayBufferToBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function getRegistration() {
    if (!('serviceWorker' in navigator)) return null;
    return navigator.serviceWorker.ready;
  }

  async function isSubscribed() {
    if (!isSupported()) return false;
    const reg = await getRegistration();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  }

  // علامة إيقاف المستخدم اليدوي — تمنع ensureSync من إعادة التفعيل رغمًا عنه
  const DISABLED_KEY = 'marma:push:disabled';
  function userDisabled() {
    try { return localStorage.getItem(DISABLED_KEY) === '1'; } catch (_) { return false; }
  }
  function setUserDisabled(v) {
    try { v ? localStorage.setItem(DISABLED_KEY, '1') : localStorage.removeItem(DISABLED_KEY); } catch (_) {}
  }

  async function saveSubscriptionToDB(sub) {
    if (!window.sb) throw new Error('Supabase client unavailable');
    // RPC ينقل ملكية الـendpoint للمستخدم الحالي (يصلح تبديل الحسابات على نفس
    // الجهاز — upsert المباشر كان يفشل بصمت على صف مستخدم سابق بسبب RLS)
    const json = sub.toJSON();
    const { error } = await window.sb.rpc('claim_push_subscription', {
      p_endpoint: sub.endpoint,
      p_p256dh: json.keys.p256dh,
      p_auth: json.keys.auth,
      p_user_agent: navigator.userAgent || null
    });
    if (error) throw error;
  }

  async function deleteSubscriptionFromDB(endpoint) {
    if (!window.sb) return;
    await window.sb.from('push_subscriptions').delete().eq('endpoint', endpoint);
  }

  async function subscribe() {
    if (!isSupported()) return { ok: false, reason: 'unsupported' };
    if (!VAPID_PUBLIC_KEY) return { ok: false, reason: 'misconfigured' };

    const reg = await getRegistration();
    if (!reg) return { ok: false, reason: 'no-sw' };

    // اطلب الإذن أولاً
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      window.dispatchEvent(new CustomEvent('push:denied'));
      return { ok: false, reason: 'denied' };
    }

    try {
      // إذا كان مشترك أصلاً، استخدم الاشتراك الحالي
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
      }
      await saveSubscriptionToDB(sub);
      setUserDisabled(false); // تفعيل صريح → ألغِ أي إيقاف سابق
      window.dispatchEvent(new CustomEvent('push:subscribed'));
      return { ok: true };
    } catch (err) {
      console.warn('[push] subscribe failed:', err);
      return { ok: false, error: String(err && err.message || err) };
    }
  }

  // إلغاء الاشتراك الفعلي (جهاز + DB) — مشترك بين إيقاف المستخدم وتنظيف الخروج
  async function removeSubscription() {
    if (!isSupported()) return { ok: true };
    const reg = await getRegistration();
    if (!reg) return { ok: true };
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return { ok: true };
    const endpoint = sub.endpoint;
    try {
      await sub.unsubscribe();
      await deleteSubscriptionFromDB(endpoint);
      window.dispatchEvent(new CustomEvent('push:unsubscribed'));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  }

  // إيقاف بنيّة المستخدم (زر الإيقاف في الإعدادات) — يُثبّت التفضيل
  async function unsubscribe() {
    const res = await removeSubscription();
    if (res.ok) setUserDisabled(true);
    return res;
  }

  // تنظيف الخروج: الجهاز يجب ألا يستقبل إشعارات حساب خرج صاحبه منه.
  // لا يمسّ تفضيل المستخدم — ensureSync يعيد التفعيل بصمت بعد الدخول التالي.
  // يُستدعى والجلسة ما زالت حيّة (قبل sb.auth.signOut) ليتمكن من حذف صف DB.
  async function teardown() {
    try { return await removeSubscription(); } catch (_) { return { ok: false }; }
  }

  // يُستدعى بعد الدخول (إقلاع لوحة المالك):
  //  - اشتراك قائم → أعد تسجيله للحساب الحالي (نقل ملكية عند تبديل الحسابات)
  //  - لا اشتراك والإذن ممنوح → أنشئه بصمت (استعادة ما أزاله teardown الخروج)
  //  - المستخدم أوقفه يدويًا → لا تفعل شيئًا
  async function ensureSync() {
    if (!isSupported()) return;
    if (permission() !== 'granted') return;
    if (userDisabled()) return;
    if (!VAPID_PUBLIC_KEY) return;
    try {
      const reg = await getRegistration();
      if (!reg) return;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        // الإذن ممنوح مسبقًا → لا نافذة إذن تظهر للمستخدم
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
      }
      await saveSubscriptionToDB(sub);
    } catch (_) { /* صامت — الإشعارات كمالية ولا تعطّل الإقلاع */ }
  }

  window.push = { isSupported, permission, isSubscribed, subscribe, unsubscribe, teardown, ensureSync };
})();
