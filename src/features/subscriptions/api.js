// Subscriptions API - الخطط والاشتراكات (للمستأجر)

window.subscriptionsApi = (function () {
  const sb = () => window.sb;

  const RECEIPTS_BUCKET   = 'payment-receipts';
  const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;              // 5MB — مطابق لحدّ الـ bucket
  const RECEIPT_EXT_BY_TYPE = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf'
  };

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

  // رفع إيصال الدفع (صورة أو PDF) إلى تخزين خاص، وإرجاع مساره ليُحفظ في قاعدة البيانات.
  // المسار: {tenantId}/{uuid}.{ext} — لتطابق سياسة RLS (المالك يرفع في مجلّد منشأته فقط).
  async function uploadReceipt(file) {
    if (!file) throw new Error('لم يتم اختيار ملف الإيصال');
    const ext = RECEIPT_EXT_BY_TYPE[file.type];
    if (!ext) throw new Error('صيغة غير مدعومة — استخدم صورة (JPG/PNG/WebP) أو ملف PDF');
    if (file.size > MAX_RECEIPT_BYTES) throw new Error('حجم الإيصال يتجاوز 5 ميجابايت');

    const tenantId = await window.tenantApi.getMyTenantId();
    if (!tenantId) throw new Error('تعذّر تحديد المنشأة');

    const uuid = (crypto.randomUUID && crypto.randomUUID())
      || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const path = `${tenantId}/${uuid}.${ext}`;

    const { error } = await sb().storage.from(RECEIPTS_BUCKET).upload(path, file, {
      contentType: file.type, upsert: false
    });
    if (error) throw error;
    return path;
  }

  async function requestSubscription({ plan_id, fields, staff, receipt_path, note, kind }) {
    const { data, error } = await sb().rpc('request_subscription', {
      p_plan_id:      plan_id,
      p_fields:       fields,
      p_staff:        staff,
      p_receipt_path: receipt_path,
      p_note:         note || null,
      p_kind:         kind || 'renew'
    });
    if (error) throw error;
    return data;
  }

  return {
    listPlans, getMySubscriptionStatus, listMySubscriptions,
    requestSubscription, uploadReceipt
  };
})();
