// أداة قصّ صور خفيفة (canvas) — سحب + تكبير داخل إطار ثابت النسبة.
// عامة وقابلة لإعادة الاستخدام (الغلاف الآن، صور الأرضيات لاحقاً).
//
//   window.cropImage(file, {
//     aspect = 1200/630,        // نسبة الإطار (عرض/ارتفاع)
//     outWidth = 1200, outHeight = 630,
//     mime = 'image/jpeg', quality = 0.85,
//     title = 'تعديل الصورة'
//   }) => Promise<Blob|null>     // null عند الإلغاء
//
// النموذج: الصورة موضوعة absolute في وسط الإطار (top/left 50% + translate(-50%,-50%))
// ثم تُزاح بـ (tx,ty) وتُكبَّر بـ scale = baseScale*zoom حيث baseScale = "cover".
(function () {
  const MAX_ZOOM = 4;

  function cropImage(file, opts = {}) {
    const {
      aspect = 1200 / 630,
      outWidth = 1200,
      outHeight = 630,
      mime = 'image/jpeg',
      quality = 0.85,
      title = 'تعديل الصورة',
    } = opts;

    return new Promise((resolve) => {
      let settled = false;
      const settle = (v) => { if (settled) return; settled = true; resolve(v); };

      const objectUrl = URL.createObjectURL(file);

      const body = `
        <div class="cropper">
          <div class="cropper__stage" data-role="stage" style="aspect-ratio:${aspect}">
            <img class="cropper__img" data-role="img" alt="" draggable="false">
          </div>
          <div class="cropper__controls">
            <button type="button" class="cropper__zbtn" data-action="zoom-out" aria-label="تصغير"><i data-lucide="minus"></i></button>
            <input type="range" class="cropper__range" data-role="zoom" min="1" max="${MAX_ZOOM}" step="0.01" value="1" aria-label="تكبير">
            <button type="button" class="cropper__zbtn" data-action="zoom-in" aria-label="تكبير"><i data-lucide="plus"></i></button>
          </div>
          <p class="cropper__hint">اسحب لتحريك الصورة، واستخدم الشريط أو عجلة الفأرة للتكبير.</p>
        </div>`;
      const footer = `
        <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
        <button type="button" class="btn btn--primary" data-action="save">حفظ</button>`;

      const ctrl = window.utils.openModal({
        title, body, footer, size: 'lg',
        onClose: () => { try { URL.revokeObjectURL(objectUrl); } catch (_) {} settle(null); },
      });

      const stage = ctrl.modal.querySelector('[data-role="stage"]');
      const img = ctrl.modal.querySelector('[data-role="img"]');
      const range = ctrl.modal.querySelector('[data-role="zoom"]');

      let natW = 0, natH = 0;     // أبعاد الصورة الطبيعية
      let baseScale = 1;          // مقياس "cover" عند zoom=1
      let zoom = 1;               // 1..MAX_ZOOM فوق baseScale
      let tx = 0, ty = 0;         // إزاحة بالبكسل داخل الإطار
      let frameW = 0, frameH = 0;
      let ready = false;

      const scale = () => baseScale * zoom;
      const dispW = () => natW * scale();
      const dispH = () => natH * scale();

      function clamp() {
        const maxX = Math.max(0, (dispW() - frameW) / 2);
        const maxY = Math.max(0, (dispH() - frameH) / 2);
        tx = Math.min(maxX, Math.max(-maxX, tx));
        ty = Math.min(maxY, Math.max(-maxY, ty));
      }

      function render() {
        clamp();
        img.style.width = dispW() + 'px';
        img.style.height = dispH() + 'px';
        img.style.transform = `translate(-50%, -50%) translate(${tx}px, ${ty}px)`;
      }

      function setZoom(nz) {
        nz = Math.min(MAX_ZOOM, Math.max(1, nz));
        const ratio = nz / zoom;
        tx *= ratio; ty *= ratio; // تكبير من المركز
        zoom = nz;
        range.value = String(zoom);
        render();
      }

      img.onload = () => {
        natW = img.naturalWidth; natH = img.naturalHeight;
        const r = stage.getBoundingClientRect();
        frameW = r.width; frameH = r.height;
        if (!natW || !natH || !frameW || !frameH) return;
        baseScale = Math.max(frameW / natW, frameH / natH); // cover
        zoom = 1; tx = 0; ty = 0;
        range.value = '1';
        ready = true;
        render();
      };
      img.onerror = () => { window.utils.toast('تعذّر تحميل الصورة', 'error'); ctrl.close(); };
      img.src = objectUrl;

      // ── التكبير: الشريط + الأزرار + العجلة ──
      range.addEventListener('input', () => setZoom(parseFloat(range.value)));
      ctrl.modal.querySelector('[data-action="zoom-in"]').addEventListener('click', () => setZoom(zoom + 0.2));
      ctrl.modal.querySelector('[data-action="zoom-out"]').addEventListener('click', () => setZoom(zoom - 0.2));
      stage.addEventListener('wheel', (e) => {
        if (!ready) return;
        e.preventDefault();
        setZoom(zoom + (e.deltaY < 0 ? 0.15 : -0.15));
      }, { passive: false });

      // ── السحب + القرص بإصبعين (Pointer Events) ──
      const pointers = new Map();
      let pinchDist = 0;
      function dist() {
        const p = [...pointers.values()];
        return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      }
      stage.addEventListener('pointerdown', (e) => {
        if (!ready) return;
        stage.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) pinchDist = dist();
      });
      stage.addEventListener('pointermove', (e) => {
        if (!ready || !pointers.has(e.pointerId)) return;
        const prev = pointers.get(e.pointerId);
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) {
          const d = dist();
          if (pinchDist > 0) setZoom(zoom * (d / pinchDist));
          pinchDist = d;
        } else {
          tx += dx; ty += dy;
          render();
        }
      });
      const endPointer = (e) => {
        if (pointers.has(e.pointerId)) pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchDist = 0;
      };
      stage.addEventListener('pointerup', endPointer);
      stage.addEventListener('pointercancel', endPointer);

      // ── الأزرار ──
      ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', () => ctrl.close());

      ctrl.modal.querySelector('[data-action="save"]').addEventListener('click', () => {
        if (!ready) return;
        const s = scale();
        let srcW = frameW / s, srcH = frameH / s;
        let srcX = (natW - srcW) / 2 - tx / s;
        let srcY = (natH - srcH) / 2 - ty / s;
        // قصّ دفاعي ضمن حدود الصورة
        srcW = Math.min(srcW, natW); srcH = Math.min(srcH, natH);
        srcX = Math.min(Math.max(0, srcX), natW - srcW);
        srcY = Math.min(Math.max(0, srcY), natH - srcH);

        const canvas = document.createElement('canvas');
        canvas.width = outWidth; canvas.height = outHeight;
        const cx = canvas.getContext('2d');
        cx.imageSmoothingQuality = 'high';
        cx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outWidth, outHeight);
        canvas.toBlob((blob) => {
          if (!blob) { window.utils.toast('تعذّر معالجة الصورة', 'error'); return; }
          settle(blob);           // يضبط settled=true؛ onClose بعدها لن يُرجع null
          ctrl.close();
        }, mime, quality);
      });
    });
  }

  window.cropImage = cropImage;
})();
