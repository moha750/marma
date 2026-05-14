// Reports API - التقارير المالية

window.reportsApi = (function () {
  const sb = () => window.sb;

  async function getDailyReport(fromDate, toDate) {
    const { data, error } = await sb().rpc('daily_report', {
      from_date: fromDate,
      to_date: toDate
    });
    if (error) throw error;
    return data;
  }

  return { getDailyReport };
})();
