// إدارة Push Notifications من جانب العميل.
//
// واجهة عامة على window.push:
//   isSupported()    → bool — يدعم المتصفح Push + Notifications API؟
//   permission()     → 'default' | 'granted' | 'denied'
//   isSubscribed()   → Promise<bool> — هل الجهاز مشترك حالياً؟
//   subscribe()      → Promise<{ ok, error?, reason? }>
//   unsubscribe()    → Promise<{ ok, error? }>
//   ensureSync()     → يضمن أن الاشتراك المحلي مسجَّل في DB (يستدعى بعد login)
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

  async function saveSubscriptionToDB(sub) {
    if (!window.sb) throw new Error('Supabase client unavailable');
    const { data: { user } } = await window.sb.auth.getUser();
    if (!user) throw new Error('غير مسجّل دخول');

    // نحتاج tenant_id من profile
    const ctx = window.layout && window.layout.getContext ? window.layout.getContext() : null;
    let tenantId = ctx && ctx.profile ? ctx.profile.tenant_id : null;
    if (!tenantId) {
      const { data: profile } = await window.sb
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();
      tenantId = profile && profile.tenant_id;
    }
    if (!tenantId) throw new Error('لا يوجد ملعب مرتبط بالحساب');

    const json = sub.toJSON();
    const row = {
      user_id: user.id,
      tenant_id: tenantId,
      endpoint: sub.endpoint,
      p256dh_key: json.keys.p256dh,
      auth_key: json.keys.auth,
      user_agent: navigator.userAgent || null
    };

    // upsert على endpoint (للتعامل مع إعادة الاشتراك)
    const { error } = await window.sb
      .from('push_subscriptions')
      .upsert(row, { onConflict: 'endpoint' });
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
      window.dispatchEvent(new CustomEvent('push:subscribed'));
      return { ok: true };
    } catch (err) {
      console.warn('[push] subscribe failed:', err);
      return { ok: false, error: String(err && err.message || err) };
    }
  }

  async function unsubscribe() {
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

  // يُستدعى بعد login: لو المتصفح يحوي اشتراكاً نشطاً لكنه غير موجود في DB
  // (مثلاً غيّر المستخدم أو امتسحت DB)، أعد حفظه.
  async function ensureSync() {
    if (!isSupported()) return;
    if (permission() !== 'granted') return;
    const reg = await getRegistration();
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    try { await saveSubscriptionToDB(sub); } catch (_) {}
  }

  window.push = { isSupported, permission, isSubscribed, subscribe, unsubscribe, ensureSync };
})();
