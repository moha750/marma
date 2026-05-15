// إعدادات الملعب — صفحة (كانت Modal قبل الترحيل)
(function () {
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }

  function buildPublicLink(tenantId) {
    return `${window.location.origin}${window.utils.path('/book')}?t=${encodeURIComponent(tenantId)}`;
  }

  function buildQrUrl(text, size) {
    const params = new URLSearchParams({
      size: `${size}x${size}`,
      data: text,
      margin: '10',
      qzone: '2'
    });
    return `https://api.qrserver.com/v1/create-qr-code/?${params.toString()}`;
  }

  async function downloadQr(qrUrl, filename) {
    try {
      const res = await fetch(qrUrl);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (_) {
      window.open(qrUrl, '_blank', 'noopener');
    }
  }

  function printQr(tenantName, qrUrl) {
    const w = window.open('', '_blank', 'width=600,height=700');
    if (!w) {
      window.utils.toast('فعّل النوافذ المنبثقة للطباعة', 'warning');
      return;
    }
    const safeName = window.utils.escapeHtml(tenantName || 'الحجز');
    w.document.write(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><title>QR — ${safeName}</title>
<style>
  *,*::before,*::after { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; margin: 0; padding: 32px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; text-align: center; color: #111; }
  h1 { margin: 0 0 8px; font-size: 22px; font-weight: 600; }
  p { color: #666; margin: 0 0 24px; font-size: 14px; }
  .qr-frame { padding: 16px; background: #fff; border: 1px solid #ddd; border-radius: 12px; }
  img { display: block; width: 320px; height: 320px; }
  @media print { body { min-height: auto; padding: 16px; } .qr-frame { border: none; } }
</style></head>
<body>
  <h1>${safeName}</h1>
  <p>امسح الرمز لفتح صفحة الحجز</p>
  <div class="qr-frame"><img src="${qrUrl}" alt="QR"></div>
</body></html>`);
    w.document.close();
    w.focus();
    const img = w.document.querySelector('img');
    if (img.complete) w.print();
    else img.addEventListener('load', () => w.print());
  }

  function TEMPLATE(tenant, isOwner, publicLink) {
    return `
      <div class="page-header">
        <div>
          <h2>إعدادات الملعب</h2>
          <div class="page-subtitle">بيانات الملعب الأساسية ورابط الحجز العام</div>
        </div>
      </div>

      <div class="card mb-md">
        <div class="card-header">
          <h3>بيانات الملعب</h3>
          ${isOwner ? '' : '<span class="card-header-meta">قراءة فقط — التعديل للمالك</span>'}
        </div>
        <form id="settings-form" autocomplete="off">
          <div class="card-body">
            <div class="form-group">
              <label class="form-label">اسم الملعب <span class="required">*</span></label>
              <input type="text" class="form-control" name="name" value="${window.utils.escapeHtml(tenant.name || '')}" required ${isOwner ? '' : 'disabled'}>
            </div>
            <div class="form-row cols-2">
              <div class="form-group">
                <label class="form-label">المدينة</label>
                <input type="text" class="form-control" name="city" value="${window.utils.escapeHtml(tenant.city || '')}" ${isOwner ? '' : 'disabled'}>
              </div>
              <div class="form-group" style="margin-bottom:0">
                <label class="form-label">رقم الجوال</label>
                <input type="tel" class="form-control" name="phone" value="${window.utils.escapeHtml(tenant.phone || '')}" ${isOwner ? '' : 'disabled'}>
              </div>
            </div>
          </div>
          ${isOwner ? `
            <div class="card-footer">
              <button type="submit" class="btn btn--primary" id="settings-save">حفظ التغييرات</button>
            </div>
          ` : ''}
        </form>
      </div>

      <div class="card">
        <div class="card-header">
          <h3>رابط الحجز العام</h3>
        </div>
        <div class="card-body">
          <div class="invite-link-box">
            <code>${window.utils.escapeHtml(publicLink)}</code>
            <button type="button" class="btn btn--primary btn--sm" id="copy-public-link">نسخ</button>
          </div>
          <span class="form-help">شارك هذا الرابط مع عملائك ليطلبوا الحجز بأنفسهم. الطلبات تظهر في لوحة التحكم بانتظار موافقتك.</span>

          <div class="divider"></div>

          <div class="qr-share">
            <div class="qr-share-image">
              <img src="${buildQrUrl(publicLink, 240)}" alt="رمز QR لرابط الحجز" width="200" height="200" loading="lazy">
            </div>
            <div class="qr-share-content">
              <div class="fw-semibold mb-sm">رمز QR للحجز</div>
              <p class="text-muted text-sm mb-md">اطبعه وعلّقه في الملعب، أو شاركه كصورة. عملاؤك يفتحون نفس صفحة الحجز عبر مسح الرمز.</p>
              <div class="qr-share-actions">
                <button type="button" class="btn btn--secondary btn--sm" id="qr-download">
                  <i data-lucide="download"></i><span>تحميل صورة</span>
                </button>
                <button type="button" class="btn btn--secondary btn--sm" id="qr-print">
                  <i data-lucide="printer"></i><span>طباعة</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  const page = {
    async mount(container, ctx) {
      const tenant = ctx.tenant;
      const isOwner = ctx.profile.role === 'owner';
      if (!tenant) {
        container.innerHTML = `<div class="card"><div class="card-body"><div class="empty-state"><p>لا توجد بيانات الملعب.</p></div></div></div>`;
        return;
      }

      const publicLink = buildPublicLink(tenant.id);
      container.innerHTML = TEMPLATE(tenant, isOwner, publicLink);

      const copyBtn = container.querySelector('#copy-public-link');
      copyBtn.addEventListener('click', () => {
        copyToClipboard(publicLink);
        window.utils.toast('تم نسخ الرابط', 'success');
      });

      const downloadBtn = container.querySelector('#qr-download');
      const printBtn = container.querySelector('#qr-print');
      const qrFilename = `qr-${(tenant.name || 'booking').replace(/\s+/g, '-')}.png`;
      downloadBtn.addEventListener('click', () => {
        downloadQr(buildQrUrl(publicLink, 600), qrFilename);
      });
      printBtn.addEventListener('click', () => {
        printQr(tenant.name, buildQrUrl(publicLink, 600));
      });

      if (isOwner) {
        const form = container.querySelector('#settings-form');
        const submit = container.querySelector('#settings-save');
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          submit.dataset.loading = 'true';
          submit.disabled = true;
          const fd = new FormData(form);
          try {
            await window.api.updateTenant({
              name: fd.get('name'),
              city: fd.get('city') || null,
              phone: fd.get('phone') || null
            });
            window.utils.toast('تم حفظ إعدادات الملعب', 'success');
            const el = document.querySelector('.sidebar-brand .tenant-name');
            if (el) el.textContent = fd.get('name');
            ctx.tenant.name = fd.get('name');
            ctx.tenant.city = fd.get('city') || null;
            ctx.tenant.phone = fd.get('phone') || null;
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
          } finally {
            delete submit.dataset.loading;
            submit.disabled = false;
          }
        });
      }
    },

    unmount() {}
  };

  window.pages = window.pages || {};
  window.pages.settings = page;
})();
