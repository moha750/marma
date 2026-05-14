# دليل إضافة Feature جديد

مثال: إضافة feature "النفقات" (`expenses`) — قائمة + إضافة + حذف.

## الخطوة 1: أنشئ مجلد الـ feature

```
src/features/expenses/
├── api.js
└── pages/
    └── list.js
```

## الخطوة 2: اكتب `api.js`

```js
// src/features/expenses/api.js
window.expensesApi = (function () {
  const sb = () => window.sb;

  async function listExpenses({ from, to } = {}) {
    let q = sb().from('expenses').select('*').order('created_at', { ascending: false });
    if (from) q = q.gte('created_at', from);
    if (to)   q = q.lte('created_at', to);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  async function createExpense({ amount, category, note }) {
    const tenantId = await window.tenantApi.getMyTenantId();
    const { data, error } = await sb()
      .from('expenses')
      .insert({ amount, category, note, tenant_id: tenantId })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function deleteExpense(id) {
    const { error } = await sb().from('expenses').delete().eq('id', id);
    if (error) throw error;
  }

  return { listExpenses, createExpense, deleteExpense };
})();
```

## الخطوة 3: اكتب الـ page module

```js
// src/features/expenses/pages/list.js
(function () {
  const TEMPLATE = `
    <div class="page-header">
      <h2>النفقات</h2>
      <div class="actions">
        <button class="btn btn--primary" id="add-expense-btn">+ إضافة نفقة</button>
      </div>
    </div>
    <div id="expenses-container">
      <div class="loader-center"><div class="loader loader--lg"></div></div>
    </div>
  `;

  const page = {
    async mount(container, ctx) {
      container.innerHTML = TEMPLATE;
      const listEl = container.querySelector('#expenses-container');
      const addBtn = container.querySelector('#add-expense-btn');

      let alive = true;
      const cleanup = [];
      page._cleanup = cleanup;

      async function refresh() {
        if (!alive) return;
        try {
          const rows = await window.api.listExpenses();
          if (!alive) return;
          // render table...
        } catch (err) {
          if (!alive) return;
          listEl.innerHTML = `<div class="card"><div class="empty-state"><p class="text-danger">${window.utils.escapeHtml(window.utils.formatError(err))}</p></div></div>`;
        }
      }

      // wire events
      const onAdd = () => { /* open modal */ };
      addBtn.addEventListener('click', onAdd);
      cleanup.push(() => {
        alive = false;
        addBtn.removeEventListener('click', onAdd);
      });

      // realtime (اختياري)
      if (window.realtime) {
        // افتح قناة في realtime.js لجدول expenses أولاً
      }

      refresh();
    },

    unmount() {
      if (page._cleanup) page._cleanup.forEach((fn) => { try { fn(); } catch (_) {} });
      page._cleanup = null;
    }
  };

  window.pages = window.pages || {};
  window.pages.expenses = page;
})();
```

## الخطوة 4: سجّل الـ route

في `src/app/routes.js`:

```js
window.appRoutes = [
  // ... routes موجودة
  { name: 'expenses', title: 'النفقات', ownerOnly: true }
];
```

## الخطوة 5: أضف العنصر إلى الـ sidebar

في `src/shared/components/layout.js`، عدّل `NAV_ITEMS`:

```js
const NAV_ITEMS = [
  // ... عناصر موجودة
  { key: 'expenses', label: 'النفقات', icon: 'wallet', href: 'expenses.html', route: '#/expenses', ownerOnly: true }
];
```

## الخطوة 6: ضمّ الـ API إلى الـ aggregator

في `src/core/api.js`:

```js
window.api = Object.assign({},
  window.fieldsApi || {},
  // ...
  window.expensesApi || {}      // ← أضف هذا
);
```

(اختياري: أضِف `'expensesApi'` إلى الـ `required` array في نفس الملف ليطبع تحذيراً إن لم يُحمَّل.)

## الخطوة 7: حمّل الـ scripts في `app/index.html`

```html
<!-- بعد باقي feature APIs، قبل aggregator -->
<script src="../src/features/expenses/api.js"></script>

<!-- ... بعد api aggregator وقبل pages الأخرى -->
<script src="../src/features/expenses/pages/list.js"></script>
```

## الخطوة 8 (اختياري): cache + realtime

### Cache
في `src/app/boot.js`:
```js
window.store.define('expenses:recent',
  () => window.api.listExpenses({ from: thirtyDaysAgo }),
  { ttl: 2 * 60 * 1000 }
);
```

### Realtime
في `src/core/realtime.js`، أضف إلى `SUBSCRIPTIONS`:
```js
{
  channel: 'rt-expenses',
  table: 'expenses',
  invalidates: ['expenses:recent'],
  event: 'expenses:change'
}
```

ثم في الـ page module:
```js
if (window.realtime) {
  const debouncedRefresh = window.utils.debounce(refresh, 400);
  cleanup.push(window.realtime.on('expenses:change', debouncedRefresh));
}
```

## الخطوة 9: CSS (إن لزم)

لو الـ feature يحتاج styles خاصة، أنشئ:
```
styles/components/expenses.css
```
ثم أضِف `@import url('./components/expenses.css');` إلى `styles/main.css`.

## الخطوة 10: اختبار

1. افتح `app/index.html`
2. لاحظ ظهور "النفقات" في sidebar (للمالك فقط لأن `ownerOnly: true`)
3. اضغط عليه → يحمّل الصفحة بدون reload
4. اختبر CRUD، realtime، cache

---

## قواعد ذهبية

- **ابتعد عن window.api داخل الـ feature** — استخدم `window.expensesApi` مباشرة. window.api للتوافق فقط.
- **لا تستهلك feature آخر** — إذا احتجت بياناته، عبر `window.<other>Api` (وهذا علامة على أن يجب رفع المنطق إلى shared).
- **alive flag** في كل page module — لمنع كتابة DOM بعد unmount.
- **cleanup array** — كل `addEventListener` و `realtime.on` يجب أن يُلغى في unmount.
- **store invalidation** — بعد كل mutation تؤثر على cache.
