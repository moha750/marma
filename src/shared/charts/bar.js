// Bar Chart — رسم أعمدة عمودي مع تسميات محور x وخطوط شبكة خفيفة.
// مفيد للتقارير اليومية/الإيرادات الأسبوعية. RTL-aware: الأعمدة تُرتَّب من اليمين للأيسر.
//
// الاستخدام:
//   window.charts.bar({
//     container: el,
//     data: [{ label: 'السبت', value: 1200 }, { label: 'الأحد', value: 800 }, ...],
//     height: 220,             // اختياري
//     color: 'var(--accent-500)',
//     format: (v) => v.toFixed(0)  // كيف تُكتب القيم في tooltip
//   });

(function () {
  if (!window.charts) window.charts = {};

  window.charts.bar = function bar(opts) {
    const {
      container,
      data = [],
      height = 220,
      color = 'var(--accent-500)',
      format = (v) => Intl.NumberFormat('ar-EG', { numberingSystem: 'latn' }).format(v),
      showValues = false        // اكتب القيمة فوق كل عمود
    } = opts || {};

    if (!container) return;
    if (!Array.isArray(data) || data.length === 0) {
      container.innerHTML = `<div class="chart-empty">لا توجد بيانات</div>`;
      return;
    }

    const values = data.map((d) => Number(d.value) || 0);
    const max = Math.max(...values, 1);
    const gridSteps = 4;        // 4 خطوط أفقية (25% / 50% / 75% / 100%)

    const w = 100;              // ViewBox width
    const padTop = 12;
    const padBottom = 22;
    const chartH = height - padTop - padBottom;

    const slotW = w / data.length;
    const barW = slotW * 0.62;
    const barGap = (slotW - barW) / 2;

    // خطوط الشبكة
    const grid = [];
    for (let i = 1; i <= gridSteps; i++) {
      const y = padTop + chartH - (chartH * i) / gridSteps;
      grid.push(`<line x1="0" x2="${w}" y1="${y}" y2="${y}" stroke="var(--border-subtle)" stroke-width="0.5" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>`);
    }

    // الأعمدة
    const bars = data.map((d, i) => {
      const value = Number(d.value) || 0;
      const ratio = value / max;
      const barH = Math.max(ratio * chartH, value > 0 ? 2 : 0);   // إظهار خيط رفيع حتى لقيم > 0
      const x = i * slotW + barGap;
      const y = padTop + chartH - barH;
      const isHighlight = d.highlight === true;
      const barColor = isHighlight ? 'var(--warning)' : color;
      return `
        <g class="chart-bar" data-label="${escapeAttr(d.label)}" data-value="${value}">
          <rect x="${x}" y="${y}" width="${barW}" height="${barH}"
                rx="1" fill="${barColor}" opacity="0.9">
            <title>${escapeAttr(d.label)} — ${escapeAttr(format(value))}</title>
          </rect>
          ${showValues && value > 0 ? `
            <text x="${x + barW / 2}" y="${y - 3}"
                  text-anchor="middle"
                  font-size="2.4" font-weight="600"
                  fill="var(--text-primary)">
              ${escapeText(format(value))}
            </text>
          ` : ''}
        </g>
      `;
    }).join('');

    // تسميات محور x
    const labels = data.map((d, i) => {
      const x = i * slotW + slotW / 2;
      return `<text x="${x}" y="${height - 6}"
                    text-anchor="middle"
                    font-size="2.4"
                    fill="var(--text-tertiary)">${escapeText(d.label)}</text>`;
    }).join('');

    // تسميات محور y (4 درجات + الصفر)
    const yTicks = [];
    for (let i = 0; i <= gridSteps; i++) {
      const value = (max * i) / gridSteps;
      const y = padTop + chartH - (chartH * i) / gridSteps;
      yTicks.push(`<text x="-1" y="${y + 1}" font-size="2.2" text-anchor="end" fill="var(--text-tertiary)">${escapeText(formatTick(value))}</text>`);
    }

    container.innerHTML = `
      <svg class="chart-bar-svg"
           viewBox="-7 0 ${w + 9} ${height}"
           preserveAspectRatio="none"
           xmlns="http://www.w3.org/2000/svg">
        <g class="chart-grid">${grid.join('')}</g>
        <g class="chart-yticks">${yTicks.join('')}</g>
        <g class="chart-bars">${bars}</g>
        <g class="chart-xlabels">${labels}</g>
      </svg>
    `;
  };

  function formatTick(v) {
    if (v >= 1000000) return (v / 1000000).toFixed(v % 1000000 ? 1 : 0) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'K';
    return String(Math.round(v));
  }

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
