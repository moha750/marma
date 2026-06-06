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

  // ── توليد QR محلياً (بلا API خارجي) مع شعار مرمى في المنتصف ──
  let qrLibPromise = null;
  function loadQrLib() {
    if (window.QRCode && window.QRCode.toCanvas) return Promise.resolve();
    if (!qrLibPromise) {
      qrLibPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = window.utils.path('/assets/vendor/qrcode.min.js');
        s.onload = resolve;
        s.onerror = () => reject(new Error('تعذّر تحميل مكتبة QR'));
        document.head.appendChild(s);
      });
    }
    return qrLibPromise;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // الشعار SVG فيه viewBox فقط — نحقن width/height ليُرسم على canvas في كل المتصفحات
  // (preserveAspectRatio الافتراضي يحافظ على النسبة داخل المربع)
  async function loadLogoImage(px) {
    const res = await fetch(window.utils.path('/assets/logo-mark.svg'));
    let svg = await res.text();
    if (!/<svg[^>]*\bwidth=/.test(svg)) {
      svg = svg.replace(/<svg\s/, `<svg width="${px}" height="${px}" `);
    }
    return loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  }

  // يرسم مربّعاً مستدير الزوايا (للعيون)
  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // QR موثوق المسح بلمسة أنيقة: وحدات بيانات مربّعات صلبة (مضمونة المسح) بلون
  // العلامة الداكن، عيون مدوّرة الزوايا، وشارة دائرية للشعار. تصحيح خطأ H.
  // الفهرسة data[r*count+c] مطابقة لـ modules.get(r,c). فشل الشعار → رمز نظيف.
  async function buildQrDataUrl(text, size) {
    await loadQrLib();
    const DARK = '#0B3D2E';                 // أخضر العلامة الداكن — تباين عالٍ
    const render = async (withLogo) => {
      const qr = window.QRCode.create(text, { errorCorrectionLevel: 'H' });
      const count = qr.modules.size;
      const data = qr.modules.data;
      const margin = 4;                     // منطقة هادئة (بالوحدات)
      const cell = size / (count + margin * 2);
      const off = margin * cell;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);

      const cx = size / 2, cy = size / 2;
      const clearR = withLogo ? size * 0.18 : 0;   // دائرة فارغة وسط الرمز للشعار
      const inFinder = (r, c) =>
        (r < 7 && c < 7) || (r < 7 && c >= count - 7) || (r >= count - 7 && c < 7);

      // وحدات البيانات: مربّعات صلبة كاملة (نتجاوز العيون ودائرة الشعار)
      ctx.fillStyle = DARK;
      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (!data[r * count + c] || inFinder(r, c)) continue;
          const x = off + c * cell, y = off + r * cell;
          if (clearR && Math.hypot(x + cell / 2 - cx, y + cell / 2 - cy) < clearR + cell * 0.6) continue;
          ctx.fillRect(x, y, cell + 0.6, cell + 0.6);   // تداخل بسيط يسدّ فجوات التقريب
        }
      }

      // العيون الثلاثة: بنية finder القياسية بزوايا مدوّرة (تُمسح بثبات)
      const eye = (or, oc) => {
        const x = off + oc * cell, y = off + or * cell, s = 7 * cell;
        ctx.fillStyle = DARK; roundRectPath(ctx, x, y, s, s, cell * 1.3); ctx.fill();
        ctx.fillStyle = '#fff'; roundRectPath(ctx, x + cell, y + cell, 5 * cell, 5 * cell, cell * 0.95); ctx.fill();
        ctx.fillStyle = DARK; roundRectPath(ctx, x + 2 * cell, y + 2 * cell, 3 * cell, 3 * cell, cell * 0.6); ctx.fill();
      };
      eye(0, 0); eye(0, count - 7); eye(count - 7, 0);

      // شارة الشعار: دائرة بيضاء + الشعار في منتصفها
      if (withLogo) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(cx, cy, clearR, 0, 2 * Math.PI); ctx.fill();
        const lw = clearR * 1.5;
        const img = await loadLogoImage(Math.round(clearR * 2));
        ctx.drawImage(img, cx - lw / 2, cy - lw / 2, lw, lw);
      }
      return canvas.toDataURL('image/png');
    };
    try { return await render(true); }
    catch (_) { return render(false); }
  }

  function downloadDataUrl(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
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
          <h3>بيانات النشاط</h3>
          ${isOwner ? '' : '<span class="card-header-meta">قراءة فقط — التعديل للمالك</span>'}
        </div>
        <form id="settings-form" autocomplete="off">
          <div class="card-body">
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">اسم النشاط <span class="required">*</span></label>
              <input type="text" class="form-control" name="name" value="${window.utils.escapeHtml(tenant.name || '')}" required ${isOwner ? '' : 'disabled'}>
              <span class="form-help">المدينة ورقم الجوال خاصة بكل أرضية. عدّلهما من <a href="${window.utils.path('/fields')}">صفحة الأرضيات</a>.</span>
            </div>
          </div>
          ${isOwner ? `
            <div class="card-footer">
              <button type="submit" class="btn btn--primary" id="settings-save">حفظ التغييرات</button>
            </div>
          ` : ''}
        </form>
      </div>

      <div class="card mb-md" id="branding-card">
        <div class="card-header">
          <h3>هوية الملعب</h3>
          <span class="card-header-meta">تظهر للعملاء في صفحة الحجز</span>
        </div>
        <form id="branding-form" autocomplete="off">
          <div class="card-body">
            <div class="form-group">
              <label class="form-label">صورة الغلاف</label>
              <div class="tenant-cover-slot" id="cover-slot" data-state="${tenant.cover_image_url ? 'filled' : 'empty'}">
                ${tenant.cover_image_url ? `
                  <img src="${window.utils.escapeHtml(tenant.cover_image_url)}" alt="غلاف الملعب">
                  ${isOwner ? `
                    <div class="tenant-cover-slot__actions">
                      <label class="btn btn--secondary btn--sm">
                        <input type="file" accept="image/jpeg,image/png,image/webp" hidden data-role="cover-replace">
                        <i data-lucide="image"></i><span>تغيير</span>
                      </label>
                      <button type="button" class="btn btn--danger-quiet btn--sm" data-role="cover-remove">
                        <i data-lucide="trash-2"></i><span>حذف</span>
                      </button>
                    </div>
                  ` : ''}
                ` : `
                  ${isOwner ? `
                    <label class="tenant-cover-slot__add">
                      <input type="file" accept="image/jpeg,image/png,image/webp" hidden data-role="cover-replace">
                      <i data-lucide="image-plus"></i>
                      <span>إضافة صورة غلاف</span>
                    </label>
                  ` : `
                    <div class="tenant-cover-slot__empty"><i data-lucide="image"></i><span>لا توجد صورة غلاف</span></div>
                  `}
                `}
              </div>
              <span class="form-help">صورة عرضية تظهر أعلى صفحة الحجز. JPG/PNG/WebP، حد 5 ميجابايت.</span>
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">وصف الملعب</label>
              <textarea class="form-control" name="description" rows="3" maxlength="600"
                        placeholder="اكتب نبذة قصيرة عن الملعب — موقعه، ما يميّزه، نوع الخدمة"
                        ${isOwner ? '' : 'disabled'}>${window.utils.escapeHtml(tenant.description || '')}</textarea>
              <span class="form-help">600/<span id="desc-counter">${(tenant.description || '').length}</span> حرف</span>
            </div>
          </div>
          ${isOwner ? `
            <div class="card-footer">
              <button type="submit" class="btn btn--primary" id="branding-save">حفظ الوصف</button>
            </div>
          ` : ''}
        </form>
      </div>

      <div class="card mb-md" id="notifications-card">
        <div class="card-header">
          <h3>الإشعارات</h3>
        </div>
        <div class="card-body" id="notifications-body">
          <div class="loader-center" style="min-height:60px"><div class="loader"></div></div>
        </div>
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
              <img alt="رمز QR لرابط الحجز" width="200" height="200">
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
      const qrImg = container.querySelector('.qr-share-image img');
      const qrFilename = `qr-${(tenant.name || 'booking').replace(/\s+/g, '-')}.png`;

      // توليد مرّة واحدة بدقّة عالية، يُعاد استخدامه للعرض والتحميل والطباعة
      const qrReady = buildQrDataUrl(publicLink, 1024);
      qrReady
        .then((url) => { if (qrImg) qrImg.src = url; })
        .catch(() => { window.utils.toast('تعذّر توليد رمز QR', 'error'); });

      downloadBtn.addEventListener('click', async () => {
        try { downloadDataUrl(await qrReady, qrFilename); }
        catch (_) { window.utils.toast('تعذّر توليد رمز QR', 'error'); }
      });
      printBtn.addEventListener('click', async () => {
        try { printQr(tenant.name, await qrReady); }
        catch (_) { window.utils.toast('تعذّر توليد رمز QR', 'error'); }
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
            await window.api.updateTenant({ name: fd.get('name') });
            window.utils.toast('تم حفظ الإعدادات', 'success');
            const el = document.querySelector('.sidebar-brand .tenant-name');
            if (el) el.textContent = fd.get('name');
            ctx.tenant.name = fd.get('name');
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
          } finally {
            delete submit.dataset.loading;
            submit.disabled = false;
          }
        });
      }

      // ─── كرت هوية الملعب: غلاف + وصف ────────────────
      mountBrandingCard(container, ctx, isOwner);

      // ─── قسم الإشعارات ────────────────────────────────
      const notifBody = container.querySelector('#notifications-body');
      if (notifBody) renderNotificationsSection(notifBody);
    },

    unmount() {}
  };

  function renderCoverSlot(slot, coverUrl, isOwner) {
    slot.dataset.state = coverUrl ? 'filled' : 'empty';
    if (coverUrl) {
      slot.innerHTML = `
        <img src="${window.utils.escapeHtml(coverUrl)}" alt="غلاف الملعب">
        ${isOwner ? `
          <div class="tenant-cover-slot__actions">
            <label class="btn btn--secondary btn--sm">
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden data-role="cover-replace">
              <i data-lucide="image"></i><span>تغيير</span>
            </label>
            <button type="button" class="btn btn--danger-quiet btn--sm" data-role="cover-remove">
              <i data-lucide="trash-2"></i><span>حذف</span>
            </button>
          </div>
        ` : ''}
      `;
    } else {
      slot.innerHTML = isOwner ? `
        <label class="tenant-cover-slot__add">
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden data-role="cover-replace">
          <i data-lucide="image-plus"></i>
          <span>إضافة صورة غلاف</span>
        </label>
      ` : `
        <div class="tenant-cover-slot__empty"><i data-lucide="image"></i><span>لا توجد صورة غلاف</span></div>
      `;
    }
    window.utils.renderIcons(slot);
  }

  function mountBrandingCard(container, ctx, isOwner) {
    const brandingForm = container.querySelector('#branding-form');
    const slot = container.querySelector('#cover-slot');
    const textarea = brandingForm ? brandingForm.querySelector('textarea[name="description"]') : null;
    const counter = container.querySelector('#desc-counter');

    if (textarea && counter) {
      textarea.addEventListener('input', () => {
        counter.textContent = textarea.value.length;
      });
    }

    if (!isOwner) return;

    let busy = false;
    async function withBusy(fn) {
      if (busy) return;
      busy = true;
      slot.dataset.busy = '1';
      try { await fn(); }
      catch (err) { window.utils.toast(window.utils.formatError(err), 'error'); }
      finally {
        busy = false;
        delete slot.dataset.busy;
      }
    }

    slot.addEventListener('change', (e) => {
      const input = e.target.closest('input[data-role="cover-replace"]');
      if (!input) return;
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      withBusy(async () => {
        const newUrl = await window.api.uploadTenantCover(file);
        ctx.tenant.cover_image_url = newUrl;
        renderCoverSlot(slot, newUrl, isOwner);
        window.utils.toast('تم حفظ صورة الغلاف', 'success');
      });
    });

    slot.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('button[data-role="cover-remove"]');
      if (!removeBtn) return;
      withBusy(async () => {
        const ok = await window.utils.confirm({
          title: 'حذف الغلاف',
          message: 'هل تريد حذف صورة الغلاف؟',
          confirmText: 'حذف',
          danger: true
        });
        if (!ok) return;
        await window.api.removeTenantCover();
        ctx.tenant.cover_image_url = null;
        renderCoverSlot(slot, null, isOwner);
        window.utils.toast('تم حذف الغلاف', 'success');
      });
    });

    const saveBtn = container.querySelector('#branding-save');
    brandingForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const description = (textarea?.value || '').trim();
      saveBtn.disabled = true;
      saveBtn.dataset.loading = 'true';
      try {
        await window.api.updateTenant({ description });
        ctx.tenant.description = description || null;
        window.utils.toast('تم حفظ الوصف', 'success');
      } catch (err) {
        window.utils.toast(window.utils.formatError(err), 'error');
      } finally {
        saveBtn.disabled = false;
        delete saveBtn.dataset.loading;
      }
    });
  }

  async function renderNotificationsSection(body) {
    const push = window.push;
    if (!push || !push.isSupported()) {
      body.innerHTML = `
        <p class="text-muted text-sm" style="margin:0">
          متصفحك لا يدعم الإشعارات. على iPhone: ثبّت التطبيق من خيار "إضافة إلى الشاشة الرئيسية" في Safari (iOS 16.4 أو أحدث).
        </p>
      `;
      return;
    }

    const perm = push.permission();
    const subscribed = await push.isSubscribed();

    if (perm === 'denied') {
      body.innerHTML = `
        <div style="display:flex;gap:var(--space-3);align-items:flex-start">
          <span class="stat-icon-chip stat-icon-chip--warning" style="flex-shrink:0"><i data-lucide="bell-off"></i></span>
          <div>
            <div class="fw-medium mb-xs">الإشعارات معطّلة</div>
            <p class="text-muted text-sm" style="margin:0">
              رفضت الإذن من قبل. لإعادة التفعيل: افتح إعدادات الموقع في المتصفح وأعد منح صلاحية الإشعارات.
            </p>
          </div>
        </div>
      `;
      window.utils.renderIcons(body);
      return;
    }

    if (perm === 'granted' && subscribed) {
      body.innerHTML = `
        <div style="display:flex;gap:var(--space-3);align-items:flex-start;justify-content:space-between;flex-wrap:wrap">
          <div style="display:flex;gap:var(--space-3);align-items:flex-start">
            <span class="stat-icon-chip stat-icon-chip--accent" style="flex-shrink:0"><i data-lucide="bell"></i></span>
            <div>
              <div class="fw-medium mb-xs">الإشعارات مفعّلة على هذا الجهاز</div>
              <p class="text-muted text-sm" style="margin:0">
                ستستلم تنبيهاً عند كل حجز جديد، حتى لو التطبيق مغلق.
              </p>
            </div>
          </div>
          <button type="button" class="btn btn--secondary btn--sm" id="notif-disable">إيقاف</button>
        </div>
      `;
      window.utils.renderIcons(body);
      body.querySelector('#notif-disable').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        const res = await push.unsubscribe();
        if (res.ok) {
          window.utils.toast('تم إيقاف الإشعارات', 'success');
          renderNotificationsSection(body);
        } else {
          window.utils.toast('تعذّر إيقاف الإشعارات', 'error');
          btn.disabled = false;
        }
      });
      return;
    }

    // default أو granted-but-not-subscribed
    body.innerHTML = `
      <div style="display:flex;gap:var(--space-3);align-items:flex-start;justify-content:space-between;flex-wrap:wrap">
        <div style="display:flex;gap:var(--space-3);align-items:flex-start">
          <span class="stat-icon-chip" style="flex-shrink:0"><i data-lucide="bell"></i></span>
          <div>
            <div class="fw-medium mb-xs">الإشعارات غير مفعّلة</div>
            <p class="text-muted text-sm" style="margin:0">
              فعّلها لاستلام تنبيه فوري على هذا الجهاز عند أي حجز جديد.
            </p>
          </div>
        </div>
        <button type="button" class="btn btn--primary btn--sm" id="notif-enable">
          <i data-lucide="bell"></i><span>تفعيل</span>
        </button>
      </div>
    `;
    window.utils.renderIcons(body);
    body.querySelector('#notif-enable').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const res = await push.subscribe();
      if (res.ok) {
        window.utils.toast('تم تفعيل الإشعارات', 'success');
        renderNotificationsSection(body);
      } else if (res.reason === 'denied') {
        window.utils.toast('رُفض الإذن من المتصفح', 'warning');
        renderNotificationsSection(body);
      } else if (res.reason === 'misconfigured') {
        window.utils.toast('الإشعارات غير مُهيّأة على الخادم بعد', 'error');
        btn.disabled = false;
      } else {
        window.utils.toast('تعذّر التفعيل', 'error');
        btn.disabled = false;
      }
    });
  }

  window.pages = window.pages || {};
  window.pages.settings = page;
})();
