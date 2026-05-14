// Bookings API - استدعاءات Supabase الخاصة بالحجوزات

window.bookingsApi = (function () {
  const sb = () => window.sb;

  async function listBookings({ from, to, fieldId, status, limit, customerId } = {}) {
    let q = sb()
      .from('bookings')
      .select('id, start_time, end_time, total_price, paid_amount, status, notes, field_id, customer_id, customer_input_name, created_at, fields(id, name), customers(id, full_name, phone)')
      .order('start_time', { ascending: false });
    if (from) q = q.gte('start_time', new Date(from).toISOString());
    if (to) q = q.lte('start_time', new Date(to).toISOString());
    if (fieldId) q = q.eq('field_id', fieldId);
    if (status) q = q.eq('status', status);
    if (customerId) q = q.eq('customer_id', customerId);
    if (limit) q = q.limit(limit);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async function getBooking(id) {
    const { data, error } = await sb()
      .from('bookings')
      .select('*, fields(id, name), customers(id, full_name, phone)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  }

  async function createBooking(payload) {
    const tenantId = await window.tenantApi.getMyTenantId();
    const { data: { user } } = await sb().auth.getUser();
    const { data, error } = await sb()
      .from('bookings')
      .insert({
        ...payload,
        tenant_id: tenantId,
        created_by: user ? user.id : null
      })
      .select('*, fields(id, name), customers(id, full_name, phone)')
      .single();
    if (error) throw error;
    return data;
  }

  async function updateBooking(id, patch) {
    const { data, error } = await sb()
      .from('bookings')
      .update(patch)
      .eq('id', id)
      .select('*, fields(id, name), customers(id, full_name, phone)')
      .single();
    if (error) throw error;
    return data;
  }

  async function cancelBooking(id) {
    return updateBooking(id, { status: 'cancelled' });
  }

  // الموافقة على حجز معلّق. إذا اختار الموظف "تحديث الاسم"، نحدّث customer.full_name قبل الموافقة
  async function approveBooking(id, { useNewName } = {}) {
    if (useNewName) {
      const booking = await getBooking(id);
      if (booking.customer_input_name && booking.customer_id) {
        const { error: cErr } = await sb()
          .from('customers')
          .update({ full_name: booking.customer_input_name })
          .eq('id', booking.customer_id);
        if (cErr) throw cErr;
      }
    }
    return updateBooking(id, { status: 'confirmed', customer_input_name: null });
  }

  async function rejectBooking(id) {
    return updateBooking(id, { status: 'cancelled', customer_input_name: null });
  }

  async function listPendingBookings(limit) {
    return listBookings({ status: 'pending', limit });
  }

  return {
    listBookings, getBooking, createBooking, updateBooking,
    cancelBooking, approveBooking, rejectBooking, listPendingBookings
  };
})();
