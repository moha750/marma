// تهيئة عميل Supabase
// يفترض أن مكتبة @supabase/supabase-js محمَّلة قبل هذا الملف عبر CDN
(function () {
  if (!window.supabase) {
    console.error('مكتبة Supabase غير محملة. تأكد من إضافة وسم <script> الخاص بها قبل هذا الملف.');
    return;
  }
  if (!window.APP_CONFIG) {
    console.error('config.js لم يُحمَّل. تأكد من ترتيب الوسوم.');
    return;
  }
  window.sb = window.supabase.createClient(
    window.APP_CONFIG.SUPABASE_URL,
    window.APP_CONFIG.SUPABASE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    }
  );
})();
