// أداة قصّ صور خفيفة (canvas) — سحب + تكبير موحّد داخل إطار ثابت النسبة.
// عامة وقابلة لإعادة الاستخدام (الغلاف الآن، صور الأرضيات لاحقاً).
//
//   window.cropImage(file, {
//     aspect = 1200/630,        // نسبة الإطار (عرض/ارتفاع)
//     outWidth = 1200, outHeight = 630,
//     mime = 'image/jpeg', quality = 0.85,
//     title = 'تعديل الصورة'
//   }) => Promise<Blob|null>     // null عند الإلغاء
//
// تكبير موحّد: الشريط ينتقل من "احتواء كامل" (الصورة كلها ظاهرة بهوامش) إلى
// "ملء الإطار" ثم "تكبير وقصّ". الهوامش (للصور المربّعة/الطويلة كالشعارات)
// تُملأ بخلفية ضبابية من الصورة نفسها، مع اللون السائد كبديل لو المتصفّح لا
// يدعم تمويه canvas. افتراضي ذكي: الصورة القريبة من نسبة الإطار تفتح على "ملء"،
// والمربّعة/الطويلة تفتح على "احتواء" حتى يظهر الشعار كاملاً.
(function () {
  const MAX_OVER = 4;        // أقصى تكبير = 4× فوق "الملء"
  const AUTO_CONTAIN = 1.25; // لو تجاوز القصّ 25% في أحد البعدين → ابدأ بالاحتواء

  function canvasFilterSupported() {
    try {
      const c = document.createElement('canvas').getContext('2d');
      c.filter = 'blur(1px)';
      return c.filter === 'blur(1px)';
    } catch (_) { return false; }
  }

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
            <img class="cropper__bg"  data-role="bg"  alt="" draggable="false">
            <img class="cropper__img" data-role="img" alt="" draggable="false">
          </div>
          <div class="cropper__controls">
            <button type="button" class="cropper__zbtn" data-action="zoom-out" aria-label="تصغير"><i data-lucide="minus"></i></button>
            <input type="range" class="cropper__range" data-role="zoom" min="0" max="1" step="0.001" value="0" aria-label="تكبير">
            <button type="button" class="cropper__zbtn" data-action="zoom-in" aria-label="تكبير"><i data-lucide="plus"></i></button>
          </div>
          <p class="cropper__hint">اسحب لتحريك الصورة. صغّر لإظهار الشعار كاملاً على خلفية، أو كبّر للقصّ.</p>
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
      const bg = ctrl.modal.querySelector('[data-role="bg"]');
      const range = ctrl.modal.querySelector('[data-role="zoom"]');

      let natW = 0, natH = 0;
      let frameW = 0, frameH = 0;
      let coverScale = 1, containScale = 1;  // مقاييس مرجعية
      let scaleMin = 1, scaleMax = 1;        // حدود التكبير الفعلية
      let scale = 1, tx = 0, ty = 0;         // الحالة الحالية
      let domColor = '#1a1a1a';
      let ready = false;
      const filterOK = canvasFilterSupported();

      const dispW = () => natW * scale;
      const dispH = () => natH * scale;

      function clamp() {
        // عند الاحتواء (أصغر من الإطار) → maxX/Y = 0 (توسيط). عند التكبير → سماح بالتحريك.
        const maxX = Math.max(0, (dispW() - frameW) / 2);
        const maxY = Math.max(0, (dispH() - frameH) / 2);
        tx = Math.min(maxX, Math.max(-maxX, tx));
        ty = Math.min(maxY, Math.max(-maxY, ty));
      }

      // الشريط 0..1 ↔ scaleMin..scaleMax (خطّي)
      function scaleToSlider(s) { return (s - scaleMin) / (scaleMax - scaleMin || 1); }
      function sliderToScale(v) { return scaleMin + v * (scaleMax - scaleMin); }

      function render() {
        clamp();
        img.style.width = dispW() + 'px';
        img.style.height = dispH() + 'px';
        img.style.transform = `translate(-50%, -50%) translate(${tx}px, ${ty}px)`;
        range.value = String(scaleToSlider(scale));
      }

      function setScale(ns) {
        ns = Math.min(scaleMax, Math.max(scaleMin, ns));
        const ratio = ns / scale;
        tx *= ratio; ty *= ratio; // تكبير من المركز
        scale = ns;
        render();
      }

      img.onload = () => {
        natW = img.naturalWidth; natH = img.naturalHeight;
        const r = stage.getBoundingClientRect();
        frameW = r.width; frameH = r.height;
        if (!natW || !natH || !frameW || !frameH) return;

        coverScale = Math.max(frameW / natW, frameH / natH);
        containScale = Math.min(frameW / natW, frameH / natH);
        scaleMin = containScale;
        scaleMax = coverScale * MAX_OVER;

        // افتراضي ذكي: ملء لو القصّ بسيط، احتواء لو الصورة مربّعة/طويلة
        const srcAspect = natW / natH;
        const overflow = Math.max(srcAspect / aspect, aspect / srcAspect);
        scale = overflow > AUTO_CONTAIN ? containScale : coverScale;
        tx = 0; ty = 0;

        // اللون السائد (بديل الخلفية) — متوسّط الصورة عبر تصغيرها لـ 1×1
        try {
          const t = document.createElement('canvas');
          t.width = t.height = 1;
          const tc = t.getContext('2d', { willReadFrequently: true });
          tc.drawImage(img, 0, 0, 1, 1);
          const d = tc.getImageData(0, 0, 1, 1).data;
          domColor = `rgb(${d[0]},${d[1]},${d[2]})`;
        } catch (_) { /* أبقِ الافتراضي */ }
        stage.style.backgroundColor = domColor;

        ready = true;
        render();
      };
      img.onerror = () => { window.utils.toast('تعذّر تحميل الصورة', 'error'); ctrl.close(); };
      bg.src = objectUrl;
      img.src = objectUrl;

      // ── التكبير: الشريط + الأزرار + العجلة ──
      range.addEventListener('input', () => setScale(sliderToScale(parseFloat(range.value))));
      ctrl.modal.querySelector('[data-action="zoom-in"]').addEventListener('click', () => setScale(scale * 1.12));
      ctrl.modal.querySelector('[data-action="zoom-out"]').addEventListener('click', () => setScale(scale / 1.12));
      stage.addEventListener('wheel', (e) => {
        if (!ready) return;
        e.preventDefault();
        setScale(scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
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
          if (pinchDist > 0) setScale(scale * (d / pinchDist));
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
        const canvas = document.createElement('canvas');
        canvas.width = outWidth; canvas.height = outHeight;
        const cx = canvas.getContext('2d');
        cx.imageSmoothingQuality = 'high';

        // 1) خلفية: لون سائد دائماً (قاعدة)، ثم نسخة ضبابية مغطّية لو التمويه مدعوم
        cx.fillStyle = domColor;
        cx.fillRect(0, 0, outWidth, outHeight);
        if (filterOK) {
          const bs = Math.max(outWidth / natW, outHeight / natH);
          const bw = natW * bs, bh = natH * bs;
          cx.filter = `blur(${Math.round(outWidth * 0.025)}px)`;
          cx.drawImage(img, (outWidth - bw) / 2, (outHeight - bh) / 2, bw, bh);
          cx.filter = 'none';
        }

        // 2) الصورة الأمامية بنفس موضع/مقياس المعاينة (القصّ يحدث بقصّ canvas تلقائياً)
        const K = outWidth / frameW;
        const dw = natW * scale * K, dh = natH * scale * K;
        const dx = (outWidth - dw) / 2 + tx * K;
        const dy = (outHeight - dh) / 2 + ty * K;
        cx.drawImage(img, dx, dy, dw, dh);

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
