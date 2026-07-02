// قالب الإعدادات - انسخه إلى config.js واملأ القيم
// المفتاح العام (publishable / anon) آمن للمتصفح
// الأمان الفعلي يأتي من Row Level Security في Supabase
window.APP_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_KEY: 'sb_publishable_YOUR_PUBLIC_KEY_HERE',
  // مفتاح خرائط قوقل (مقيَّد بالنطاق) — لخريطة تحديد موقع الأرضية
  GOOGLE_MAPS_API_KEY: 'YOUR_GOOGLE_MAPS_API_KEY_HERE'
};
