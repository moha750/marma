// Fields API - استدعاءات Supabase الخاصة بالأرضيات

window.fieldsApi = (function () {
  const sb = () => window.sb;

  async function listFields(includeInactive = true) {
    let q = sb().from('fields').select('*').order('name');
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async function createField({ name }) {
    const tenantId = await window.tenantApi.getMyTenantId();
    const { data, error } = await sb()
      .from('fields')
      .insert({ name, tenant_id: tenantId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function updateField(id, { name, is_active }) {
    const patch = {};
    if (name !== undefined) patch.name = name;
    if (is_active !== undefined) patch.is_active = is_active;
    const { data, error } = await sb()
      .from('fields')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function deleteField(id) {
    const { error } = await sb().from('fields').delete().eq('id', id);
    if (error) throw error;
  }

  // المواعيد المتاحة لأرضية في تاريخ محدد
  async function getAvailableSlots(fieldId, dateStr) {
    const tenantId = await window.tenantApi.getMyTenantId();
    const { data, error } = await sb().rpc('get_available_slots', {
      p_tenant_id: tenantId,
      p_field_id: fieldId,
      p_date: dateStr
    });
    if (error) throw error;
    return data || [];
  }

  return { listFields, createField, updateField, deleteField, getAvailableSlots };
})();
