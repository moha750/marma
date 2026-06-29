// تحويل الجداول (.table--cards) إلى كروت تلقائياً عند تجاوز عرضها للحاوية —
// "responsive حسب المحتوى" بدل نقطة فصل ثابتة. يضيف .as-cards على .table-wrapper
// متى لم يتّسع الجدول، ويزيله متى اتّسع — بأي عرض (جوال أو سطح مكتب بمساحة ضيّقة).
(function () {
  if (!('ResizeObserver' in window)) return;

  // قِس في وضع الجدول (أزل الصنف مؤقتاً) ثم قرّر — القياس متزامن قبل الرسم فلا وميض
  function measure(wrapper) {
    const table = wrapper.querySelector('table.table--cards');
    if (!table) { wrapper.classList.remove('as-cards'); return; }
    // «كروت فقط»: لا نقيس أبداً — يبقى كروتاً بأي عرض
    if (wrapper.classList.contains('cards-only')) { wrapper.classList.add('as-cards'); return; }
    wrapper.classList.remove('as-cards');
    const overflow = table.scrollWidth - wrapper.clientWidth > 1;
    wrapper.classList.toggle('as-cards', overflow);
  }

  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const w = Math.round(e.contentRect.width);
      if (e.target.__tcW === w) continue;   // تجاهل تغيّر الارتفاع وحده (يمنع الحلقة)
      e.target.__tcW = w;
      measure(e.target);
    }
  });

  const seen = new WeakSet();
  function scan() {
    document.querySelectorAll('.table-wrapper').forEach((w) => {
      if (!w.querySelector('table.table--cards')) return;
      if (!seen.has(w)) { seen.add(w); ro.observe(w); }
      measure(w);
    });
  }

  let raf = 0;
  function scheduleScan() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; scan(); });
  }

  function start() {
    scan();
    // إعادة الفحص عند إعادة بناء الجداول (تنقّل SPA). نراقب childList فقط
    // (لا attributes) فتبديل الصنف لا يطلق حلقة.
    new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', scheduleScan);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.tableCards = { scan: scheduleScan };
})();
