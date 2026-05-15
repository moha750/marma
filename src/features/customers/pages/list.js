// قائمة العملاء — KPI صغير + بحث + جدول مع أفعال inline + drawer للإضافة/التعديل
(function () {
  const TEMPLATE = `
    <div class="page-header">
      <div>
        <h2>العملاء</h2>
        <div class="page-subtitle">قاعدة بيانات العملاء وسجلاتهم</div>
      </div>
      <div class="actions">
        <button class="btn btn--primary" id="add-customer-btn">
          <i data-lucide="plus"></i> إضافة عميل
        </button>
      </div>
    </div>

    <div id="kpi-strip" class="stats-grid" style="margin-bottom: var(--space-4)">
      ${skeletonStat()} ${skeletonStat()} ${skeletonStat()}
    </div>

    <div class="search-box mb-md">
      <input type="search" id="search-input" class="form-control" placeholder="ابحث بالاسم أو رقم الجوال…">
    </div>

    <div id="customers-container">
      <div class="loader-center"><div class="loader loader--lg"></div></div>
    </div>
  `;

  function skeletonStat() {
    return `<div class="skeleton-card">
      <div style="display:flex;gap:var(--space-2);align-items:center">
        <div class="skeleton" style="width:28px;height:28px;border-radius:var(--radius-sm)"></div>
        <div class="skeleton skeleton-line" style="width:80px"></div>
      </div>
      <div class="skeleton skeleton-line" style="width:60px;height:22px;margin-top:8px"></div>
    </div>`;
  }

  function renderKpiStrip(customers) {
    const total = customers.length;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const newThisMonth = customers.filter((c) => new Date(c.created_at) >= monthStart).length;

    return `
      <div class="stat-card">
        <div class="stat-card-head">
          <span class="stat-icon-chip"><i data-lucide="users"></i></span>
          <span class="stat-label">إجمالي العملاء</span>
        </div>
        <div class="stat-value">${total}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-head">
          <span class="stat-icon-chip stat-icon-chip--info"><i data-lucide="user-plus"></i></span>
          <span class="stat-label">جدد هذا الشهر</span>
        </div>
        <div class="stat-value">${newThisMonth}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-head">
          <span class="stat-icon-chip stat-icon-chip--accent"><i data-lucide="phone"></i></span>
          <span class="stat-label">يحملون أرقام جوال</span>
        </div>
        <div class="stat-value">${customers.filter((c) => c.phone).length}</div>
      </div>
    `;
  }

  function renderTable(customers, detailsHref) {
    if (!customers.length) {
      return `
        <div class="card">
          <div class="empty-state">
            <div class="empty-icon"><i data-lucide="users"></i></div>
            <h3>لا يوجد عملاء بعد</h3>
            <p>ابدأ بإضافة عميلك الأول لتتبع حجوزاته ومدفوعاته.</p>
          </div>
        </div>
      `;
    }
    return `
      <div class="table-wrapper">
        <table class="table table--sticky-first">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>رقم الجوال</th>
              <th>ملاحظات</th>
              <th>تاريخ الإضافة</th>
              <th class="actions-cell"></th>
            </tr>
          </thead>
          <tbody>
            ${customers.map((c) => `
              <tr data-id="${c.id}">
                <td>
                  <a href="${detailsHref(c.id)}" class="fw-semibold">${window.utils.escapeHtml(c.full_name)}</a>
                </td>
                <td class="tabular-nums">${window.utils.escapeHtml(c.phone || '—')}</td>
                <td class="text-muted">${window.utils.escapeHtml(c.notes ? truncate(c.notes, 40) : '—')}</td>
                <td class="text-tertiary text-xs">${window.utils.formatDate(c.created_at)}</td>
                <td class="actions-cell">
                  <div class="actions-inline">
                    <a href="${detailsHref(c.id)}" class="btn btn--xs btn--ghost" title="تفاصيل">
                      <i data-lucide="external-link"></i>
                    </a>
                    <button class="btn btn--xs btn--ghost" data-action="edit" data-id="${c.id}" title="تعديل">
                      <i data-lucide="pencil"></i>
                    </button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function truncate(str, n) {
    return str.length > n ? str.slice(0, n).trim() + '…' : str;
  }

  function renderEmptySearch(query) {
    return `
      <div class="card">
        <div class="empty-state">
          <div class="empty-icon"><i data-lucide="search-x"></i></div>
          <h3>لا توجد نتائج</h3>
          <p>لم نعثر على عملاء يطابقون "${window.utils.escapeHtml(query)}". جرّب كلمة بحث أخرى.</p>
        </div>
      </div>
    `;
  }

  function openCustomerForm({ customer = null, onSaved }) {
    const editing = !!customer;
    const formHtml = `
      <form id="customer-form" autocomplete="off">
        <div class="form-group">
          <label class="form-label">الاسم الكامل <span class="required">*</span></label>
          <input type="text" class="form-control" name="full_name" required
                 value="${editing ? window.utils.escapeHtml(customer.full_name) : ''}">
        </div>
        <div class="form-group">
          <label class="form-label">رقم الجوال <span class="required">*</span></label>
          <input type="tel" class="form-control" name="phone" required
                 value="${editing ? window.utils.escapeHtml(customer.phone || '') : ''}">
        </div>
        <div class="form-group">
          <label class="form-label">ملاحظات <span class="optional">اختياري</span></label>
          <textarea class="form-control" name="notes" rows="3">${editing ? window.utils.escapeHtml(customer.notes || '') : ''}</textarea>
        </div>
      </form>
    `;
    const footer = `
      <button type="button" class="btn btn--ghost" data-action="cancel">إلغاء</button>
      <button type="submit" class="btn btn--primary" form="customer-form">${editing ? 'حفظ' : 'إضافة'}</button>
    `;
    const ctrl = window.utils.openModal({
      title: editing ? 'تعديل عميل' : 'إضافة عميل جديد',
      body: formHtml,
      footer
    });

    ctrl.modal.querySelector('[data-action="cancel"]').addEventListener('click', ctrl.close);
    ctrl.modal.querySelector('#customer-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        full_name: fd.get('full_name').trim(),
        phone:     fd.get('phone').trim(),
        notes:     fd.get('notes').trim() || null
      };
      try {
        if (editing) {
          await window.api.updateCustomer(customer.id, payload);
          window.utils.toast('تم تحديث العميل', 'success');
        } else {
          await window.api.createCustomer(payload);
          window.utils.toast('تمت إضافة العميل', 'success');
        }
        if (window.store) window.store.invalidate('customers:all');
        ctrl.close();
        if (onSaved) onSaved();
      } catch (err) {
        window.utils.toast(window.utils.formatError(err), 'error');
      }
    });
  }

  const page = {
    async mount(container, ctx) {
      container.innerHTML = TEMPLATE;
      window.utils.renderIcons(container);

      const kpi = container.querySelector('#kpi-strip');
      const listContainer = container.querySelector('#customers-container');
      const searchInput   = container.querySelector('#search-input');
      const addBtn        = container.querySelector('#add-customer-btn');

      const detailsHref = (id) => window.utils.path(`/customers/${encodeURIComponent(id)}`);

      let currentSearch = '';
      let alive = true;
      const cleanup = [];
      page._cleanup = cleanup;

      async function refresh() {
        if (!alive) return;
        try {
          const customers = await window.api.listCustomers(currentSearch);
          if (!alive) return;

          // KPI يبقى مبنياً على الكل دائماً (لا يتأثّر بالبحث)
          if (currentSearch === '') {
            kpi.innerHTML = renderKpiStrip(customers);
          }

          if (currentSearch && !customers.length) {
            listContainer.innerHTML = renderEmptySearch(currentSearch);
          } else {
            listContainer.innerHTML = renderTable(customers, detailsHref);
          }

          listContainer.querySelectorAll('[data-action="edit"]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const customer = customers.find((c) => c.id === btn.dataset.id);
              openCustomerForm({ customer, onSaved: refresh });
            });
          });

          window.utils.renderIcons(container);
        } catch (err) {
          if (!alive) return;
          listContainer.innerHTML = `
            <div class="card">
              <div class="empty-state">
                <div class="empty-icon"><i data-lucide="triangle-alert"></i></div>
                <p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p>
              </div>
            </div>
          `;
          window.utils.renderIcons(container);
        }
      }

      const debouncedSearch = window.utils.debounce(() => {
        currentSearch = searchInput.value;
        refresh();
      }, 300);
      searchInput.addEventListener('input', debouncedSearch);

      const onAdd = () => openCustomerForm({ customer: null, onSaved: refresh });
      addBtn.addEventListener('click', onAdd);

      cleanup.push(() => {
        alive = false;
        searchInput.removeEventListener('input', debouncedSearch);
        addBtn.removeEventListener('click', onAdd);
      });

      if (window.realtime) {
        const debounced = window.utils.debounce(refresh, 400);
        cleanup.push(window.realtime.on('customers:change', debounced));
      }

      refresh();
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages.customers = page;
})();
