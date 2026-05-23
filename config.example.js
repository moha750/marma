// قالب الإعدادات - انسخه إلى config.js واملأ القيم
// المفتاح العام (publishable / anon) آمن للمتصفح
// الأمان الفعلي يأتي من Row Level Security في Supabase
window.APP_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_KEY: 'sb_publishable_YOUR_PUBLIC_KEY_HERE',
  VAPID_PUBLIC_KEY: 'YOUR_VAPID_PUBLIC_KEY',
  // اختياري: مفتاح Google Maps Embed API لتطابق pin مع POI الفعلي.
  // بدون هذا المفتاح، نستخدم free embed (دقة جيدة لكن غير مثالية).
  // قيّد المفتاح في Google Cloud Console بـ HTTP referrer (marma.help/*).
  GOOGLE_MAPS_API_KEY: ''
};
