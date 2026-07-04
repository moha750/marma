// Visits API — تحليلات زيارات صفحة الحجز العامة (للمالك)
window.visitsApi = (function () {
  const sb = () => window.sb;

  // إحصاءات شاملة لنطاق تاريخ (jsonb واحد: totals/daily/sources/devices/...)
  async function getVisitsStats(fromDate, toDate) {
    const { data, error } = await sb().rpc('tenant_visits_stats', {
      p_from: fromDate,
      p_to: toDate
    });
    if (error) throw error;
    return data;
  }

  // عدد الجلسات النشطة الآن (آخر 5 دقائق) — يُستطلع كل 30 ثانية
  async function getVisitsLiveNow() {
    const { data, error } = await sb().rpc('visits_live_now');
    if (error) throw error;
    return Number(data) || 0;
  }

  return { getVisitsStats, getVisitsLiveNow };
})();
