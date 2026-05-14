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

  return { adminListPendingSubscriptions, adminListTenants, approveSubscription, rejectSubscription };
})();
