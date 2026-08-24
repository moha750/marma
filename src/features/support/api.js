// نداءات جلسة «الدخول نيابةً». كلّها RPC بلا استثناء: جدول support_sessions
// مقروءٌ فقط عبر RLS، وكل تحويلٍ لحالته يمرّ بدالّة تتحقّق من الإذن — فمن يكتب
// فيه مباشرةً يمنح نفسه الوصول.
window.supportApi = (function () {
  const sb = () => window.sb;

  // الجلسة الحيّة كما يراها صاحب الجلسة الحالي (المالك، موظّفه، أو الدعم داخلها).
  // تُرجع null إن لا شيء — وهذه الحال الغالبة، فلا تُعامَل خطأً.
  async function currentSession() {
    const { data, error } = await sb().rpc('support_session_current');
    if (error) throw error;
    return data || null;
  }

  // المالك (أو موظّفه) يفتح الباب. الضغطة نفسها هي الإذن — لا موافقة بعدها.
  async function requestHelp(reason) {
    const { data, error } = await sb().rpc('request_support_help', { p_reason: reason || null });
    if (error) throw error;
    return data;
  }

  // المالك يحسم طلب الدعم
  async function respondToSupport(sessionId, approve) {
    const { error } = await sb().rpc('support_session_respond', {
      p_id: sessionId, p_approve: !!approve
    });
    if (error) throw error;
  }

  // السكّين: بيد المالك وموظّفه وبيد الدعم نفسه
  async function endSession(sessionId) {
    const { error } = await sb().rpc('support_session_end', { p_id: sessionId });
    if (error) throw error;
  }

  // ── جانب المشرف ──
  async function adminRequestSession(tenantId, reason) {
    const { data, error } = await sb().rpc('admin_request_support_session', {
      p_tenant_id: tenantId, p_reason: reason
    });
    if (error) throw error;
    return data;
  }

  async function adminClaimSession(sessionId) {
    const { error } = await sb().rpc('admin_claim_support_session', { p_id: sessionId });
    if (error) throw error;
  }

  async function adminListSessions(tenantId) {
    const { data, error } = await sb().rpc('admin_support_sessions', { p_tenant_id: tenantId });
    if (error) throw error;
    return data || [];
  }

  return {
    currentSession, requestHelp, respondToSupport, endSession,
    adminRequestSession, adminClaimSession, adminListSessions
  };
})();
