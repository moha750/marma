// متابعة العملاء المحتملين — كل الوصول عبر RPCs محميّة بـ can_access_leads().
// مشتركة بين لوحة المشرف ولوحة المالك: نفس الدوال، والبوّاب في قاعدة البيانات
// لا في الواجهة.

window.leadsApi = (function () {
  const sb = () => window.sb;

  async function rpc(name, params) {
    const { data, error } = await sb().rpc(name, params || {});
    if (error) throw error;
    return data;
  }

  return {
    // هل يظهر التبويب لهذا المستخدم أصلاً؟ (المشرف دائماً، والمالك إن مُنح)
    async canAccess() {
      try {
        return !!(await rpc('leads_can_access'));
      } catch (_) {
        return false;
      }
    },

    listLeads()            { return rpc('leads_list').then((r) => r || []); },
    listNotes(leadId)      { return rpc('lead_notes_list', { p_lead_id: leadId }).then((r) => r || []); },

    createLead(payload) {
      return rpc('lead_create', {
        p_customer_name:  payload.customer_name,
        p_venue_name:     payload.venue_name,
        p_phone:          payload.phone,
        p_source:         payload.source || null,
        p_tenant_id:      payload.tenant_id || null,
        p_next_follow_up: payload.next_follow_up || null
      });
    },

    updateLead(id, payload) {
      return rpc('lead_update', {
        p_lead_id:        id,
        p_customer_name:  payload.customer_name,
        p_venue_name:     payload.venue_name,
        p_phone:          payload.phone,
        p_source:         payload.source || null,
        p_tenant_id:      payload.tenant_id || null,
        p_next_follow_up: payload.next_follow_up || null
      });
    },

    setStatus(id, status, note) {
      return rpc('lead_set_status', { p_lead_id: id, p_status: status, p_note: note || null });
    },

    addNote(id, body)      { return rpc('lead_add_note', { p_lead_id: id, p_body: body }); },
    deleteLead(id)         { return rpc('lead_delete', { p_lead_id: id }); },

    // المشاركة — للمشرف العام وحده (تُرفض في القاعدة لغيره)
    listAccess()           { return rpc('leads_access_list').then((r) => r || []); },
    grantAccess(email)     { return rpc('leads_access_grant', { p_email: email }); },
    revokeAccess(userId)   { return rpc('leads_access_revoke', { p_user_id: userId }); }
  };
})();
