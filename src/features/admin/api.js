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

  async function adminSetTenantActive(tenantId, active, reason) {
    const { error } = await sb().rpc('admin_set_tenant_active', {
      p_tenant_id: tenantId, p_active: active, p_reason: reason || null
    });
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

  async function adminEndTrial(tenantId, reason) {
    const { error } = await sb().rpc('admin_end_trial', { p_tenant_id: tenantId, p_reason: reason || null });
    if (error) throw error;
  }

  async function adminEndSubscription(tenantId, reason) {
    const { error } = await sb().rpc('admin_end_subscription', { p_tenant_id: tenantId, p_reason: reason || null });
    if (error) throw error;
  }

  // ── الإيرادات + سجلّ الاشتراكات ──
  async function adminListSubscriptions(status) {
    const { data, error } = await sb().rpc('admin_list_subscriptions', { p_status: status || null });
    if (error) throw error;
    return data || [];
  }

  async function adminRevenueStats() {
    const { data, error } = await sb().rpc('admin_revenue_stats');
    if (error) throw error;
    return data;
  }

  async function adminGrowthStats() {
    const { data, error } = await sb().rpc('admin_growth_stats');
    if (error) throw error;
    return data;
  }

  // ── إدارة المشرفين ──
  async function adminListAdmins() {
    const { data, error } = await sb().rpc('admin_list_admins');
    if (error) throw error;
    return data || [];
  }
  async function adminAddAdmin(email) {
    const { error } = await sb().rpc('admin_add_admin', { p_email: email });
    if (error) throw error;
  }
  async function adminRemoveAdmin(userId) {
    const { error } = await sb().rpc('admin_remove_admin', { p_user_id: userId });
    if (error) throw error;
  }

  // ── البثّ (إشعار/بريد لكل الملّاك) ──
  async function adminBroadcastAudience() {
    const { data, error } = await sb().rpc('admin_broadcast_audience_counts');
    if (error) throw error;
    return data || { owners: 0, push_devices: 0 };
  }
  async function adminListBroadcasts() {
    const { data, error } = await sb().rpc('admin_list_broadcasts');
    if (error) throw error;
    return data || [];
  }
  async function adminBroadcastOwners() {
    const { data, error } = await sb().rpc('admin_broadcast_owners');
    if (error) throw error;
    return data || [];
  }

  // ── سجلّ النشاط ──
  async function adminListAuditLog(tenantId) {
    const { data, error } = await sb().rpc('admin_list_audit_log', { p_tenant_id: tenantId || null });
    if (error) throw error;
    return data || [];
  }
  async function adminBroadcast(payload) {
    const { data, error } = await sb().functions.invoke('admin-broadcast', { body: payload });
    if (error) {
      // استخرج رسالة الخطأ من جسم الاستجابة إن وُجدت
      let msg = error.message;
      try {
        const ctx = error.context && (await error.context.json());
        if (ctx && ctx.error) msg = ctx.error;
      } catch (_) {}
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  return {
    adminListPendingSubscriptions, adminListTenants, approveSubscription, rejectSubscription,
    adminTenantDetail, adminSetTenantActive, adminExtendTrial, adminGrantSubscription, adminSetLimits,
    adminEndTrial, adminEndSubscription,
    adminListSubscriptions, adminRevenueStats, adminGrowthStats,
    adminListAdmins, adminAddAdmin, adminRemoveAdmin,
    adminBroadcastAudience, adminListBroadcasts, adminBroadcastOwners, adminBroadcast,
    adminListAuditLog
  };
})();
