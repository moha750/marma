// متابعة العملاء المحتملين — دفترٌ واحد بقوقعتين.
//
// نفس الملف يُسجَّل لمسار المشرف (admin-leads) ولمسار المالك (leads): الجدول
// والدرج والأزرار واحدة، والفرق فيما يظهر لا في كيف يُبنى — بطاقة المشاركة
// والحذف للمشرف وحده. وقوقعة كلٍّ منهما تتكفّل بالتخطيط.
(function () {
  // السلسلة مرتّبة عمداً: الترتيب هنا هو ترتيب الرحلة، ومنه تُبنى الشرائح.
  const STATUSES = [
    { key: 'new',        label: 'جديد',        badge: 'badge--muted',   icon: 'circle-dashed' },
    { key: 'contacted',  label: 'تم التواصل',  badge: 'badge--info',    icon: 'phone-outgoing' },
    { key: 'no_answer',  label: 'لا ردّ',       badge: 'badge--warning', icon: 'phone-missed' },
    { key: 'interested', label: 'مهتم',        badge: 'badge--info',    icon: 'thumbs-up' },
    { key: 'trialed',    label: 'جرّب',         badge: 'badge--warning', icon: 'flask-conical' },
    { key: 'subscribed', label: 'اشترك',       badge: 'badge--success', icon: 'circle-check' },
    { key: 'lost',       label: 'غير مهتم',    badge: 'badge--danger',  icon: 'circle-x' }
  ];
  const STATUS_MAP = STATUSES.reduce((acc, s) => { acc[s.key] = s; return acc; }, {});

  // اقتراحاتٌ لا قائمةٌ مغلقة: الخانة تبقى نصاً حرّاً، وهذه أكثر ما يتكرّر
  // فلا يُكتب «قوقل ماب» مرّةً و«خرائط قوقل» مرّةً فيفترق ما هو واحد.
  const SOURCES = [
    'قوقل ماب',
    'إنستقرام',
    'سناب شات',
    'تويتر (X)',
    'تيك توك',
    'واتساب',
    'زيارة ميدانية',
    'توصية عميل',
    'اتصال وارد',
    'معرض أو فعالية',
    'إعلان مموّل',
    'حجز عبر مَرمى'
  ];

  function statusBadge(key) {
    const s = STATUS_MAP[key] || STATUS_MAP.new;
    return `<span class="badge ${s.badge}">${s.label}</span>`;
  }

  function waUrl(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!/^05\d{8}$/.test(digits)) return null;
    return `https://wa.me/966${digits.slice(1)}`;
  }

  function truncate(str, n) {
    const s = String(str || '');
    return s.length > n ? s.slice(0, n).trim() + '…' : s;
  }

  function isOverdue(dateStr) {
    if (!dateStr) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return new Date(dateStr) <= today;
  }

  // ─── القوالب ───────────────────────────────────────────────────────────
  function template(isAdmin) {
    return `
      <div class="page-header">
        <div>
          <h2>متابعة العملاء</h2>
          <div class="page-subtitle">عملاء محتملون — من أول اتصال حتى الاشتراك</div>
        </div>
        <div class="actions">
          ${isAdmin ? `<button class="btn btn--ghost" id="share-btn"><i data-lucide="user-plus"></i> المشاركة</button>` : ''}
          <button class="btn btn--primary" id="add-lead-btn"><i data-lucide="plus"></i> إضافة عميل</button>
        </div>
      </div>

      <div id="kpi-strip" class="stats-grid" style="margin-bottom:var(--space-4)"></div>

      <div class="chip-rail mb-md" id="status-filter" role="tablist">
        <button type="button" class="chip is-active" data-status="">الكل</button>
        ${STATUSES.map((s) => `<button type="button" class="chip" data-status="${s.key}">${s.label}</button>`).join('')}
      </div>

      <div class="search-box mb-md">
        <input type="search" id="search-input" class="form-control" placeholder="ابحث بالاسم أو الملعب أو الجوال…">
      </div>

      <div id="leads-container">
        <div class="loader-center"><div class="loader loader--lg"></div></div>
      </div>
    `;
  }

  function renderKpi(leads) {
    const total      = leads.length;
    const contacted  = leads.filter((l) => l.status !== 'new').length;
    const trialed    = leads.filter((l) => l.trialed_at).length;
    const subscribed = leads.filter((l) => l.status === 'subscribed').length;
    const rate       = total ? Math.round((subscribed / total) * 100) : 0;
    const due        = leads.filter((l) => isOverdue(l.next_follow_up)
                                        && l.status !== 'subscribed' && l.status !== 'lost').length;

    const card = (icon, chip, label, value, sub) => `
      <div class="stat-card">
        <div class="stat-card-head">
          <span class="stat-icon-chip${chip ? ' stat-icon-chip--' + chip : ''}"><i data-lucide="${icon}"></i></span>
          <span class="stat-label">${label}</span>
        </div>
        <div class="stat-value tabular-nums">${value}</div>
        ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
      </div>`;

    return [
      card('users', '', 'إجمالي المتابعة', total, `${contacted} تم التواصل معهم`),
      card('flask-conical', 'info', 'جرّبوا', trialed, ''),
      card('circle-check', 'accent', 'اشتركوا', subscribed, `معدّل التحويل ${rate}%`),
      card('alarm-clock', 'warning', 'متابعة مستحقّة', due, due ? 'اليوم أو متأخّرة' : 'لا شيء مستحق')
    ].join('');
  }

  function renderTable(leads, isAdmin) {
    if (!leads.length) {
      return `
        <div class="card">
          <div class="empty-state">
            <div class="empty-icon"><i data-lucide="user-search"></i></div>
            <h3>لا يوجد عملاء في المتابعة</h3>
            <p>أضف أول عميل محتمل: اسم الملعب ورقم التواصل — والاسم متى عرفته.</p>
          </div>
        </div>`;
    }
    return `
      <div class="table-wrapper">
        <table class="table table--cards">
          <thead>
            <tr>
              <th>الملعب</th>
              <th>العميل</th>
              <th>الجوال</th>
              <th>الحالة</th>
              <th>آخر تواصل</th>
              <th>المتابعة القادمة</th>
              <th class="actions-cell"></th>
            </tr>
          </thead>
          <tbody>
            ${leads.map((l) => {
              const wa = waUrl(l.phone);
              const overdue = isOverdue(l.next_follow_up) && l.status !== 'subscribed' && l.status !== 'lost';
              return `
              <tr data-id="${l.id}">
                <td data-label="الملعب">
                  <button type="button" class="lead-link fw-semibold" data-action="open" data-id="${l.id}">
                    ${window.utils.escapeHtml(l.venue_name)}
                  </button>
                  ${l.tenant_id ? '<span class="badge badge--success lead-venue-tag" title="مربوط بملعب مسجّل">مسجّل</span>' : ''}
                  ${l.last_note ? `<div class="text-tertiary text-xs">${window.utils.escapeHtml(truncate(l.last_note, 45))}</div>` : ''}
                </td>
                <td data-label="العميل">
                  ${l.customer_name
                    ? window.utils.escapeHtml(l.customer_name)
                    : '<span class="text-tertiary">لم يُعرف بعد</span>'}
                </td>
                <td data-label="الجوال" class="tabular-nums" dir="ltr">${window.utils.escapeHtml(l.phone)}</td>
                <td data-label="الحالة">${statusBadge(l.status)}</td>
                <td data-label="آخر تواصل" class="text-tertiary text-xs">
                  ${l.last_contact_at ? window.utils.timeAgo(l.last_contact_at) : '—'}
                </td>
                <td data-label="المتابعة القادمة" class="text-xs${overdue ? ' text-danger fw-semibold' : ' text-tertiary'}">
                  ${l.next_follow_up ? window.utils.formatDate(l.next_follow_up) : '—'}
                </td>
                <td class="actions-cell">
                  <div class="actions-inline">
                    ${wa ? `<a class="btn btn--xs btn--ghost" href="${wa}" target="_blank" rel="noopener" title="واتساب">
                      <i data-lucide="message-circle"></i><span class="btn-label">واتساب</span></a>` : ''}
                    <a class="btn btn--xs btn--ghost" href="tel:${window.utils.escapeHtml(l.phone)}" title="اتصال">
                      <i data-lucide="phone"></i><span class="btn-label">اتصال</span></a>
                    <button class="btn btn--xs btn--ghost" data-action="open" data-id="${l.id}" title="المتابعة">
                      <i data-lucide="list"></i><span class="btn-label">المتابعة</span></button>
                    ${isAdmin ? `<button class="btn btn--xs btn--ghost text-danger" data-action="delete" data-id="${l.id}" title="حذف">
                      <i data-lucide="trash-2"></i><span class="btn-label">حذف</span></button>` : ''}
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // ─── نموذج الإضافة/التعديل ─────────────────────────────────────────────
  function openLeadForm({ lead = null, tenants = [], onSaved }) {
    const editing = !!lead;
    const body = `
      <form id="lead-form" autocomplete="off">
        <div class="form-group">
          <label class="form-label">اسم الملعب <span class="required">*</span></label>
          <input type="text" class="form-control" name="venue_name" required list="lead-venues"
                 value="${editing ? window.utils.escapeHtml(lead.venue_name) : ''}">
          <datalist id="lead-venues">
            ${tenants.map((t) => `<option value="${window.utils.escapeHtml(t.name)}"></option>`).join('')}
          </datalist>
          <span class="form-help">اكتب أي اسم — وإن كان الملعب مسجّلاً عندنا اختره من القائمة ليُربط تلقائياً.</span>
        </div>
        <div class="form-group">
          <label class="form-label">اسم العميل <span class="optional">اختياري</span></label>
          <input type="text" class="form-control" name="customer_name"
                 value="${editing ? window.utils.escapeHtml(lead.customer_name || '') : ''}">
          <span class="form-help">اتركه فارغاً إن لم تعرفه بعد — يُعرف غالباً في أول مكالمة.</span>
        </div>
        <div class="form-group">
          <label class="form-label">رقم التواصل <span class="required">*</span></label>
          <input type="tel" class="form-control" name="phone" required dir="ltr" placeholder="05XXXXXXXX"
                 value="${editing ? window.utils.escapeHtml(lead.phone) : ''}">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">المصدر <span class="optional">اختياري</span></label>
            <input type="text" class="form-control" name="source" list="lead-sources"
                   placeholder="من أين وصلك هذا الملعب؟"
                   value="${editing ? window.utils.escapeHtml(lead.source || '') : ''}">
            <datalist id="lead-sources">
              ${SOURCES.map((s) => `<option value="${window.utils.escapeHtml(s)}"></option>`).join('')}
            </datalist>
            <span class="form-help">اختر من القائمة أو اكتب مصدراً آخر.</span>
          </div>
          <div class="form-group">
            <label class="form-label">موعد المتابعة القادمة <span class="optional">اختياري</span></label>
            <input type="date" class="form-control" name="next_follow_up"
                   value="${editing && lead.next_follow_up ? lead.next_follow_up : ''}">
            <span class="form-help">متى تعاود الاتصال؟ متى حلّ اليوم يُعدّ في «متابعة مستحقّة» ويصير التاريخ أحمر.</span>
          </div>
        </div>
      </form>`;

    const footer = `
      <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
      <button type="submit" class="btn btn--primary" form="lead-form">${editing ? 'حفظ' : 'إضافة'}</button>`;

    const ctrl = window.utils.openModal({
      title: editing ? 'تعديل عميل' : 'إضافة عميل محتمل',
      body, footer
    });

    ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
    const phoneInput = ctrl.modal.querySelector('input[name="phone"]');
    window.utils.bindPhoneInput(phoneInput);

    ctrl.modal.querySelector('#lead-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const phone = String(fd.get('phone') || '').trim();
      if (!window.utils.isValidSaudiPhone(phone)) {
        window.utils.toast('رقم الجوال يجب أن يبدأ بـ 05 ويتكون من 10 أرقام', 'error');
        phoneInput.focus();
        return;
      }
      const venueName = String(fd.get('venue_name') || '').trim();
      // الربط يُشتقّ من التطابق التامّ مع اسم ملعب مسجّل — لا حقل ثانٍ يملؤه المستخدم.
      const matched = tenants.find((t) => t.name && t.name.trim() === venueName);
      const payload = {
        customer_name:  String(fd.get('customer_name') || '').trim() || null,
        venue_name:     venueName,
        phone,
        source:         String(fd.get('source') || '').trim() || null,
        tenant_id:      matched ? matched.id : (editing ? lead.tenant_id : null),
        next_follow_up: String(fd.get('next_follow_up') || '') || null
      };
      const btn = ctrl.modal.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        if (editing) await window.leadsApi.updateLead(lead.id, payload);
        else         await window.leadsApi.createLead(payload);
        window.utils.toast(editing ? 'تم الحفظ' : 'تمت الإضافة', 'success');
        ctrl.close();
        if (onSaved) onSaved();
      } catch (err) {
        btn.disabled = false;
        window.utils.toast(window.utils.formatError(err), 'error');
      }
    });
  }

  // ─── درج المتابعة ──────────────────────────────────────────────────────
  function openLeadDrawer({ lead, tenants, onChanged }) {
    const wa = waUrl(lead.phone);
    const body = `
      <div class="drawer-section">
        <div class="lead-facts">
          <div class="lead-fact"><span class="lead-fact-label">العميل</span><span class="lead-fact-value">${lead.customer_name ? window.utils.escapeHtml(lead.customer_name) : '<span class="text-tertiary">لم يُعرف بعد</span>'}</span></div>
          <div class="lead-fact"><span class="lead-fact-label">الجوال</span><span class="lead-fact-value tabular-nums" dir="ltr">${window.utils.escapeHtml(lead.phone)}</span></div>
          <div class="lead-fact"><span class="lead-fact-label">المصدر</span><span class="lead-fact-value">${window.utils.escapeHtml(lead.source || '—')}</span></div>
          <div class="lead-fact"><span class="lead-fact-label">المتابعة القادمة</span><span class="lead-fact-value">${lead.next_follow_up ? window.utils.formatDate(lead.next_follow_up) : '—'}</span></div>
          <div class="lead-fact"><span class="lead-fact-label">أضافه</span><span class="lead-fact-value">${window.utils.escapeHtml(lead.created_by_name || '—')}</span></div>
          <div class="lead-fact"><span class="lead-fact-label">أُضيف</span><span class="lead-fact-value">${window.utils.formatDate(lead.created_at)}</span></div>
        </div>
        <div class="actions-inline mt-md">
          ${wa ? `<a class="btn btn--sm btn--ghost" href="${wa}" target="_blank" rel="noopener"><i data-lucide="message-circle"></i> واتساب</a>` : ''}
          <a class="btn btn--sm btn--ghost" href="tel:${window.utils.escapeHtml(lead.phone)}"><i data-lucide="phone"></i> اتصال</a>
          <button type="button" class="btn btn--sm btn--ghost" data-action="edit"><i data-lucide="pencil"></i> تعديل البيانات</button>
        </div>
      </div>

      <div class="drawer-section">
        <h4 class="drawer-section-title">الحالة</h4>
        <div class="chip-rail" id="status-picker">
          ${STATUSES.map((s) => `
            <button type="button" class="chip${s.key === lead.status ? ' is-active' : ''}" data-set-status="${s.key}">
              <i data-lucide="${s.icon}"></i> ${s.label}
            </button>`).join('')}
        </div>
      </div>

      <div class="drawer-section">
        <h4 class="drawer-section-title">ملاحظة جديدة</h4>
        <form id="note-form">
          <textarea class="form-control" name="body" rows="2" placeholder="ماذا دار في التواصل؟"></textarea>
          <div class="actions-inline mt-sm">
            <button type="submit" class="btn btn--sm btn--primary"><i data-lucide="plus"></i> أضف الملاحظة</button>
          </div>
        </form>
      </div>

      <div class="drawer-section">
        <h4 class="drawer-section-title">الخطّ الزمني</h4>
        <div id="notes-timeline"><div class="loader-center"><div class="loader"></div></div></div>
      </div>`;

    // ما تغيّر في الدرج يُنعش الجدول عند الإغلاق — لا عند كل ضغطة، فالقائمة
    // خلفه لا تُقرأ وهو مفتوح. و onClose يمسك كل أبواب الخروج: الزر
    // والـ backdrop و Escape وزرّ الرجوع في أندرويد.
    let dirty = false;
    // الملعب هو العنوان: هو ما يُعرف أولاً وقد يبقى وحده.
    const ctrl = window.drawer.open({
      title: lead.venue_name,
      subtitle: lead.customer_name || lead.phone,
      size: 'md',
      body,
      onClose: () => { if (dirty && onChanged) onChanged(); }
    });
    window.utils.renderIcons(ctrl.drawer);

    const timelineEl = ctrl.drawer.querySelector('#notes-timeline');

    async function loadNotes() {
      try {
        const notes = await window.leadsApi.listNotes(lead.id);
        if (!notes.length) {
          timelineEl.innerHTML = '<p class="text-tertiary text-sm">لا شيء بعد — أول ملاحظةٍ تبدأ القصّة.</p>';
          return;
        }
        timelineEl.innerHTML = `
          <div class="timeline-list">
            ${notes.map((n) => {
              const isStatus = n.kind === 'status';
              const to = isStatus && n.meta ? STATUS_MAP[n.meta.to] : null;
              return `
                <div class="timeline-row timeline-row--compact">
                  <div class="timeline-main">
                    <div class="timeline-customer">
                      ${isStatus
                        ? `صار: ${to ? statusBadge(n.meta.to) : ''}`
                        : window.utils.escapeHtml(n.body || '')}
                    </div>
                    ${isStatus && n.body ? `<div class="text-secondary text-sm">${window.utils.escapeHtml(n.body)}</div>` : ''}
                    <div class="timeline-field">${window.utils.escapeHtml(n.author_name || '—')} · ${window.utils.timeAgo(n.created_at)}</div>
                  </div>
                </div>`;
            }).join('')}
          </div>`;
      } catch (err) {
        timelineEl.innerHTML = `<p class="text-danger text-sm">${window.utils.escapeHtml(window.utils.formatError(err))}</p>`;
      }
    }
    loadNotes();

    // الحالة والملاحظة معاً: ما في المربّع وقت الضغط يُسجَّل مع الانتقال.
    ctrl.drawer.querySelectorAll('[data-set-status]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const next = btn.dataset.setStatus;
        const noteEl = ctrl.drawer.querySelector('#note-form textarea');
        const note = noteEl.value.trim();
        ctrl.drawer.querySelectorAll('[data-set-status]').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        try {
          await window.leadsApi.setStatus(lead.id, next, note || null);
          lead.status = next;
          noteEl.value = '';
          dirty = true;
          window.utils.toast('تم تحديث الحالة', 'success');
          await loadNotes();
        } catch (err) {
          window.utils.toast(window.utils.formatError(err), 'error');
        }
      });
    });

    ctrl.drawer.querySelector('#note-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const el = e.target.querySelector('textarea');
      const value = el.value.trim();
      if (!value) return;
      try {
        await window.leadsApi.addNote(lead.id, value);
        el.value = '';
        dirty = true;
        await loadNotes();
      } catch (err) {
        window.utils.toast(window.utils.formatError(err), 'error');
      }
    });

    ctrl.drawer.querySelector('[data-action="edit"]').addEventListener('click', () => {
      ctrl.close();
      openLeadForm({ lead, tenants, onSaved: onChanged });
    });
  }

  // ─── بطاقة المشاركة (المشرف وحده) ──────────────────────────────────────
  function openShareDrawer() {
    const ctrl = window.drawer.open({
      title: 'مشاركة دفتر المتابعة',
      subtitle: 'مَن يراه غير المشرفين',
      size: 'md',
      body: `
        <div class="drawer-section">
          <p class="text-secondary text-sm">
            مَن تمنحه الوصول يرى <strong>كل</strong> العملاء في الدفتر بأسمائهم وأرقامهم وملاحظاتهم،
            ويستطيع تحديث الحالة وإضافة ملاحظة — ولا يحذف ولا يمنح غيره. والسحب فوريّ.
          </p>
          <form id="grant-form" class="cal-subbar" style="margin:var(--space-3) 0 0">
            <input type="email" class="form-control" name="email" required placeholder="بريد مالك الملعب (يجب أن يملك حساباً)">
            <button type="submit" class="btn btn--primary btn--sm"><i data-lucide="user-plus"></i> منح الوصول</button>
          </form>
        </div>
        <div class="drawer-section">
          <h4 class="drawer-section-title">مَن يملك الوصول</h4>
          <div id="access-list"><div class="loader-center"><div class="loader"></div></div></div>
        </div>`
    });
    window.utils.renderIcons(ctrl.drawer);
    const listEl = ctrl.drawer.querySelector('#access-list');

    async function load() {
      try {
        const rows = await window.leadsApi.listAccess();
        if (!rows.length) {
          listEl.innerHTML = '<p class="text-tertiary text-sm">لم تُشارك الدفتر مع أحد بعد.</p>';
          return;
        }
        listEl.innerHTML = `
          <div class="table-wrapper">
            <table class="table table--cards">
              <thead><tr><th>الشخص</th><th>الملعب</th><th>مُنح</th><th class="actions-cell"></th></tr></thead>
              <tbody>
                ${rows.map((r) => `
                  <tr>
                    <td data-label="الشخص">
                      <div class="fw-semibold">${window.utils.escapeHtml(r.name || '—')}</div>
                      <div class="text-tertiary text-xs">${window.utils.escapeHtml(r.email || '')}</div>
                    </td>
                    <td data-label="الملعب">${window.utils.escapeHtml(r.tenant_name || '—')}</td>
                    <td data-label="مُنح" class="text-tertiary text-xs">${window.utils.formatDate(r.created_at)}</td>
                    <td class="actions-cell">
                      <button class="btn btn--xs btn--danger" data-revoke="${r.user_id}"
                              data-name="${window.utils.escapeHtml(r.email || r.name || '')}">سحب</button>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`;
        listEl.querySelectorAll('[data-revoke]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const ok = await window.utils.confirm({
              title: 'سحب الوصول',
              message: `سحب وصول "${btn.dataset.name}" إلى دفتر المتابعة؟`,
              confirmText: 'سحب', danger: true
            });
            if (!ok) return;
            try {
              await window.leadsApi.revokeAccess(btn.dataset.revoke);
              window.utils.toast('تم السحب', 'success');
              await load();
            } catch (err) {
              window.utils.toast(window.utils.formatError(err), 'error');
            }
          });
        });
      } catch (err) {
        listEl.innerHTML = `<p class="text-danger text-sm">${window.utils.escapeHtml(window.utils.formatError(err))}</p>`;
      }
    }
    load();

    ctrl.drawer.querySelector('#grant-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = e.target.querySelector('input[name="email"]');
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await window.leadsApi.grantAccess(input.value.trim());
        input.value = '';
        window.utils.toast('تم منح الوصول', 'success');
        await load();
      } catch (err) {
        window.utils.toast(window.utils.formatError(err), 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ─── الصفحة ────────────────────────────────────────────────────────────
  const page = {
    async mount(container, ctx) {
      const isAdmin = !!(ctx && ctx.isSuperAdmin);
      container.innerHTML = template(isAdmin);
      window.utils.renderIcons(container);

      const kpiEl      = container.querySelector('#kpi-strip');
      const listEl     = container.querySelector('#leads-container');
      const searchEl   = container.querySelector('#search-input');
      const filterEl   = container.querySelector('#status-filter');
      const addBtn     = container.querySelector('#add-lead-btn');
      const shareBtn   = container.querySelector('#share-btn');

      let alive = true;
      let allLeads = [];
      let tenants = [];
      let currentStatus = '';
      let currentSearch = '';
      page._cleanup = [() => { alive = false; }];

      // قائمة الملاعب المسجّلة تخدم الربط التلقائي — وهي للمشرف وحده (RPC مشرف).
      if (isAdmin && window.adminApi) {
        window.adminApi.adminListTenants()
          .then((rows) => { tenants = (rows || []).map((t) => ({ id: t.id, name: t.name })); })
          .catch(() => {});
      }

      function visible() {
        const q = currentSearch.trim().toLowerCase();
        return allLeads.filter((l) => {
          if (currentStatus && l.status !== currentStatus) return false;
          if (!q) return true;
          return [l.customer_name, l.venue_name, l.phone, l.source]
            .some((v) => String(v || '').toLowerCase().includes(q));
        });
      }

      function paint() {
        // الـ KPI على الكل دائماً — الشرائح والبحث يضيّقان الجدول لا الصورة.
        kpiEl.innerHTML = renderKpi(allLeads);
        listEl.innerHTML = renderTable(visible(), isAdmin);
        window.utils.renderIcons(container);

        listEl.querySelectorAll('[data-action="open"]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const lead = allLeads.find((l) => l.id === btn.dataset.id);
            if (lead) openLeadDrawer({ lead, tenants, onChanged: refresh });
          });
        });

        listEl.querySelectorAll('[data-action="delete"]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const lead = allLeads.find((l) => l.id === btn.dataset.id);
            const ok = await window.utils.confirm({
              title: 'حذف من المتابعة',
              message: `حذف "${lead ? (lead.customer_name || lead.venue_name) : ''}" وكل ملاحظاته؟ لا يمكن التراجع.`,
              confirmText: 'حذف', danger: true
            });
            if (!ok) return;
            try {
              await window.leadsApi.deleteLead(btn.dataset.id);
              window.utils.toast('تم الحذف', 'success');
              await refresh();
            } catch (err) {
              window.utils.toast(window.utils.formatError(err), 'error');
            }
          });
        });
      }

      async function refresh() {
        try {
          const rows = await window.leadsApi.listLeads();
          if (!alive) return;
          allLeads = rows || [];
          paint();
        } catch (err) {
          if (!alive) return;
          listEl.innerHTML = `
            <div class="card">
              <div class="empty-state">
                <div class="empty-icon"><i data-lucide="triangle-alert"></i></div>
                <p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p>
              </div>
            </div>`;
          window.utils.renderIcons(container);
        }
      }

      filterEl.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-status]');
        if (!chip) return;
        filterEl.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        currentStatus = chip.dataset.status;
        paint();
      });

      const onSearch = window.utils.debounce(() => { currentSearch = searchEl.value; paint(); }, 200);
      searchEl.addEventListener('input', onSearch);

      addBtn.addEventListener('click', () => openLeadForm({ tenants, onSaved: refresh }));
      if (shareBtn) shareBtn.addEventListener('click', openShareDrawer);

      await refresh();
    },

    unmount() {
      (page._cleanup || []).forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = [];
    }
  };

  window.pages = window.pages || {};
  window.pages['leads'] = page;        // لوحة المالك — /leads
  window.pages['admin-leads'] = page;  // لوحة المشرف — /admin/leads
})();
