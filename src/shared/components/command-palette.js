// Command Palette — بحث ضبابي + إجراءات سريعة (⌘K).
// مصادر النتائج:
//   • التنقل (window.layout.NAV_ITEMS مفلتر حسب الدور)
//   • العملاء (من window.store cache إن وُجد)
//   • إجراءات سريعة قابلة للتمديد
//
// API:
//   window.commandPalette.open()
//   window.commandPalette.close()
//   window.commandPalette.toggle()
//   window.commandPalette.registerAction({ id, title, icon, sub, run, group })
//
// أحداث الكيبورد العالمية: Ctrl/Cmd+K يفتح/يغلق.

window.commandPalette = (function () {
  let backdrop = null;
  let input = null;
  let resultsEl = null;
  let items = [];          // كل العناصر القابلة للفلترة في الجلسة الحالية
  let filtered = [];
  let activeIdx = 0;

  const customActions = [];   // إجراءات سجّلتها صفحات أخرى

  // ─── جمع المصادر ───────────────────────────────────────

  // اشتراك منتهٍ ⇒ العناصر المؤدية لصفحات مقفولة تُعرض كمقفولة وتوجّه للاشتراك.
  function subscriptionLocked() {
    const ctx = (window.layout && window.layout.getContext && window.layout.getContext()) || {};
    return !!(ctx.status && ctx.status.is_active === false);
  }

  function collectNavigation() {
    if (!window.layout || !Array.isArray(window.layout.NAV_ITEMS)) return [];
    const ctx = (window.layout.getContext && window.layout.getContext()) || {};
    const role = ctx.profile && ctx.profile.role;
    const locked = subscriptionLocked();
    return window.layout.NAV_ITEMS
      .filter((it) => !it.ownerOnly || role === 'owner')
      .map((it) => {
        const itemLocked = locked && it.key !== 'subscription';
        return {
          id: `nav:${it.key}`,
          group: 'التنقل',
          title: it.label,
          sub: itemLocked ? 'مقفول — جدّد اشتراكك' : it.path,
          icon: it.icon,
          locked: itemLocked,
          run: () => { if (!itemLocked) navigate(it.path); }
        };
      });
  }

  function collectCustomers() {
    if (!window.store || !window.store.peek) return [];
    const locked = subscriptionLocked();
    const customers = window.store.peek('customers:all') || [];
    return customers.slice(0, 50).map((c) => ({
      id: `cust:${c.id}`,
      group: 'العملاء',
      title: c.full_name || 'عميل بلا اسم',
      sub: locked ? 'مقفول — جدّد اشتراكك' : (c.phone || ''),
      icon: 'user',
      locked,
      run: () => { if (!locked) navigate(`/customers/${c.id}`); }
    }));
  }

  function collectQuickActions() {
    const locked = subscriptionLocked();
    const defaults = [
      {
        id: 'qa:new-booking',
        group: 'إجراءات سريعة',
        title: 'حجز جديد',
        sub: locked ? 'مقفول — جدّد اشتراكك' : 'افتح نموذج حجز جديد',
        icon: 'calendar-plus',
        locked,
        run: () => {
          if (locked) return;
          if (window.bookingModal && window.bookingModal.open) {
            window.bookingModal.open();
          } else {
            navigate('/calendar');
          }
        }
      },
      {
        id: 'qa:new-customer',
        group: 'إجراءات سريعة',
        title: 'إضافة عميل',
        sub: locked ? 'مقفول — جدّد اشتراكك' : 'صفحة العملاء',
        icon: 'user-plus',
        locked,
        run: () => { if (!locked) navigate('/customers'); }
      },
      {
        id: 'qa:toggle-theme',
        group: 'إعدادات',
        title: 'تبديل وضع الألوان',
        sub: 'فاتح / داكن / حسب النظام',
        icon: 'palette',
        run: () => { if (window.themeToggle) window.themeToggle.cycle(); }
      },
      {
        id: 'qa:sign-out',
        group: 'حساب',
        title: 'تسجيل الخروج',
        sub: '',
        icon: 'log-out',
        run: () => { if (window.auth && window.auth.signOut) window.auth.signOut(); }
      }
    ];
    return [...defaults, ...customActions];
  }

  function collectAll() {
    return [
      ...collectNavigation(),
      ...collectCustomers(),
      ...collectQuickActions()
    ];
  }

  function navigate(path) {
    close();
    const full = window.utils ? window.utils.path(path) : path;
    if (window.router && window.router.navigate) {
      window.router.navigate(full);
    } else {
      window.location.href = full;
    }
  }

  // ─── بحث ضبابي بسيط ─────────────────────────────────────
  // نقاط أعلى لمطابقة البداية، ثم مطابقة الكلمات، ثم تسلسل الحروف.

  function score(query, text) {
    if (!query) return 0.1;
    const q = query.trim().toLowerCase();
    const t = (text || '').toLowerCase();
    if (!t) return 0;
    if (t === q) return 1000;
    if (t.startsWith(q)) return 500 - (t.length - q.length);
    const wordStartIdx = t.split(/\s+/).findIndex((w) => w.startsWith(q));
    if (wordStartIdx === 0) return 400;
    if (wordStartIdx > 0) return 300 - wordStartIdx;
    if (t.includes(q)) return 200;
    // تسلسل حروف
    let ti = 0, hits = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const found = t.indexOf(q[qi], ti);
      if (found === -1) return 0;
      hits++;
      ti = found + 1;
    }
    return hits;
  }

  function filterItems(query) {
    if (!query) return items.slice(0, 40);
    return items
      .map((it) => ({ it, s: Math.max(score(query, it.title), score(query, it.sub) * 0.6) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 30)
      .map((x) => x.it);
  }

  // ─── العرض ──────────────────────────────────────────────

  function render() {
    if (!resultsEl) return;

    if (filtered.length === 0) {
      resultsEl.innerHTML = `<div class="palette-empty">لا توجد نتائج</div>`;
      return;
    }

    // قسّم حسب المجموعة، مع الحفاظ على الترتيب
    const groups = [];
    let lastGroup = null;
    filtered.forEach((it, idx) => {
      if (it.group !== lastGroup) {
        groups.push({ label: it.group, items: [] });
        lastGroup = it.group;
      }
      groups[groups.length - 1].items.push({ it, idx });
    });

    resultsEl.innerHTML = groups.map((g) => `
      <div class="palette-section">
        ${g.label ? `<div class="palette-section-label">${escape(g.label)}</div>` : ''}
        ${g.items.map(({ it, idx }) => `
          <button type="button" class="palette-item ${idx === activeIdx ? 'is-active' : ''} ${it.locked ? 'is-locked' : ''}"
                  data-idx="${idx}" data-id="${escape(it.id)}">
            <span class="palette-item-icon"><i data-lucide="${escape(it.icon || 'arrow-right')}"></i></span>
            <span class="palette-item-text">
              <span class="palette-item-title">${escape(it.title)}</span>
              ${it.sub ? `<span class="palette-item-sub">${escape(it.sub)}</span>` : ''}
            </span>
            ${it.locked ? `<span class="palette-item-lock"><i data-lucide="lock"></i></span>` : ''}
          </button>
        `).join('')}
      </div>
    `).join('');

    if (window.utils && window.utils.renderIcons) {
      window.utils.renderIcons(resultsEl);
    }

    // اضمن أن العنصر النشط مرئي
    const activeEl = resultsEl.querySelector('.palette-item.is-active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  // أول عنصر قابل للتحديد (غير مقفول)؛ يرجع 0 إن كانت كلها مقفولة
  function firstSelectable() {
    const i = filtered.findIndex((it) => !it.locked);
    return i === -1 ? 0 : i;
  }

  // ينقل التحديد باتجاه dir (+1/-1) متخطّياً العناصر المقفولة
  function move(dir) {
    if (filtered.length === 0) return;
    let i = activeIdx;
    for (let n = 0; n < filtered.length; n++) {
      i = (i + dir + filtered.length) % filtered.length;
      if (!filtered[i].locked) { activeIdx = i; render(); return; }
    }
    // كلها مقفولة — لا تغيير
  }

  function executeActive() {
    const it = filtered[activeIdx];
    if (!it || it.locked) return;           // المقفول خامل
    if (typeof it.run === 'function') {
      try { it.run(); } catch (e) { console.error(e); }
    }
  }

  // ─── البناء والإغلاق ─────────────────────────────────────

  function build() {
    backdrop = document.createElement('div');
    backdrop.className = 'palette-backdrop';
    backdrop.innerHTML = `
      <div class="palette" role="dialog" aria-label="لوحة الأوامر">
        <div class="palette-input-wrap">
          <i data-lucide="search"></i>
          <input type="text" class="palette-input" placeholder="ابحث عن صفحة، عميل، أو إجراء..." aria-label="بحث" />
        </div>
        <div class="palette-results" role="listbox"></div>
        <div class="palette-footer">
          <span class="kbd-hint"><span class="kbd">↑↓</span> تنقّل</span>
          <span class="kbd-hint"><span class="kbd">Enter</span> اختيار</span>
          <span class="kbd-hint"><span class="kbd">Esc</span> إغلاق</span>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    input = backdrop.querySelector('.palette-input');
    resultsEl = backdrop.querySelector('.palette-results');

    if (window.utils && window.utils.renderIcons) {
      window.utils.renderIcons(backdrop);
    }

    input.addEventListener('input', () => {
      filtered = filterItems(input.value);
      activeIdx = firstSelectable();
      render();
    });

    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); executeActive(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });

    backdrop.addEventListener('click', (e) => {
      const item = e.target.closest('.palette-item');
      if (item) {
        const idx = Number(item.dataset.idx);
        // تجاهل العناصر المقفولة — لا تحديد ولا تنفيذ
        if (!Number.isNaN(idx) && filtered[idx] && !filtered[idx].locked) {
          activeIdx = idx;
          executeActive();
        }
        return;
      }
      if (e.target === backdrop) close();
    });
  }

  function open() {
    if (!backdrop) build();
    items = collectAll();
    filtered = filterItems('');
    activeIdx = firstSelectable();
    input.value = '';
    render();
    requestAnimationFrame(() => {
      backdrop.dataset.open = 'true';
      input.focus();
    });
  }

  function close() {
    if (!backdrop) return;
    backdrop.dataset.open = 'false';
  }

  function toggle() {
    if (!backdrop || backdrop.dataset.open !== 'true') open();
    else close();
  }

  function registerAction(action) {
    if (!action || !action.id || typeof action.run !== 'function') return;
    customActions.push({
      icon: 'zap',
      group: action.group || 'إجراءات سريعة',
      ...action
    });
  }

  // اختصار عالمي
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      toggle();
    }
  });

  function escape(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return { open, close, toggle, registerAction };
})();
