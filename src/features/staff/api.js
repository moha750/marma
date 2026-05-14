// Staff API - الموظفون والدعوات

window.staffApi = (function () {
  const sb = () => window.sb;

  async function listStaff() {
    const { data, error } = await sb()
      .from('profiles')
      .select('id, full_name, role, created_at')
      .order('created_at');
    if (error) throw error;
    return data;
  }

  async function listInvitations() {
    const { data, error } = await sb()
      .from('staff_invitations')
      .select('id, email, full_name, code, expires_at, used_at, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  }

  async function createInvitation({ email, full_name }) {
    const tenantId = await window.tenantApi.getMyTenantId();
    const { data, error } = await sb()
      .from('staff_invitations')
      .insert({ email, full_name, tenant_id: tenantId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function deleteInvitation(id) {
    const { error } = await sb().from('staff_invitations').delete().eq('id', id);
    if (error) throw error;
  }

  async function removeStaff(profileId) {
    const { error } = await sb().from('profiles').delete().eq('id', profileId);
    if (error) throw error;
  }

  // بدون مصادقة (يُستخدم في signup)
  async function getInvitationByCode(code) {
    const { data, error } = await sb().rpc('get_invitation_by_code', { invite_code: code });
    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
  }

  return { listStaff, listInvitations, createInvitation, deleteInvitation, removeStaff, getInvitationByCode };
})();
