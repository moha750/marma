// Subscriptions API - الخطط والاشتراكات (للمستأجر)

window.subscriptionsApi = (function () {
  const sb = () => window.sb;

  async function listPlans() {
    const { data, error } = await sb().rpc('list_plans');
    if (error) throw error;
    return data || [];
  }

  async function getMySubscriptionStatus() {
    const { data, error } = await sb().rpc('get_my_subscription_status');
    if (error) throw error;
    return data;
  }

  async function listMySubscriptions() {
    const { data, error } = await sb().rpc('list_my_subscriptions');
    if (error) throw error;
    return data || [];
  }

  async function requestSubscription({ plan_id, fields, staff, payment_reference, note }) {
    const { data, error } = await sb().rpc('request_subscription', {
      p_plan_id:   plan_id,
      p_fields:    fields,
      p_staff:     staff,
      p_reference: payment_reference,
      p_note:      note || null
    });
    if (error) throw error;
    return data;
  }

  return { listPlans, getMySubscriptionStatus, listMySubscriptions, requestSubscription };
})();
