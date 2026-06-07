// Admin API - عمليات super-admin

window.adminApi = (function () {
  const sb = () => window.sb;

  async function adminListPendingSubscriptions() {
    const { data, error } = await sb().rpc('admin_list_pending_subscriptions');
    if (error) throw error;
    return data || [];
  }

  async function adminListTenants() {
    const { data, error } = await sb().rpc('admin_list_tenants');
    if (error) throw error;
    return data || [];
  }

  async function approveSubscription(subscriptionId) {
    const { data, error } = await sb().rpc('approve_subscription', {
      p_subscription_id: subscriptionId
    });
    if (error) throw error;
    return data;
  }

  async function rejectSubscription(subscriptionId, rejectReason) {
    const { error } = await sb().rpc('reject_subscription', {
      p_subscription_id: subscriptionId,
      p_reject_reason: rejectReason || null
    });
    if (error) throw error;
  }

  // ── تفاصيل وإدارة المستأجر ──
  async function adminTenantDetail(tenantId) {
    const { data, error } = await sb().rpc('admin_tenant_detail', { p_tenant_id: tenantId });
    if (error) throw error;
    return data;
  }

  async function adminSetTenantActive(tenantId, active) {
    const { error } = await sb().rpc('admin_set_tenant_active', { p_tenant_id: tenantId, p_active: active });
    if (error) throw error;
  }

  async function adminExtendTrial(tenantId, days) {
    const { error } = await sb().rpc('admin_extend_trial', { p_tenant_id: tenantId, p_days: days });
    if (error) throw error;
  }

  async function adminGrantSubscription(tenantId, days, fields, staff) {
    const { error } = await sb().rpc('admin_grant_subscription', {
      p_tenant_id: tenantId, p_days: days, p_fields: fields, p_staff: staff
    });
    if (error) throw error;
  }

  async function adminSetLimits(tenantId, fields, staff) {
    const { error } = await sb().rpc('admin_set_limits', { p_tenant_id: tenantId, p_fields: fields, p_staff: staff });
    if (error) throw error;
  }

  return {
    adminListPendingSubscriptions, adminListTenants, approveSubscription, rejectSubscription,
    adminTenantDetail, adminSetTenantActive, adminExtendTrial, adminGrantSubscription, adminSetLimits
  };
})();
