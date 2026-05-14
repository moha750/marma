// صفحة العملاء - module pattern (SPA + legacy)
(function () {
  const TEMPLATE = `
    <div class="page-header">
      <h2>العملاء</h2>
      <div class="actions">
        <button class="btn btn--primary" id="add-customer-btn">+ إضافة عميل</button>
      </div>
    </div>

    <div class="search-box mb-md">
      <input type="search" id="search-input" class="form-control" placeholder="ابحث بالاسم أو رقم الجوال...">
    </div>

    <div id="customers-container">
      <div class="loader-center"><div class="loader loader--lg"></div></div>
    </div>
  `;

  const page = {
    async mount(container, ctx) {
      container.innerHTML = TEMPLATE;

      const listContainer = container.querySelector('#customers-container');
      const searchInput = container.querySelector('#search-input');
      const addBtn = container.querySelector('#add-customer-btn');

      let currentSearch = '';
      let alive = true;
      const cleanup = [];
      page._cleanup = cleanup;

      const detailsHref = (id) => `/customers/${encodeURIComponent(id)}`;

      async function refresh() {
        if (!alive) return;
        listContainer.innerHTML = '<div class="loader-center"><div class="loader loader--lg"></div></div>';
        try {
          const customers = await window.api.listCustomers(currentSearch);
          if (!alive) return;

          if (!customers.length) {
            listContainer.innerHTML = `
              <div class="card">
                <div class="empty-state">
                  <div class="icon"><i data-lucide="users"></i></div>
                  <h3>${currentSearch ? 'لا توجد نتائج' : 'لا يوجد عملاء'}</h3>
                  <p>${currentSearch ? 'جرّب كلمة بحث أخرى' : 'ابدأ بإضافة عميلك الأول'}</p>
                </div>
              </div>
            `;
            window.utils.renderIcons(listContainer);
            return;
          }

          listContainer.innerHTML = `
            <div class="table-wrapper">
              <table class="table">
                <thead>
                  <tr>
                    <th>الاسم</th>
                    <th>رقم الجوال</th>
                    <th>ملاحظات</th>
                    <th>تاريخ الإضافة</th>
                    <th class="text-end">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  ${customers.map((c) => `
                    <tr>
                      <td><strong>${window.utils.escapeHtml(c.full_name)}</strong></td>
                      <td>${window.utils.escapeHtml(c.phone)}</td>
                      <td class="text-muted">${window.utils.escapeHtml(c.notes || '—')}</td>
                      <td class="text-muted">${window.utils.formatDate(c.created_at)}</td>
                      <td class="text-end">
                        <div class="actions-cell" style="justify-content:flex-end">
                          <a href="${detailsHref(c.id)}" class="btn btn--ghost btn--sm">تفاصيل</a>
                          <button class="btn btn--secondary btn--sm" data-action="edit" data-id="${c.id}">تعديل</button>
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `;

          listContainer.querySelectorAll('[data-action="edit"]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const customer = customers.find((c) => c.id === btn.dataset.id);
              openCustomerModal(customer);
            });
          });
        } catch (err) {
          if (!alive) return;
          listContainer.innerHTML = `<div class="card"><div class="empty-state"><p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p></div></div>`;
        }
      }

      function openCustomerModal(customer) {
        const editing = !!customer;
        const formHtml = `
          <form id="customer-form" autocomplete="off">
            <div class="form-group">
              <label class="form-label" for="full_name">الاسم الكامل <span class="required">*</span></label>
              <input type="text" class="form-control" id="full_name" name="full_name" required value="${editing ? window.utils.escapeHtml(customer.full_name) : ''}">
            </div>
            <div class="form-group">
              <label class="form-label" for="phone">رقم الجوال <span class="required">*</span></label>
              <input type="tel" class="form-control" id="phone" name="phone" required value="${editing ? window.utils.escapeHtml(customer.phone) : ''}">
            </div>
            <div class="form-group">
              <label class="form-label" for="notes">ملاحظات</label>
              <textarea class="form-control" id="notes" name="notes" rows="3">${editing ? window.utils.escapeHtml(customer.notes || '') : ''}</textarea>
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
            phone: fd.get('phone').trim(),
            notes: fd.get('notes').trim() || null
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
            refresh();
          } catch (err) {
            window.utils.toast(window.utils.formatError(err), 'error');
          }
        });
      }

      const debouncedSearch = window.utils.debounce(() => {
        currentSearch = searchInput.value;
        refresh();
      }, 300);
      searchInput.addEventListener('input', debouncedSearch);

      const onAdd = () => openCustomerModal(null);
      addBtn.addEventListener('click', onAdd);

      cleanup.push(() => {
        alive = false;
        searchInput.removeEventListener('input', debouncedSearch);
        addBtn.removeEventListener('click', onAdd);
      });

      if (window.realtime) {
        const debouncedRefresh = window.utils.debounce(refresh, 400);
        cleanup.push(window.realtime.on('customers:change', debouncedRefresh));
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
