// Fields API - استدعاءات Supabase الخاصة بالأرضيات

window.fieldsApi = (function () {
  const sb = () => window.sb;

  const BUCKET = 'field-images';
  const MAX_BYTES = 5 * 1024 * 1024;
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const EXT_BY_TYPE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const MAX_IMAGES_PER_FIELD = 8;

  async function listFields(includeInactive = true) {
    let q = sb().from('fields').select('*').order('name');
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async function createField({ name, city, phone, location_url, latitude, longitude, image_urls, description, surface_type, amenities }) {
    const tenantId = await window.tenantApi.getMyTenantId();
    const { data, error } = await sb()
      .from('fields')
      .insert({
        name,
        city: city || null,
        phone: phone || null,
        location_url: location_url || null,
        latitude:  (latitude  ?? null),
        longitude: (longitude ?? null),
        image_urls: Array.isArray(image_urls) ? image_urls : [],
        description: description || null,
        surface_type: surface_type || null,
        amenities: Array.isArray(amenities) ? amenities : [],
        tenant_id: tenantId
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function updateField(id, { name, city, phone, location_url, latitude, longitude, is_active, image_urls, description, surface_type, amenities }) {
    const patch = {};
    if (name !== undefined) patch.name = name;
    if (city !== undefined) patch.city = city || null;
    if (phone !== undefined) patch.phone = phone || null;
    if (location_url !== undefined) patch.location_url = location_url || null;
    if (latitude  !== undefined) patch.latitude  = latitude  ?? null;
    if (longitude !== undefined) patch.longitude = longitude ?? null;
    if (is_active !== undefined) patch.is_active = is_active;
    if (image_urls !== undefined) patch.image_urls = Array.isArray(image_urls) ? image_urls : [];
    if (description !== undefined) patch.description = description || null;
    if (surface_type !== undefined) patch.surface_type = surface_type || null;
    if (amenities !== undefined) patch.amenities = Array.isArray(amenities) ? amenities : [];
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

  function _validateImage(file) {
    if (!file) throw new Error('لم يتم اختيار ملف');
    if (!ALLOWED_TYPES.includes(file.type)) {
      throw new Error('نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WebP.');
    }
    if (file.size > MAX_BYTES) {
      throw new Error('حجم الصورة يتجاوز 5 ميجابايت.');
    }
  }

  // helper: get current image_urls for a field (single round-trip read)
  async function _readImageUrls(fieldId) {
    const { data, error } = await sb().from('fields').select('image_urls').eq('id', fieldId).single();
    if (error) throw error;
    return Array.isArray(data?.image_urls) ? data.image_urls : [];
  }

  // helper: extract storage object path from a public URL
  // مثال: https://x.supabase.co/storage/v1/object/public/field-images/tenantId/fieldId/uuid.jpg
  //   →   tenantId/fieldId/uuid.jpg
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

  function listFieldImages(field) {
    return Array.isArray(field?.image_urls) ? field.image_urls : [];
  }

  async function addFieldImage(fieldId, file) {
    _validateImage(file);
    const current = await _readImageUrls(fieldId);
    if (current.length >= MAX_IMAGES_PER_FIELD) {
      throw new Error(`الحد الأقصى ${MAX_IMAGES_PER_FIELD} صور لكل أرضية.`);
    }
    const tenantId = await window.tenantApi.getMyTenantId();
    const ext = EXT_BY_TYPE[file.type] || 'jpg';
    const uuid = (crypto.randomUUID && crypto.randomUUID())
      || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const path = `${tenantId}/${fieldId}/${uuid}.${ext}`;

    const { error: upErr } = await sb().storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type
    });
    if (upErr) throw upErr;

    const { data: pub } = sb().storage.from(BUCKET).getPublicUrl(path);
    const url = pub.publicUrl;
    const next = [...current, url];
    const updated = await updateField(fieldId, { image_urls: next });
    return updated.image_urls;
  }

  async function removeFieldImage(fieldId, url) {
    const current = await _readImageUrls(fieldId);
    const next = current.filter((u) => u !== url);
    const path = _pathFromPublicUrl(url);
    if (path) {
      try { await sb().storage.from(BUCKET).remove([path]); } catch (_) { /* tolerate */ }
    }
    const updated = await updateField(fieldId, { image_urls: next });
    return updated.image_urls;
  }

  async function reorderFieldImages(fieldId, urls) {
    if (!Array.isArray(urls)) throw new Error('urls must be an array');
    const updated = await updateField(fieldId, { image_urls: urls });
    return updated.image_urls;
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

  return {
    listFields, createField, updateField, deleteField,
    listFieldImages, addFieldImage, removeFieldImage, reorderFieldImages,
    MAX_IMAGES_PER_FIELD,
    getAvailableSlots
  };
})();
