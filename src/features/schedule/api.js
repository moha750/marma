// Schedule API - فترات العمل لكل أرضية

window.scheduleApi = (function () {
  const sb = () => window.sb;

  async function listWorkingPeriods(fieldId) {
    const { data, error } = await sb()
      .from('working_periods')
      .select('id, field_id, day_of_week, open_time, close_time, slot_duration_minutes, hourly_price')
      .eq('field_id', fieldId)
      .order('day_of_week')
      .order('open_time');
    if (error) throw error;
    return data;
  }

  // استبدال كل فترات يوم لأرضية محددة (atomic)
  async function setDayPeriods(fieldId, dayOfWeek, periods) {
    const { data, error } = await sb().rpc('set_day_periods', {
      p_field_id: fieldId,
      p_day_of_week: dayOfWeek,
      p_periods: periods
    });
    if (error) throw error;
    return data;
  }

  return { listWorkingPeriods, setDayPeriods };
})();
