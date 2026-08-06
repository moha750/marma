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

  // ─── المسار الأصلي (APNs / FCM) ───────────────────────────────────────────
  //
  // Web Push لا يعمل داخل قوقعة التطبيق إطلاقاً: WKWebView على iOS لا يملك Push
  // API، وWebView على أندرويد كذلك. فلو تركنا المسار الواحد لبقي زرّ «تفعيل
  // الإشعارات» في التطبيق زرًّا لا يفعل شيئاً — وهو أسوأ من غيابه، لأن المالك
  // يظنّ أنه سيُنبَّه لحجزٍ جديد فلا يُنبَّه.
  //
  // الواجهة العامة أدناه لا تتغيّر: كل دالة تتفرّع في أول سطر بحسب البيئة، فصفحة
  // الإعدادات وboot.js يستدعيانها كما هما.

  const isNativeApp = !!(window.native && window.native.isNative);
  const nativePlatform = isNativeApp ? window.native.platform : 'web';

  function pushPlugin() {
    return window.native ? window.native.plugin('PushNotifications') : null;
  }

  // يُسجّل رمز الجهاز في قاعدتنا. RPC لا upsert مباشر: الرمز واحدٌ على مستوى
  // الجهاز، فتبديل الحساب على نفس الجوّال يحتاج نقلَ ملكيةٍ تمنعه RLS.
  async function saveNativeToken(token) {
    if (!window.sb) throw new Error('Supabase client unavailable');
    const { error } = await window.sb.rpc('claim_native_push_token', {
      p_token: token,
      p_platform: nativePlatform,
      p_device: (navigator.userAgent || '').slice(0, 300)
    });
    if (error) throw error;
  }

  let nativeWired = false;
  let pendingToken = null;

  // ── انتظار التسجيل الفعلي ──
  // register() لا تُرجع الرمز: النظام يسلّمه لاحقاً إلى AppDelegate فيصل عبر
  // مستمع 'registration'، ثم نحفظه في قاعدتنا برحلة شبكة أخرى. فلو رجعت
  // subscribe() فور register() لسألت الواجهةُ «هل اشترك؟» قبل وجود الصفّ
  // فتقرأ «لا» — وهذا ما جعل الزرّ لا يستجيب إلا من الضغطة الثانية.
  let registrationWaiters = [];
  function settleRegistration(result) {
    const waiters = registrationWaiters;
    registrationWaiters = [];
    waiters.forEach((fn) => fn(result));
  }
  function awaitRegistration(ms) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (r) => { if (!done) { done = true; resolve(r); } };
      registrationWaiters.push(finish);
      // مهلة: جهازٌ بلا شبكة أو رفضٌ صامت من النظام يجب ألّا يترك الزرّ معطّلاً للأبد
      setTimeout(() => finish({ ok: false, timeout: true }), ms);
    });
  }

  // نوصّل المستمعين مرّة واحدة. الرمز يصل غير متزامن بعد register()، وقد يصل
  // كذلك من تلقائه عند تدويره في النظام — فالمستمع دائمٌ لا مؤقّت.
  function wireNativeListeners() {
    if (nativeWired) return;
    const Push = pushPlugin();
    if (!Push) return;
    nativeWired = true;

    Push.addListener('registration', async (t) => {
      const token = t && t.value;
      if (!token) return;
      pendingToken = token;
      try {
        await saveNativeToken(token);
        window.dispatchEvent(new CustomEvent('push:subscribed'));
        settleRegistration({ ok: true });
      } catch (err) {
        // جلسة غير جاهزة بعد؟ ensureSync سيعيد المحاولة عند الإقلاع التالي
        console.warn('[push] فشل حفظ رمز الجهاز:', err);
        settleRegistration({ ok: false, error: err });
      }
    });

    Push.addListener('registrationError', (err) => {
      console.warn('[push] فشل التسجيل مع النظام:', err);
      settleRegistration({ ok: false, error: err });
    });

    // إشعار وصل والتطبيق مفتوح: النظام لا يعرضه فوق تطبيقٍ في المقدّمة، فنعرضه
    // بأنفسنا داخل التطبيق — وإلا فقد المالك حجزاً وصل إشعاره وهو ينظر للشاشة.
    Push.addListener('pushNotificationReceived', (notif) => {
      const title = (notif && notif.title) || 'إشعار جديد';
      const body = (notif && notif.body) || '';
      if (window.utils && window.utils.toast) {
        window.utils.toast(body ? `${title} — ${body}` : title, 'info');
      }
      // حدّث ما على الشاشة: الإشعار يعني بياناتٍ تغيّرت على الخادم
      if (window.store) window.store.invalidate();
      if (window.router && window.router.refresh) window.router.refresh();
    });

    // نقر المستخدم على الإشعار: انتقل إلى الوجهة التي أرسلناها في الحمولة
    Push.addListener('pushNotificationActionPerformed', (action) => {
      const data = (action && action.notification && action.notification.data) || {};
      const url = data.url || '/bookings';
      if (window.router && window.router.navigateToPath) {
        window.router.navigateToPath(url);
      } else {
        window.location.href = (window.__BASE__ || '') + url;
      }
    });
  }

  async function nativePermissionState() {
    const Push = pushPlugin();
    if (!Push) return 'denied';
    try {
      const res = await Push.checkPermissions();
      return (res && res.receive) || 'prompt';   // 'prompt' | 'granted' | 'denied'
    } catch (_) {
      return 'denied';
    }
  }

  function isSupported() {
    if (isNativeApp) return !!pushPlugin();
    return (
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  function permission() {
    if (isNativeApp) {
      // النظام غير متزامن هنا، والواجهة تتوقّع قيمةً فورية. نُبقي آخر حالةٍ
      // معروفة في الذاكرة ونحدّثها في كل نداء غير متزامن (subscribe/ensureSync).
      return nativePermCache;
    }
    if (!('Notification' in window)) return 'denied';
    return Notification.permission; // 'default' | 'granted' | 'denied'
  }

  // 'default' لتطابق قيم الويب التي تتوقّعها صفحة الإعدادات
  let nativePermCache = 'default';
  if (isNativeApp) {
    nativePermissionState().then((p) => {
      nativePermCache = p === 'prompt' ? 'default' : p;
    });
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
    if (isNativeApp) {
      // «مشترك» في التطبيق = الإذن ممنوح وللجهاز رمزٌ مسجَّل في قاعدتنا.
      // الإذن وحده لا يكفي: قد يُمنح ثم يفشل حفظ الرمز فلا يصل شيء.
      const perm = await nativePermissionState();
      nativePermCache = perm === 'prompt' ? 'default' : perm;
      if (perm !== 'granted') return false;
      if (userDisabled()) return false;
      try {
        const { data: { user } } = await window.sb.auth.getUser();
        if (!user) return false;
        const { count } = await window.sb
          .from('push_subscriptions')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('platform', nativePlatform);
        return !!count;
      } catch (_) {
        return false;
      }
    }
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

    if (isNativeApp) {
      const Push = pushPlugin();
      if (!Push) return { ok: false, reason: 'unsupported' };
      wireNativeListeners();
      try {
        const req = await Push.requestPermissions();
        const state = (req && req.receive) || 'denied';
        nativePermCache = state === 'prompt' ? 'default' : state;
        if (state !== 'granted') {
          window.dispatchEvent(new CustomEvent('push:denied'));
          return { ok: false, reason: 'denied' };
        }
        // ابدأ الانتظار **قبل** register حتى لا يفوتنا ردٌّ سريع
        const registered = awaitRegistration(15000);
        await Push.register();
        const result = await registered;

        if (!result.ok) {
          // انتهت المهلة أو فشل الحفظ. قد يكون الصفّ وصل رغم ذلك (سباق شبكة)،
          // فنسأل قاعدة البيانات مرّة واحدة قبل أن نُعلن الفشل.
          if (await isSubscribed()) {
            setUserDisabled(false);
            return { ok: true };
          }
          return {
            ok: false,
            error: result.timeout ? 'تعذّر تسجيل الجهاز — تحقّق من الاتصال' : String(result.error || 'فشل التسجيل')
          };
        }

        setUserDisabled(false);
        return { ok: true };
      } catch (err) {
        console.warn('[push] فشل التسجيل الأصلي:', err);
        return { ok: false, error: String((err && err.message) || err) };
      }
    }

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

    if (isNativeApp) {
      // لا نُلغي إذن النظام (لا نملك ذلك)، لكننا نحذف صفّ الجهاز من قاعدتنا —
      // وهو ما يوقف الإرسال فعلاً. وننظّف المستمعين كي لا يُعاد حفظ الرمز.
      try {
        const Push = pushPlugin();
        const token = pendingToken;
        if (Push) { try { await Push.removeAllListeners(); } catch (_) {} }
        nativeWired = false;
        if (window.sb) {
          if (token) {
            await window.sb.from('push_subscriptions').delete().eq('endpoint', token);
          } else {
            // لا رمز في الذاكرة (إقلاع جديد) → احذف صفوف هذا الجهاز لهذا المستخدم
            const { data: { user } } = await window.sb.auth.getUser();
            if (user) {
              await window.sb.from('push_subscriptions')
                .delete().eq('user_id', user.id).eq('platform', nativePlatform);
            }
          }
        }
        pendingToken = null;
        window.dispatchEvent(new CustomEvent('push:unsubscribed'));
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String((err && err.message) || err) };
      }
    }

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
    if (userDisabled()) return;

    if (isNativeApp) {
      const Push = pushPlugin();
      if (!Push) return;
      try {
        const perm = await nativePermissionState();
        nativePermCache = perm === 'prompt' ? 'default' : perm;
        if (perm !== 'granted') return;   // لم يُمنح الإذن → لا نُلحّ على المستخدم
        // الإذن ممنوح مسبقاً: register() لا يُظهر نافذةً، ويُعيد إطلاق مستمع
        // 'registration' فيُسجَّل الرمز للحساب الحالي (نقل ملكية عند التبديل،
        // واستعادة بعد تنظيف الخروج).
        wireNativeListeners();
        await Push.register();
      } catch (_) { /* صامت — الإشعارات كمالية ولا تعطّل الإقلاع */ }
      return;
    }

    if (permission() !== 'granted') return;
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
