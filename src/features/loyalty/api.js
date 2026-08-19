// Loyalty API — برنامج الولاء وبطاقاته وقسائمه.
//
// كل الكتابة تمرّ عبر RPCs بـ SECURITY DEFINER (تفرض الملكية وحدود الباقة
// والعتبات)، والقراءة المباشرة محكومة بـ RLS. لا يكتب هذا الملف في جداول
// loyalty_* مباشرةً أبداً — الرصيد يُشتقّ من الدفتر داخل قاعدة البيانات.
//
// أصول البطاقة (شعار/صورة) تُرفع إلى نفس bucket صور الأرضيات بمسار
// ${tenantId}/_loyalty/... فتنطبق عليها سياساته الحالية (أول مجلد = tenant_id).
window.loyaltyApi = (function () {
  const sb = () => window.sb;
  const BUCKET = 'field-images';
  const MAX_BYTES = 5 * 1024 * 1024;
  const EXT_BY_TYPE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

  // ─── البرنامج ────────────────────────────────────────────

  async function getProgram() {
    const { data, error } = await sb().rpc('loyalty_get_program');
    if (error) throw error;
    return data;
  }

  // p: كائن كامل بحقول البرنامج — الخادم يتحقّق من كل قيمة ويولّد التسمية
  async function saveProgram(p) {
    const { data, error } = await sb().rpc('loyalty_upsert_program', { p });
    if (error) throw error;
    return data;
  }

  // ─── البطاقات ────────────────────────────────────────────

  async function listCards({ search = null, limit = 50, offset = 0 } = {}) {
    const { data, error } = await sb().rpc('loyalty_list_cards', {
      p_search: search || null,
      p_limit: limit,
      p_offset: offset
    });
    if (error) throw error;
    return data || [];
  }

  async function cardDetail(cardId) {
    const { data, error } = await sb().rpc('loyalty_card_detail', { p_card_id: cardId });
    if (error) throw error;
    return data;
  }

  async function enroll(customerId) {
    const { data, error } = await sb().rpc('loyalty_enroll', { p_customer_id: customerId });
    if (error) throw error;
    return data;
  }

  // إهداء أختام (للمالك) — موجبٌ فقط، وسببه 'gift' في الدفتر فيُميَّز عن
  // التصحيح في العرض وفي نصّ الإشعار الذي يصل جوال العميل
  async function gift(cardId, delta, note) {
    const { data, error } = await sb().rpc('loyalty_gift', {
      p_card_id: cardId,
      p_delta: delta,
      p_note: note || null
    });
    if (error) throw error;
    return data;
  }

  // تصحيح خطأ (للمالك) — ± يُسجَّل في الدفتر باسم المُنفِّذ
  async function adjust(cardId, delta, note) {
    const { data, error } = await sb().rpc('loyalty_adjust', {
      p_card_id: cardId,
      p_delta: delta,
      p_note: note || null
    });
    if (error) throw error;
    return data;
  }

  // ─── الأختام المعلّقة ────────────────────────────────────
  // اكتمال الحجز يرفع طلباً، ولا يمسّ الرصيد حتى يُحسم من هنا.

  async function pendingStamps(limit) {
    const { data, error } = await sb().rpc('loyalty_pending_stamps_list', {
      p_limit: limit || 100
    });
    if (error) throw error;
    return data || [];
  }

  async function decideStamp(id, approve) {
    const { data, error } = await sb().rpc('loyalty_decide_stamp', {
      p_id: id, p_approve: !!approve
    });
    if (error) throw error;
    return data;
  }

  // ─── القسائم ─────────────────────────────────────────────

  // يقبل حمولة QR كاملة (MRM1:serial:sig) أو الرقم التسلسلي أو بادئته
  async function scanLookup(payload) {
    const { data, error } = await sb().rpc('loyalty_scan_lookup', { p_payload: payload });
    if (error) throw error;
    return data;
  }

  // ربط قسيمة بحجز — يخصم من الفاتورة ويسجّل الأثر المالي
  async function applyReward(code, bookingId, pin) {
    const { data, error } = await sb().rpc('loyalty_apply_reward', {
      p_code: code,
      p_booking_id: bookingId,
      p_pin: pin || null
    });
    if (error) throw error;
    return data;
  }

  async function redeemReward(code, pin) {
    const { data, error } = await sb().rpc('loyalty_redeem', {
      p_code: code,
      p_pin: pin || null
    });
    if (error) throw error;
    return data;
  }

  async function releaseReward(code) {
    const { data, error } = await sb().rpc('loyalty_release_reward', { p_code: code });
    if (error) throw error;
    return data;
  }

  // ─── الأصول البصرية ──────────────────────────────────────

  function _validateImage(file) {
    if (!file) throw new Error('لم يُختَر ملف');
    if (!EXT_BY_TYPE[file.type]) throw new Error('الصيغ المدعومة: JPG أو PNG أو WEBP');
    if (file.size > MAX_BYTES) throw new Error('حجم الصورة يجب ألا يتجاوز 5 ميجابايت');
  }

  // kind: 'logo' | 'hero' | 'icon'
  async function uploadAsset(file, kind) {
    _validateImage(file);
    const tenantId = await window.tenantApi.getMyTenantId();
    const ext = EXT_BY_TYPE[file.type] || 'png';
    const uuid = (crypto.randomUUID && crypto.randomUUID())
      || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const path = `${tenantId}/_loyalty/${kind}-${uuid}.${ext}`;

    const { error } = await sb().storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type
    });
    if (error) throw error;

    const { data: pub } = sb().storage.from(BUCKET).getPublicUrl(path);
    return pub.publicUrl;
  }

  return {
    getProgram, saveProgram,
    listCards, cardDetail, enroll, gift, adjust,
    pendingStamps, decideStamp,
    scanLookup, applyReward, redeemReward, releaseReward,
    uploadLoyaltyAsset: uploadAsset
  };
})();
