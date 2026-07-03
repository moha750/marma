// عارض إيصالات الدفع — نافذة منبثقة مشتركة (المالك + المشرف).
// يعرض الصور بـ <img> وملفات PDF بـ <iframe>، مع رابط "فتح في تبويب" كخطة بديلة (الجوال).
// يجلب رابط العرض الموقّت داخل النافذة (لا window.open) فيتفادى حاجب النوافذ المنبثقة.
// مكتفٍ ذاتياً (يعتمد window.sb فقط) ليعمل في app.html و admin.html دون ربط API إضافي.
window.receiptViewer = (function () {
  const BUCKET = 'payment-receipts';
  const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

  function extOf(path) {
    const m = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(String(path || ''));
    return m ? m[1].toLowerCase() : '';
  }

  // رابط موقّت (5 دقائق) — يتطلّب صلاحية RLS (المالك صاحبه أو المشرف العام).
  async function signedUrl(path) {
    const { data, error } = await window.sb.storage.from(BUCKET).createSignedUrl(path, 300);
    if (error) throw error;
    return (data && data.signedUrl) || null;
  }

  async function open(path) {
    if (!path) { window.utils.toast('لا يوجد إيصال', 'error'); return; }
    const isImage = IMAGE_EXTS.indexOf(extOf(path)) !== -1;

    const ctrl = window.utils.openModal({
      title: 'إيصال التحويل',
      size: 'xl',
      body: '<div class="receipt-view is-loading"><div class="loader loader--lg"></div></div>',
      footer: '<button type="button" class="btn btn--ghost" data-action="close">إغلاق</button>'
    });
    ctrl.modal.querySelector('[data-action="close"]').addEventListener('click', ctrl.close);
    const view = ctrl.bodyEl.querySelector('.receipt-view');

    try {
      const url = await signedUrl(path);
      if (!url) throw new Error('تعذّر إنشاء رابط العرض');

      view.classList.remove('is-loading');
      view.innerHTML = '';

      let media;
      if (isImage) {
        media = document.createElement('img');
        media.className = 'receipt-view__img';
        media.alt = 'إيصال التحويل';
      } else {
        media = document.createElement('iframe');
        media.className = 'receipt-view__frame';
        media.title = 'إيصال التحويل';
      }
      media.src = url; // ضبط src كخاصية (لا innerHTML) — بلا مخاطر حقن
      view.appendChild(media);

      // خطة بديلة للجوال (قد لا يعرض PDF داخل iframe)
      const openLink = document.createElement('a');
      openLink.className = 'btn btn--secondary btn--sm receipt-view__open';
      openLink.href = url;
      openLink.target = '_blank';
      openLink.rel = 'noopener';
      openLink.innerHTML = '<i data-lucide="external-link"></i> فتح في صفحة جديدة';
      view.appendChild(openLink);

      window.utils.renderIcons(ctrl.modal);
    } catch (err) {
      view.classList.remove('is-loading');
      view.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'text-danger';
      p.textContent = window.utils.formatError(err);
      view.appendChild(p);
    }
  }

  return { open };
})();
