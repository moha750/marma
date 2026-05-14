// طبقة Realtime: تشترك مرة واحدة في قنوات Supabase الحية
// عند حدوث تغيير:
//   1) تبطّل أي store cell مرتبط بالجدول المتغيّر
//   2) تُطلق حدثاً يستهلكه الـ page module الحالي (debounced)
//
// الاستخدام في صفحة:
//   const off = window.realtime.on('bookings:change', refresh);
//   cleanup.push(off);
//
// ملاحظة: يتطلب تفعيل replication لكل جدول في Supabase:
//   ALTER PUBLICATION supabase_realtime ADD TABLE bookings, customers, fields;
// RLS تضمن أن المستخدم يستلم تغييرات بياناته فقط.

window.realtime = (function () {
  const listeners = new Map(); // event -> Set<callback>
  let channels = [];
  let started = false;

  function on(event, cb) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(cb);
    return function off() {
      const set = listeners.get(event);
      if (set) set.delete(cb);
    };
  }

  function emit(event, payload) {
    const set = listeners.get(event);
    if (!set || !set.size) return;
    set.forEach((cb) => {
      try { cb(payload); } catch (e) { console.warn('realtime listener error:', e); }
    });
  }

  // وصف خفيف لقنوات الـ realtime: اسم القناة + الجدول + الـ store cells المرتبطة + الحدث المُطلق
  const SUBSCRIPTIONS = [
    {
      channel: 'rt-bookings',
      table: 'bookings',
      invalidates: [],                // الحجوزات ليست cached حالياً
      event: 'bookings:change'
    },
    {
      channel: 'rt-customers',
      table: 'customers',
      invalidates: ['customers:all'],
      event: 'customers:change'
    },
    {
      channel: 'rt-fields',
      table: 'fields',
      invalidates: ['fields:active', 'fields:all'],
      event: 'fields:change'
    }
  ];

  function start() {
    if (started) return;
    if (!window.sb || typeof window.sb.channel !== 'function') {
      console.warn('Supabase client غير متاح — تم تعطيل realtime');
      return;
    }
    started = true;

    channels = SUBSCRIPTIONS.map((sub) => {
      return window.sb
        .channel(sub.channel)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: sub.table },
          (payload) => {
            if (window.store) {
              sub.invalidates.forEach((cell) => window.store.invalidate(cell));
            }
            emit(sub.event, payload);
          }
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn(`realtime channel ${sub.channel} status:`, status);
          }
        });
    });
  }

  async function stop() {
    if (!started) return;
    started = false;
    for (const ch of channels) {
      try { await window.sb.removeChannel(ch); } catch (_) {}
    }
    channels = [];
    listeners.clear();
  }

  function isStarted() { return started; }

  return { on, start, stop, isStarted };
})();
