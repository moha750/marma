// Sparkline — منحنى صغير، مساحة معبأة اختيارية، لإظهار اتجاه القيمة في بطاقة إحصائيّة.
// لا اعتمادات. ينتج SVG عبر CSS variables → ينساب مع وضع الألوان.
//
// الاستخدام:
//   window.charts.sparkline({
//     container: el,        // عنصر HTML (مطلوب)
//     data:      [10,12,8,15,...],   // أرقام
//     color:     'var(--accent-500)' // اختياري — اللون الافتراضي accent
//     fill:      true,      // تعبئة المساحة تحت الخط
//     height:    32,        // ارتفاع SVG (افتراضي 32)
//     showDot:   true       // نقطة في نهاية الخط
//   });

(function () {
  if (!window.charts) window.charts = {};

  window.charts.sparkline = function sparkline(opts) {
    const {
      container,
      data = [],
      color = 'var(--accent-500)',
      fill = true,
      height = 32,
      showDot = true,
      strokeWidth = 1.75
    } = opts || {};

    if (!container) return;

    if (!Array.isArray(data) || data.length < 2) {
      container.innerHTML = `<div class="chart-empty">—</div>`;
      return;
    }

    const w = 100;          // ViewBox width — يتمدد حسب CSS
    const h = height;
    const pad = strokeWidth + 1;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const stepX = (w - pad * 2) / (data.length - 1);

    // نُسلِّط النقاط من اليسار لليمين كالعادة؛ في RTL، CSS يقلب الـ SVG (انظر CSS).
    const points = data.map((v, i) => {
      const x = pad + i * stepX;
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return [x, y];
    });

    const linePath = 'M ' + points.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' L ');
    const areaPath = linePath + ` L ${points[points.length - 1][0].toFixed(2)},${h} L ${points[0][0].toFixed(2)},${h} Z`;

    const gradId = `spk-grad-${Math.random().toString(36).slice(2, 8)}`;

    const last = points[points.length - 1];

    const svg = `
      <svg class="chart-sparkline"
           viewBox="0 0 ${w} ${h}"
           preserveAspectRatio="none"
           xmlns="http://www.w3.org/2000/svg"
           role="img"
           aria-label="مؤشّر اتجاه">
        ${fill ? `
          <defs>
            <linearGradient id="${gradId}" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%"   stop-color="${color}" stop-opacity="0.22"/>
              <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <path d="${areaPath}" fill="url(#${gradId})" stroke="none"/>
        ` : ''}
        <path d="${linePath}"
              fill="none"
              stroke="${color}"
              stroke-width="${strokeWidth}"
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"/>
        ${showDot ? `
          <circle cx="${last[0].toFixed(2)}" cy="${last[1].toFixed(2)}"
                  r="2.5" fill="${color}" stroke="var(--surface-1)" stroke-width="1.5"
                  vector-effect="non-scaling-stroke"/>
        ` : ''}
      </svg>
    `;

    container.innerHTML = svg;
  };
})();
