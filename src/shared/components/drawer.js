// Drawer — لوح جانبي ينزلق من حافة الشاشة. يحفظ سياق الصفحة خلفه.
// نظير لـ window.utils.openModal لكن للمحتوى الأطول/متعدد الأقسام.
//
// API:
//   const ctrl = window.drawer.open({
//     title:    'تعديل حجز',
//     subtitle: '#1234',                              // اختياري — meta تحت العنوان
//     size:     'md',                                 // sm | md | lg | xl  (افتراضي md)
//     body:     '<div>…</div>'   أو   bodyEl: el,
//     footer:   '<button …>…</button>'  أو  footerEl: el,
//     onClose:  () => { … }
//   });
//   ctrl.close();      → يغلق ويستدعي onClose
//   ctrl.drawer        → عنصر <aside>
//   ctrl.body          → عنصر body
//   ctrl.footer        → عنصر footer
//
// المفاتيح: Escape يغلق. النقر على الـ backdrop يغلق. غير قابل للسحب على هذه النسخة.

window.drawer = (function () {
  function open(opts) {
    const {
      title = '',
      subtitle = '',
      size = 'md',
      body = '',
      bodyEl = null,
      footer = '',
      footerEl = null,
      onClose = null
    } = opts || {};

    const backdrop = document.createElement('div');
    backdrop.className = 'drawer-backdrop';

    const aside = document.createElement('aside');
    aside.className = `drawer drawer--${size}`;
    aside.setAttribute('role', 'dialog');
    aside.setAttribute('aria-modal', 'true');
    if (title) aside.setAttribute('aria-label', title);

    // Header
    const header = document.createElement('header');
    header.className = 'drawer-header';
    header.innerHTML = `
      <div>
        <h3>${escape(title)}</h3>
        ${subtitle ? `<div class="drawer-header-meta">${escape(subtitle)}</div>` : ''}
      </div>
      <button type="button" class="drawer-close" aria-label="إغلاق"><i data-lucide="x"></i></button>
    `;
    aside.appendChild(header);

    // Body
    const bodyContainer = document.createElement('div');
    bodyContainer.className = 'drawer-body';
    if (bodyEl) bodyContainer.appendChild(bodyEl);
    else if (typeof body === 'string') bodyContainer.innerHTML = body;
    aside.appendChild(bodyContainer);

    // Footer (اختياري)
    let footerContainer = null;
    if (footerEl || footer) {
      footerContainer = document.createElement('footer');
      footerContainer.className = 'drawer-footer';
      if (footerEl) footerContainer.appendChild(footerEl);
      else if (typeof footer === 'string') footerContainer.innerHTML = footer;
      aside.appendChild(footerContainer);
    }

    backdrop.appendChild(aside);
    document.body.appendChild(backdrop);

    // أيقونات Lucide
    if (window.utils && window.utils.renderIcons) {
      window.utils.renderIcons(aside);
    }

    // افتح بعد إضافته للـ DOM (لضمان transition)
    requestAnimationFrame(() => { backdrop.dataset.open = 'true'; });

    // حالة فتح صلبة — نمنع scroll الخلفية
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      backdrop.dataset.open = 'false';
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);

      // انتظر انتهاء transition قبل إزالة العنصر من الـ DOM
      setTimeout(() => {
        backdrop.remove();
        if (typeof onClose === 'function') {
          try { onClose(); } catch (_) {}
        }
      }, 240);
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    }
    document.addEventListener('keydown', onKey);

    // إغلاق بزر X
    header.querySelector('.drawer-close').addEventListener('click', close);

    // إغلاق بالنقر على الـ backdrop (خارج الـ aside)
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });

    return {
      drawer: aside,
      body: bodyContainer,
      footer: footerContainer,
      close
    };
  }

  function escape(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return { open };
})();
