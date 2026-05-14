// Dashboard API - إحصائيات لوحة التحكم

window.dashboardApi = (function () {
  const sb = () => window.sb;

  async function getDashboardStats() {
    const { data, error } = await sb().rpc('dashboard_stats');
    if (error) throw error;
    return data;
  }

  return { getDashboardStats };
})();
