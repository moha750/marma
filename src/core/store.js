// طبقة تخزين مؤقت (cache layer) للـ SPA
//
// كل "خلية" (cell) لها:
//   - fetcher: دالة async تعيد البيانات من السيرفر
//   - ttl: مدة صلاحية البيانات بالـ ms
//   - data: آخر بيانات مخزّنة
//   - inflight: Promise جاري حالياً (لمنع تكرار الطلب)
//
// الاستخدام:
//   store.define('fields:all', () => window.api.listFields(true), { ttl: 10*60*1000 });
//   const fields = await store.get('fields:all');   // يجلب أو يعيد من الـ cache
//   store.invalidate('fields:all');                  // يبطل الـ cache
//   store.peek('fields:all');                        // يعيد البيانات إذا فريش، وإلا null
//   store.subscribe('fields:all', cb);               // listener عند كل refresh
//   store.set('fields:all', data);                   // كتابة مباشرة (optimistic)
//   store.prefetch(['fields:all', 'customers:all']); // إقلاع دافئ

window.store = (function () {
  const cells = new Map();
  const DEFAULT_TTL = 5 * 60 * 1000; // 5 دقائق

  function define(name, fetcher, options) {
    const opts = options || {};
    const existing = cells.get(name);
    if (existing) {
      // إعادة تعريف بدون فقدان البيانات الحالية
      existing.fetcher = fetcher;
      if (opts.ttl != null) existing.ttl = opts.ttl;
      return;
    }
    cells.set(name, {
      fetcher,
      ttl: opts.ttl != null ? opts.ttl : DEFAULT_TTL,
      data: null,
      fetchedAt: 0,
      inflight: null,
      listeners: new Set()
    });
  }

  function isFresh(cell) {
    return cell.data !== null && (Date.now() - cell.fetchedAt) < cell.ttl;
  }

  function notify(cell, data) {
    cell.listeners.forEach((cb) => {
      try { cb(data); } catch (e) { console.warn('store listener error:', e); }
    });
  }

  async function get(name, options) {
    const opts = options || {};
    const cell = cells.get(name);
    if (!cell) throw new Error('Unknown store cell: ' + name);

    if (!opts.force && isFresh(cell)) return cell.data;
    if (cell.inflight) return cell.inflight;

    cell.inflight = (async () => {
      try {
        const data = await cell.fetcher();
        cell.data = data;
        cell.fetchedAt = Date.now();
        notify(cell, data);
        return data;
      } finally {
        cell.inflight = null;
      }
    })();

    return cell.inflight;
  }

  // يعيد البيانات فوراً إذا فريش، وإلا null (بدون جلب)
  function peek(name) {
    const cell = cells.get(name);
    if (!cell) return null;
    return isFresh(cell) ? cell.data : null;
  }

  function invalidate(name) {
    if (name === undefined) {
      cells.forEach((c) => { c.data = null; c.fetchedAt = 0; });
      return;
    }
    const cell = cells.get(name);
    if (cell) { cell.data = null; cell.fetchedAt = 0; }
  }

  function set(name, data) {
    const cell = cells.get(name);
    if (!cell) return;
    cell.data = data;
    cell.fetchedAt = Date.now();
    notify(cell, data);
  }

  function subscribe(name, callback) {
    const cell = cells.get(name);
    if (!cell) return () => {};
    cell.listeners.add(callback);
    return () => cell.listeners.delete(callback);
  }

  function prefetch(names) {
    return Promise.all(names.map((n) => get(n).catch((err) => {
      console.warn('prefetch failed for', n, err);
      return null;
    })));
  }

  function clearAll() {
    cells.forEach((c) => {
      c.data = null;
      c.fetchedAt = 0;
      c.inflight = null;
    });
  }

  return { define, get, peek, set, invalidate, subscribe, prefetch, clearAll };
})();
