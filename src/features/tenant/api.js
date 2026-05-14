// Tenant API - بيانات الملعب الحالي + helper لجلب tenant_id

window.tenantApi = (function () {
  const sb = () => window.sb;

  let cachedTenantId = null;

  async function getMyTenantId() {
    if (cachedTenantId) return cachedTenantId;
    if (window.auth) {
      const profile = await window.auth.loadProfile();
      cachedTenantId = profile.tenant_id;
      return cachedTenantId;
    }
    const { data, error } = await sb()
      .from('profiles')
      .select('tenant_id')
      .single();
    if (error) throw error;
    cachedTenantId = data.tenant_id;
    return cachedTenantId;
  }

  async function updateTenant({ name, city, phone }) {
    const tenantId = await getMyTenantId();
    const patch = {};
    if (name !== undefined) patch.name = name;
    if (city !== undefined) patch.city = city;
    if (phone !== undefined) patch.phone = phone;
    const { data, error } = await sb()
      .from('tenants')
      .update(patch)
      .eq('id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function getMyTenant() {
    const tenantId = await getMyTenantId();
    const { data, error } = await sb()
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .single();
    if (error) throw error;
    return data;
  }

  function _resetTenantIdCache() {
    cachedTenantId = null;
  }

  return { getMyTenantId, updateTenant, getMyTenant, _resetTenantIdCache };
})();
