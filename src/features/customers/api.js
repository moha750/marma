// Customers API - استدعاءات Supabase الخاصة بالعملاء

window.customersApi = (function () {
  const sb = () => window.sb;

  async function listCustomers(search = '') {
    let q = sb()
      .from('customers')
      .select('id, full_name, phone, notes, created_at')
      .order('full_name');
    if (search && search.trim()) {
      const s = search.trim();
      q = q.or(`full_name.ilike.%${s}%,phone.ilike.%${s}%`);
    }
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async function getCustomer(id) {
    const { data, error } = await sb()
      .from('customers')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  }

  async function createCustomer({ full_name, phone, notes }) {
    const tenantId = await window.tenantApi.getMyTenantId();
    const { data, error } = await sb()
      .from('customers')
      .insert({ full_name, phone, notes, tenant_id: tenantId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function updateCustomer(id, { full_name, phone, notes }) {
    const patch = {};
    if (full_name !== undefined) patch.full_name = full_name;
    if (phone !== undefined) patch.phone = phone;
    if (notes !== undefined) patch.notes = notes;
    const { data, error } = await sb()
      .from('customers')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function getCustomerBookings(customerId) {
    const { data, error } = await sb()
      .from('bookings')
      .select('id, start_time, end_time, total_price, paid_amount, status, notes, field_id, customer_id, customer_input_name, created_by, whatsapp_confirmed_at, cancelled_by, cancelled_at, no_show_at, fields(id, name), customers(id, full_name, phone)')
      .eq('customer_id', customerId)
      .order('start_time', { ascending: false });
    if (error) throw error;
    return data;
  }

  // موثوقية العميل: مرات الغياب من إجمالي حجوزاته السابقة الفعلية (المقبولة الفائتة)
  async function getCustomerReliability(customerId) {
    const nowIso = new Date().toISOString();
    const [ns, past] = await Promise.all([
      sb().from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', customerId)
        .not('no_show_at', 'is', null),
      sb().from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', customerId)
        .in('status', ['confirmed', 'completed'])
        .lt('start_time', nowIso)
    ]);
    if (ns.error) throw ns.error;
    if (past.error) throw past.error;
    return { noShows: ns.count || 0, pastBookings: past.count || 0 };
  }

  async function countCustomerBookings(customerId) {
    const { count, error } = await sb()
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId);
    if (error) throw error;
    return count || 0;
  }

  return { listCustomers, getCustomer, createCustomer, updateCustomer, getCustomerBookings, countCustomerBookings, getCustomerReliability };
})();
