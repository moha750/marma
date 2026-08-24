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
  const WALLETS = [
    { key: 'stcpay',    label: 'STC Pay' },
    { key: 'urpay',     label: 'urpay' },
    { key: 'barq',      label: 'برق' },
    { key: 'tiqmo',     label: 'تيقمو' },
    { key: 'alinmapay', label: 'إنماء باي' },
    { key: 'd360',      label: 'D360' }
  ];
  const WALLET_LABELS = WALLETS.reduce((acc, w) => { acc[w.key] = w.label; return acc; }, {});

  // بوابات الدفع: حفظةٌ واحدة للبوّابتين — المالك يحفظ حالةً متّسقة لا نصفها.
  // التحقّق هنا لا في الصفحة: القاعدة ترفض بلغتها، وهذه تردّ بلغة المالك.
  async function updatePaymentGateways({ bank, wallet }) {
    const patch = {};

    if (bank) {
      const iban = normalizeIban(bank.iban);
      if (bank.enabled && !iban) throw new Error('اكتب رقم الأيبان لتشغيل التحويل البنكي');
      if (iban && !isValidIban(iban)) {
        throw new Error('رقم الأيبان غير صحيح — يبدأ بـ SA ويتكوّن من 24 خانة');
      }
      patch.payment_bank_enabled = !!bank.enabled;
      patch.payment_iban = iban || null;
      patch.payment_bank_name = (bank.bank_name || '').trim().slice(0, 60) || null;
    }

    if (wallet) {
      const phone = String(wallet.phone || '').replace(/[\s\u200f\u200e-]/g, '');
      const providers = (wallet.providers || []).filter((k) => WALLET_LABELS[k]);
      if (wallet.enabled && !phone) throw new Error('اكتب رقم الجوال لتشغيل الدفع بالمحفظة');
      if (phone && !/^05[0-9]{8}$/.test(phone)) {
        throw new Error('رقم الجوال يجب أن يبدأ بـ 05 ويتكوّن من 10 أرقام');
      }
      if (wallet.enabled && providers.length === 0) {
        throw new Error('اختر محفظةً واحدة على الأقل يستقبل عليها هذا الرقم');
      }
      patch.payment_wallet_enabled = !!wallet.enabled;
      patch.payment_wallet_phone = phone || null;
      patch.payment_wallets = providers;
    }

    const tenantId = await getMyTenantId();
    const { data, error } = await sb()
      .from('tenants')
      .update(patch)
      .eq('id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return data;
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

  return { getMyTenantId, updateTenant, getMyTenant, uploadTenantCover, removeTenantCover, uploadTenantLogo, removeTenantLogo, normalizeIban, isValidIban,
           updatePaymentGateways, PAYMENT_WALLETS: WALLETS, PAYMENT_WALLET_LABELS: WALLET_LABELS,
           _resetTenantIdCache };
})();
