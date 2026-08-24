// Tenant API - بيانات الملعب الحالي + helper لجلب tenant_id

window.tenantApi = (function () {
  const sb = () => window.sb;

  const BUCKET = 'field-images';
  const MAX_BYTES = 5 * 1024 * 1024;
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const EXT_BY_TYPE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

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

  // تطبيع الأيبان: بلا فراغات وبحروف كبيرة. العميل يكتبه منسوخًا من تطبيق بنكه
  // «SA03 8000 ...» — والقيد في القاعدة لا يقبل فراغًا، فنُنقّيه هنا لا نردّه.
  function normalizeIban(value) {
    return String(value || '').replace(/[\s\u200f\u200e-]/g, '').toUpperCase();
  }

  function isValidIban(value) {
    return /^SA[0-9]{22}$/.test(normalizeIban(value));
  }

  // المحافظ المعروفة — نفس مفاتيح القيد في القاعدة. الترتيب ترتيب العرض.
  // بنكا D360 و stc bank ليسا هنا: بنوكٌ مرخّصة لها أيبان، فمكانها «تحويل بنكي».
  const WALLETS = [
    { key: 'stcpay',    label: 'STC Pay' },
    { key: 'urpay',     label: 'urpay' },
    { key: 'barq',      label: 'برق' },
    { key: 'tiqmo',     label: 'تيقمو' },
    { key: 'alinmapay', label: 'إنماء باي' }
  ];
  const WALLET_LABELS = WALLETS.reduce((acc, w) => { acc[w.key] = w.label; return acc; }, {});

  const TABLE = 'tenant_payment_methods';

  function normalizePhone(value) {
    return String(value || '').replace(/[\s\u200f\u200e-]/g, '');
  }

  // من صفٍّ خام إلى صفٍّ صالحٍ للقاعدة — والتحقّق هنا لا في الصفحة: القاعدة
  // ترفض بلغتها، وهذه تردّ بلغة المالك.
  function _preparePaymentMethod(m) {
    const kind = m.kind;
    if (!['bank', 'wallet', 'cash'].includes(kind)) throw new Error('نوع طريقة الدفع غير معروف');

    const row = {
      kind,
      is_active: m.is_active === undefined ? true : !!m.is_active,
      note: (m.note || '').trim().slice(0, 140) || null,
      title: null, iban: null, phone: null, wallets: []
    };
    if (m.display_order !== undefined) row.display_order = m.display_order;

    if (kind === 'bank') {
      const iban = normalizeIban(m.iban);
      if (!iban) throw new Error('اكتب رقم الأيبان');
      if (!isValidIban(iban)) throw new Error('رقم الأيبان غير صحيح — يبدأ بـ SA ويتكوّن من 24 خانة');
      row.iban = iban;
      row.title = (m.title || '').trim().slice(0, 60) || null;
    }

    if (kind === 'wallet') {
      const phone = normalizePhone(m.phone);
      if (!phone) throw new Error('اكتب رقم الجوال');
      if (!/^05[0-9]{8}$/.test(phone)) throw new Error('رقم الجوال يجب أن يبدأ بـ 05 ويتكوّن من 10 أرقام');
      const wallets = (m.wallets || []).filter((k) => WALLET_LABELS[k]);
      if (!wallets.length) throw new Error('اختر محفظةً واحدة على الأقل يستقبل عليها هذا الرقم');
      row.phone = phone;
      row.wallets = wallets;
    }

    return row;
  }

  // 23505 = تكرار: أيبانٌ مكرّر، أو رقمٌ مكرّر، أو «عند الاستلام» مرّتين
  function _paymentError(err, kind) {
    if (err && err.code === '23505') {
      if (kind === 'cash') return new Error('«الدفع عند الاستلام» مُضاف مسبقًا');
      return new Error(kind === 'bank' ? 'هذا الأيبان مُضاف مسبقًا' : 'هذا الرقم مُضاف مسبقًا');
    }
    return err;
  }

  async function listPaymentMethods() {
    const tenantId = await getMyTenantId();
    const { data, error } = await sb()
      .from(TABLE)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function createPaymentMethod(method) {
    const row = _preparePaymentMethod(method);
    row.tenant_id = await getMyTenantId();
    const { data, error } = await sb().from(TABLE).insert(row).select().single();
    if (error) throw _paymentError(error, row.kind);
    return data;
  }

  async function updatePaymentMethod(id, method) {
    const row = _preparePaymentMethod(method);
    const { data, error } = await sb().from(TABLE).update(row).eq('id', id).select().single();
    if (error) throw _paymentError(error, row.kind);
    return data;
  }

  // التشغيل والإطفاء بلا تحقّقٍ من الشكل: الصفّ محفوظٌ صحيحًا أصلًا، وإطفاء
  // طريقةٍ لا يجوز أن يكلّف المالك ملء نموذجٍ من جديد.
  async function setPaymentMethodActive(id, isActive) {
    const { data, error } = await sb()
      .from(TABLE).update({ is_active: !!isActive }).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async function deletePaymentMethod(id) {
    const { error } = await sb().from(TABLE).delete().eq('id', id);
    if (error) throw error;
  }

  // ترتيب العرض عند العميل — يُحفظ كما رتّبه المالك
  async function reorderPaymentMethods(ids) {
    const tenantId = await getMyTenantId();
    await Promise.all(ids.map((id, i) => sb()
      .from(TABLE).update({ display_order: i }).eq('id', id).eq('tenant_id', tenantId)));
  }

  async function updateTenant({ name, description, cover_image_url, logo_url, show_manage_banner }) {
    const tenantId = await getMyTenantId();
    const patch = {};
    if (name !== undefined) patch.name = name;
    if (description !== undefined) patch.description = description || null;
    if (cover_image_url !== undefined) patch.cover_image_url = cover_image_url || null;
    if (logo_url !== undefined) patch.logo_url = logo_url || null;
    if (show_manage_banner !== undefined) patch.show_manage_banner = show_manage_banner;
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

  function _validateImage(file) {
    if (!file) throw new Error('لم يتم اختيار ملف');
    if (!ALLOWED_TYPES.includes(file.type)) {
      throw new Error('نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WebP.');
    }
    if (file.size > MAX_BYTES) {
      throw new Error('حجم الصورة يتجاوز 5 ميجابايت.');
    }
  }

  function _pathFromPublicUrl(url) {
    if (!url) return null;
    const marker = `/${BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx < 0) return null;
    let path = url.slice(idx + marker.length);
    const q = path.indexOf('?');
    if (q >= 0) path = path.slice(0, q);
    return path || null;
  }

  // رفع غلاف المنشأة. المسار: ${tenantId}/_tenant/cover-${uuid}.<ext>
  // يستفيد من سياسات bucket field-images التي تطابق (foldername)[1] = tenant_id::text.
  async function uploadTenantCover(file) {
    _validateImage(file);
    const tenantId = await getMyTenantId();
    const ext = EXT_BY_TYPE[file.type] || 'jpg';
    const uuid = (crypto.randomUUID && crypto.randomUUID())
      || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const path = `${tenantId}/_tenant/cover-${uuid}.${ext}`;

    const { error: upErr } = await sb().storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type
    });
    if (upErr) throw upErr;

    const { data: pub } = sb().storage.from(BUCKET).getPublicUrl(path);
    const url = pub.publicUrl;
    // احذف الغلاف السابق إن وُجد (cleanup)
    try {
      const current = await getMyTenant();
      if (current.cover_image_url) {
        const oldPath = _pathFromPublicUrl(current.cover_image_url);
        if (oldPath && oldPath !== path) {
          try { await sb().storage.from(BUCKET).remove([oldPath]); } catch (_) {}
        }
      }
    } catch (_) {}
    const updated = await updateTenant({ cover_image_url: url });
    return updated.cover_image_url;
  }

  async function removeTenantCover() {
    const current = await getMyTenant();
    const oldUrl = current.cover_image_url;
    if (oldUrl) {
      const oldPath = _pathFromPublicUrl(oldUrl);
      if (oldPath) {
        try { await sb().storage.from(BUCKET).remove([oldPath]); } catch (_) {}
      }
    }
    await updateTenant({ cover_image_url: null });
    return null;
  }

  // رفع شعار المنشأة (مربع). المسار: ${tenantId}/_tenant/logo-${uuid}.<ext>
  // نفس سياسات bucket field-images ((foldername)[1] = tenant_id::text).
  async function uploadTenantLogo(file) {
    _validateImage(file);
    const tenantId = await getMyTenantId();
    const ext = EXT_BY_TYPE[file.type] || 'jpg';
    const uuid = (crypto.randomUUID && crypto.randomUUID())
      || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const path = `${tenantId}/_tenant/logo-${uuid}.${ext}`;

    const { error: upErr } = await sb().storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type
    });
    if (upErr) throw upErr;

    const { data: pub } = sb().storage.from(BUCKET).getPublicUrl(path);
    const url = pub.publicUrl;
    // احذف الشعار السابق إن وُجد (cleanup)
    try {
      const current = await getMyTenant();
      if (current.logo_url) {
        const oldPath = _pathFromPublicUrl(current.logo_url);
        if (oldPath && oldPath !== path) {
          try { await sb().storage.from(BUCKET).remove([oldPath]); } catch (_) {}
        }
      }
    } catch (_) {}
    const updated = await updateTenant({ logo_url: url });
    return updated.logo_url;
  }

  async function removeTenantLogo() {
    const current = await getMyTenant();
    const oldUrl = current.logo_url;
    if (oldUrl) {
      const oldPath = _pathFromPublicUrl(oldUrl);
      if (oldPath) {
        try { await sb().storage.from(BUCKET).remove([oldPath]); } catch (_) {}
      }
    }
    await updateTenant({ logo_url: null });
    return null;
  }

  function _resetTenantIdCache() {
    cachedTenantId = null;
  }

  return { getMyTenantId, updateTenant, getMyTenant, uploadTenantCover, removeTenantCover,
           uploadTenantLogo, removeTenantLogo, normalizeIban, isValidIban,
           listPaymentMethods, createPaymentMethod, updatePaymentMethod,
           setPaymentMethodActive, deletePaymentMethod, reorderPaymentMethods,
           PAYMENT_WALLETS: WALLETS, PAYMENT_WALLET_LABELS: WALLET_LABELS,
           _resetTenantIdCache };
})();
