// Donut Chart — قطاعات حلقيّة مع رقم في المركز.
// للحالات (مؤكد/معلق/ملغي) ولـ مزيج المدفوع/غير المدفوع.
//
// الاستخدام:
//   window.charts.donut({
//     container: el,
//     data: [
//       { label: 'مؤكد', value: 24, color: 'var(--success)' },
//       { label: 'معلق', value: 6,  color: 'var(--warning)' },
//       { label: 'ملغي', value: 2,  color: 'var(--danger)' }
//     ],
//     size: 160,
//     centerLabel: '32',
//     centerSub:   'حجزاً',
//     showLegend:  true
//   });

(function () {
  if (!window.charts) window.charts = {};

  window.charts.donut = function donut(opts) {
    const {
      container,
      data = [],
      size = 160,
      thickness = 18,            // عرض الحلقة
      centerLabel = '',
      centerSub = '',
      showLegend = true,
      format = (v) => Intl.NumberFormat('ar-EG', { numberingSystem: 'latn' }).format(v)
    } = opts || {};

    if (!container) return;

    const total = data.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
    if (total === 0) {
      container.innerHTML = `<div class="chart-empty">لا توجد بيانات</div>`;
      return;
    }

    const r = (size - thickness) / 2;
    const cx = size / 2;
    const cy = size / 2;
    const circumference = 2 * Math.PI * r;

    // كل قطاع — نستخدم stroke-dasharray لرسمه بدون حسابات قوس معقّدة
    let offset = 0;
    const segments = data.map((d) => {
      const value = Number(d.value) || 0;
      if (value === 0) return '';
      const ratio = value / total;
      const dashLen = ratio * circumference;
      const segment = `
        <circle cx="${cx}" cy="${cy}" r="${r}"
                fill="none"
                stroke="${d.color || 'var(--accent-500)'}"
                stroke-width="${thickness}"
                stroke-dasharray="${dashLen} ${circumference - dashLen}"
                stroke-dashoffset="${-offset}"
                transform="rotate(-90 ${cx} ${cy})">
          <title>${escapeAttr(d.label)} — ${escapeAttr(format(value))} (${(ratio * 100).toFixed(0)}٪)</title>
        </circle>
      `;
      offset += dashLen;
      return segment;
    }).join('');

    const svg = `
      <svg class="chart-donut-svg"
           viewBox="0 0 ${size} ${size}"
           width="${size}" height="${size}"
           xmlns="http://www.w3.org/2000/svg"
           role="img">
        <!-- خلفية الحلقة -->
        <circle cx="${cx}" cy="${cy}" r="${r}"
                fill="none"
                stroke="var(--surface-2)"
                stroke-width="${thickness}"/>
        ${segments}
        ${centerLabel ? `
          <text x="${cx}" y="${cy - (centerSub ? 2 : -4)}"
                text-anchor="middle"
                font-size="${size * 0.18}"
                font-weight="700"
                fill="var(--text-primary)"
                style="font-variant-numeric: tabular-nums">${escapeText(centerLabel)}</text>
        ` : ''}
        ${centerSub ? `
          <text x="${cx}" y="${cy + 14}"
                text-anchor="middle"
                font-size="${size * 0.075}"
                font-weight="500"
                fill="var(--text-tertiary)">${escapeText(centerSub)}</text>
        ` : ''}
      </svg>
    `;

    const legend = showLegend ? `
      <ul class="chart-donut-legend">
        ${data.map((d) => {
          const value = Number(d.value) || 0;
          const pct = total ? ((value / total) * 100).toFixed(0) : 0;
          return `
            <li>
              <span class="dot" style="background:${d.color || 'var(--accent-500)'}"></span>
              <span class="label">${escapeText(d.label)}</span>
              <span class="value">${escapeText(format(value))}</span>
              <span class="pct">${pct}٪</span>
            </li>
          `;
        }).join('')}
      </ul>
    ` : '';

    container.innerHTML = `
      <div class="chart-donut">
        ${svg}
        ${legend}
      </div>
    `;
  };

  function escapeText(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  function escapeAttr(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
