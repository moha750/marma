// Heatmap — شبكة يوم × ساعة. كثافة لون العلامة = نسبة الاستفادة.
// يجيب على "متى أكون مشغولاً؟" في صفحة الـ dashboard وفي التقارير.
//
// الاستخدام:
//   window.charts.heatmap({
//     container: el,
//     days:  ['السبت', 'الأحد', 'الإثنين', ...],            // 7 أيام (مرتّبة كما تريد)
//     hours: ['08','09','10', ..., '23'],                   // أوقات اليوم
//     data:  [[0,0,2,5,8,..], [..], ..],                    // مصفوفة days×hours
//     max:   10,                                            // اختياري — أقصى قيمة للتطبيع
//     format: (v) => `${v} حجزاً`,
//     onCell: (d, h, value) => { … }                        // اختياري — للنقر
//   });

(function () {
  if (!window.charts) window.charts = {};

  window.charts.heatmap = function heatmap(opts) {
    const {
      container,
      days = [],
      hours = [],
      data = [],
      max = null,
      format = (v) => String(v),
      onCell = null
    } = opts || {};

    if (!container) return;

    if (!days.length || !hours.length) {
      container.innerHTML = `<div class="chart-empty">لا توجد بيانات</div>`;
      return;
    }

    // احسب الحد الأقصى للتطبيع
    let mx = max;
    if (mx == null) {
      mx = 0;
      data.forEach((row) => row.forEach((v) => { if (v > mx) mx = v; }));
    }
    if (mx === 0) mx = 1;

    const table = document.createElement('table');
    table.className = 'chart-heatmap';

    // ─── الرأس: ساعات اليوم ───
    const thead = document.createElement('thead');
    const trH = document.createElement('tr');
    trH.appendChild(document.createElement('th'));     // زاوية فارغة
    hours.forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      th.className = 'chart-heatmap-hourlabel';
      trH.appendChild(th);
    });
    thead.appendChild(trH);
    table.appendChild(thead);

    // ─── الجسم: صف لكل يوم ───
    const tbody = document.createElement('tbody');
    days.forEach((dayLabel, dIdx) => {
      const tr = document.createElement('tr');

      const th = document.createElement('th');
      th.textContent = dayLabel;
      th.className = 'chart-heatmap-daylabel';
      tr.appendChild(th);

      const row = data[dIdx] || [];
      hours.forEach((hLabel, hIdx) => {
        const value = Number(row[hIdx]) || 0;
        const ratio = Math.min(value / mx, 1);

        const td = document.createElement('td');
        td.className = 'chart-heatmap-cell';
        td.dataset.value = value;
        td.dataset.day = dayLabel;
        td.dataset.hour = hLabel;

        if (value === 0) {
          td.classList.add('is-zero');
        } else {
          // درجة من 1 إلى 5 — تربط بـ CSS classes
          const step = Math.max(1, Math.ceil(ratio * 5));
          td.classList.add(`is-step-${step}`);
        }

        td.setAttribute('title', `${dayLabel} ${hLabel} — ${format(value)}`);

        if (onCell && value > 0) {
          td.style.cursor = 'pointer';
          td.addEventListener('click', () => onCell(dayLabel, hLabel, value));
        }

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    container.innerHTML = '';
    container.appendChild(table);

    // مقياس اللون (legend)
    const legend = document.createElement('div');
    legend.className = 'chart-heatmap-legend';
    legend.innerHTML = `
      <span>قليل</span>
      <span class="chart-heatmap-cell is-step-1"></span>
      <span class="chart-heatmap-cell is-step-2"></span>
      <span class="chart-heatmap-cell is-step-3"></span>
      <span class="chart-heatmap-cell is-step-4"></span>
      <span class="chart-heatmap-cell is-step-5"></span>
      <span>كثير</span>
    `;
    container.appendChild(legend);
  };
})();
