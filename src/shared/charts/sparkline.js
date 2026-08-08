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
//     showDot:   true,      // نقطة في نهاية الخط (آخر قيمة = الأحدث)
//     rtl:       true        // اتجاه الزمن — الافتراضي من اتجاه المستند
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
      strokeWidth = 1.75,
      rtl = (document.documentElement.getAttribute('dir') || document.dir) === 'rtl'
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

    // اتجاه الزمن يتبع اتجاه القراءة.
    //
    // التعليق السابق هنا كان يقول إنّ CSS يقلب الـ SVG في RTL — ولا وجود
    // لتلك القاعدة في styles/ كلها (بُحث عنها). فكان الأقدم يقع يساراً
    // والأحدث يميناً داخل صفحةٍ تُقرأ من اليمين: العين تبدأ عند «اليوم»
    // وتسير رجوعاً في الزمن، فيُقرأ الصعود هبوطاً.
    //
    // والقلب هنا لا في CSS: transform يقلب النصّ والنقطة معه، وحساب x
    // يبقيهما سليمين. والنقطة تظلّ على آخر قيمة (الأحدث) في الحالتين.
    const points = data.map((v, i) => {
      const idx = rtl ? (data.length - 1 - i) : i;
      const x = pad + idx * stepX;
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
