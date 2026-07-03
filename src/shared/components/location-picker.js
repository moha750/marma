// مكوّن تحديد موقع الأرضية على خريطة قوقل — بحث بالاسم + دبوس قابل للسحب/النقر.
// يحل محل حقل "رابط الموقع" القديم: بدل لصق رابط، يحدّد المالك المكان بصريًا
// فتُستخرج الإحداثيات مباشرة (lat/lng) بلا أي احتمال فشل.
//
// الاستخدام:
//   const picker = await window.locationPicker.create(containerEl, {
//     lat, lng,            // إحداثيات ابتدائية (اختياري — عند التعديل)
//     city,                // اسم المدينة لتوسيط أولي تقريبي (اختياري)
//     onChange(coordsOrNull) { ... }
//   });
//   picker.getCoords();    // => { lat, lng } أو null
//   picker.destroy();
//
// المفتاح يُقرأ من window.APP_CONFIG.GOOGLE_MAPS_API_KEY. إن غاب أو فشل التحميل،
// يُعرض تنبيه لطيف ويُترك الحفظ ممكنًا بلا إحداثيات (لا يوقف النموذج أبدًا).

window.locationPicker = (function () {
  const SA_CENTER = { lat: 24.7136, lng: 46.6753 }; // الرياض كمركز افتراضي للمملكة
  let _loadPromise = null;

  function apiKey() {
    return (window.APP_CONFIG && window.APP_CONFIG.GOOGLE_MAPS_API_KEY) || '';
  }

  // تحميل كسول لسكربت خرائط قوقل (مرة واحدة على مستوى الصفحة).
  function loadGoogleMaps() {
    if (window.google && window.google.maps && window.google.maps.importLibrary) {
      return Promise.resolve();
    }
    if (_loadPromise) return _loadPromise;
    const key = apiKey();
    if (!key) return Promise.reject(new Error('no_api_key'));

    _loadPromise = new Promise((resolve, reject) => {
      const cbName = '__gmapsReady_' + Date.now();
      window[cbName] = function () { resolve(); try { delete window[cbName]; } catch (_) {} };
      const s = document.createElement('script');
      const params = new URLSearchParams({
        key: key,
        libraries: 'places,marker',
        language: 'ar',
        region: 'SA',
        loading: 'async',
        callback: cbName
      });
      s.src = 'https://maps.googleapis.com/maps/api/js?' + params.toString();
      s.async = true;
      s.onerror = function () { _loadPromise = null; reject(new Error('script_load_failed')); };
      document.head.appendChild(s);
    });
    return _loadPromise;
  }

  // يحوّل موقع قوقل (LatLng أو literal) إلى { lat, lng } أرقامًا
  function toCoords(loc) {
    if (!loc) return null;
    const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
    const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat: lat, lng: lng };
  }

  // تهريب HTML — نتائج البحث تأتي من قوقل، نعرضها كنص لا كـ markup
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // أيقونة الدبوس المصغّرة لعناصر قائمة النتائج (بلون العلامة)
  const PIN_SVG =
    '<svg class="locpick__result-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
    + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0 1 18 0z"></path>'
    + '<circle cx="12" cy="10" r="3"></circle></svg>';

  async function create(container, opts) {
    opts = opts || {};
    const onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};
    const hasInitial = Number.isFinite(opts.lat) && Number.isFinite(opts.lng);
    let coords = hasInitial ? { lat: Number(opts.lat), lng: Number(opts.lng) } : null;

    // هيكل العنصر
    container.innerHTML = ''
      + '<div class="locpick">'
      + '  <div class="locpick__search"></div>'
      + '  <div class="locpick__map"></div>'
      + '  <div class="locpick__hint"></div>'
      + '</div>';
    const searchWrap = container.querySelector('.locpick__search');
    const mapDiv = container.querySelector('.locpick__map');
    const hintEl = container.querySelector('.locpick__hint');

    const setHint = function (text, kind) {
      hintEl.textContent = text || '';
      hintEl.className = 'locpick__hint' + (kind ? ' locpick__hint--' + kind : '');
    };

    // إن لم يوجد مفتاح: لا نُعطّل النموذج — نُظهر تنبيهًا فقط
    if (!apiKey()) {
      setHint('خريطة الموقع غير مُفعّلة حاليًا. يمكنك حفظ الأرضية بدون تحديد الموقع.', 'warn');
      return { getCoords: function () { return coords; }, destroy: function () {} };
    }

    setHint('جارٍ تحميل الخريطة...', null);

    let map = null;
    let marker = null;
    let destroyed = false;
    const listeners = [];

    const emit = function () { onChange(coords ? { lat: coords.lat, lng: coords.lng } : null); };

    const placeMarker = function (lat, lng, zoom) {
      coords = { lat: lat, lng: lng };
      if (!marker) {
        marker = new google.maps.Marker({ map: map, position: coords, draggable: true });
        marker.addListener('dragend', function (e) {
          const c = toCoords(e.latLng);
          if (c) { coords = c; setHint('✓ تم تحديد الموقع', 'ok'); emit(); }
        });
      } else {
        marker.setPosition(coords);
      }
      if (map) {
        map.panTo(coords);
        if (zoom) map.setZoom(zoom);
      }
      setHint('✓ تم تحديد الموقع', 'ok');
      emit();
    };

    try {
      await loadGoogleMaps();
      if (destroyed) return { getCoords: function () { return coords; }, destroy: function () {} };

      const mapsLib = await google.maps.importLibrary('maps');
      const Map = mapsLib.Map;

      map = new Map(mapDiv, {
        center: coords || SA_CENTER,
        zoom: coords ? 16 : 6,
        mapTypeId: 'hybrid',
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        gestureHandling: 'greedy'
      });

      // نقرة على الخريطة تضع/تحرّك الدبوس
      map.addListener('click', function (e) {
        const c = toCoords(e.latLng);
        if (c) placeMarker(c.lat, c.lng);
      });

      if (coords) {
        placeMarker(coords.lat, coords.lng, 16);
        setHint('اسحب الدبوس أو انقر على الخريطة لضبط الموقع.', null);
      } else {
        setHint('ابحث باسم ملعبك، أو انقر على موقعه في الخريطة.', null);
      }

      // ── صندوق بحث مخصّص بهوية مرمى ──
      // نستخدم واجهة AutocompleteSuggestion البرمجية (لا العنصر الجاهز من قوقل)
      // فنرسم الحقل والقائمة بأنفسنا: تحكّم كامل بالشكل، وبلا وضع ملء الشاشة على الجوال.
      // دفاعيًا: إن تعذّر البحث تبقى الخريطة والدبوس يكفيان.
      try {
        const placesLib = await google.maps.importLibrary('places');
        const AutocompleteSuggestion = placesLib.AutocompleteSuggestion;
        const AutocompleteSessionToken = placesLib.AutocompleteSessionToken;
        const canSuggest = AutocompleteSuggestion
          && typeof AutocompleteSuggestion.fetchAutocompleteSuggestions === 'function';

        if (!canSuggest) {
          searchWrap.style.display = 'none';
        } else {
          searchWrap.innerHTML = ''
            + '<div class="locpick__field">'
            + '<svg class="locpick__field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
            + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + '<circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>'
            + '<input type="text" class="form-control locpick__input" placeholder="ابحث باسم ملعبك…"'
            + ' autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false"'
            + ' aria-controls="locpick-results" enterkeyhint="search">'
            + '<button type="button" class="locpick__clear" aria-label="مسح البحث" hidden>'
            + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
            + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>'
            + '</div>'
            + '<ul class="locpick__results" id="locpick-results" role="listbox" hidden></ul>';

          const input = searchWrap.querySelector('.locpick__input');
          const clearBtn = searchWrap.querySelector('.locpick__clear');
          const results = searchWrap.querySelector('.locpick__results');

          let token = new AutocompleteSessionToken();
          let items = [];
          let activeIndex = -1;
          let seq = 0;
          let debounceId = 0;

          const closeResults = function () {
            results.hidden = true;
            input.setAttribute('aria-expanded', 'false');
            input.removeAttribute('aria-activedescendant');
            activeIndex = -1;
          };

          const renderResults = function () {
            if (!items.length) { results.innerHTML = ''; closeResults(); return; }
            results.innerHTML = items.map(function (it, i) {
              return '<li class="locpick__result" role="option" id="locpick-opt-' + i + '" data-i="' + i + '">'
                + PIN_SVG
                + '<span class="locpick__result-text">'
                + '<span class="locpick__result-main">' + escapeHtml(it.main) + '</span>'
                + (it.sub ? '<span class="locpick__result-sub">' + escapeHtml(it.sub) + '</span>' : '')
                + '</span></li>';
            }).join('');
            results.hidden = false;
            input.setAttribute('aria-expanded', 'true');
          };

          const runSearch = async function (q) {
            const mySeq = ++seq;
            try {
              const res = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
                input: q,
                sessionToken: token,
                includedRegionCodes: ['sa'],
                language: 'ar',
                region: 'sa'
              });
              if (mySeq !== seq || destroyed) return; // نتيجة قديمة أو أُتلف المكوّن
              // FormattableText: نفضّل الخاصية .text، ونسقط إلى toString دفاعيًا
              const fmt = function (f) {
                if (!f) return '';
                return typeof f.text === 'string' ? f.text : String(f);
              };
              items = (res.suggestions || [])
                .filter(function (s) { return s.placePrediction; })
                .map(function (s) {
                  const p = s.placePrediction;
                  return {
                    main: fmt(p.mainText) || fmt(p.text),
                    sub: fmt(p.secondaryText),
                    prediction: p
                  };
                });
              activeIndex = -1;
              renderResults();
            } catch (_) {
              if (mySeq === seq) { items = []; closeResults(); }
            }
          };

          const selectIndex = async function (i) {
            const it = items[i];
            if (!it) return;
            input.value = it.main;
            clearBtn.hidden = false;
            closeResults();
            try {
              const place = it.prediction.toPlace();
              await place.fetchFields({ fields: ['location'] });
              const c = toCoords(place.location);
              if (c) placeMarker(c.lat, c.lng, 17);
            } catch (_) { /* تجاهل فشل جلب موقع مفرد */ }
            token = new AutocompleteSessionToken(); // الجلسة تُستهلك بعد الاختيار
          };

          const moveActive = function (dir) {
            const n = items.length;
            if (!n) return;
            activeIndex = (activeIndex + dir + n) % n;
            Array.prototype.forEach.call(results.children, function (li, i) {
              const on = i === activeIndex;
              li.classList.toggle('is-active', on);
              if (on) {
                input.setAttribute('aria-activedescendant', li.id);
                li.scrollIntoView({ block: 'nearest' });
              }
            });
          };

          input.addEventListener('input', function () {
            const q = input.value.trim();
            clearBtn.hidden = !input.value;
            clearTimeout(debounceId);
            if (q.length < 2) { items = []; closeResults(); return; }
            debounceId = setTimeout(function () { runSearch(q); }, 250);
          });

          input.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowDown') {
              if (!results.hidden) { e.preventDefault(); moveActive(1); }
            } else if (e.key === 'ArrowUp') {
              if (!results.hidden) { e.preventDefault(); moveActive(-1); }
            } else if (e.key === 'Enter') {
              if (!results.hidden && items.length) {
                e.preventDefault(); // لا نُرسل النموذج
                selectIndex(activeIndex >= 0 ? activeIndex : 0);
              }
            } else if (e.key === 'Escape') {
              if (!results.hidden) { e.preventDefault(); closeResults(); }
            }
          });

          // mousedown (لا click) حتى لا يُفقد تركيز الحقل قبل تنفيذ الاختيار
          results.addEventListener('mousedown', function (e) {
            const li = e.target.closest ? e.target.closest('.locpick__result') : null;
            if (!li) return;
            e.preventDefault();
            selectIndex(Number(li.getAttribute('data-i')));
          });

          clearBtn.addEventListener('click', function () {
            input.value = '';
            clearBtn.hidden = true;
            items = [];
            closeResults();
            input.focus();
          });

          const onDocDown = function (e) {
            if (!searchWrap.contains(e.target)) closeResults();
          };
          document.addEventListener('mousedown', onDocDown);
          listeners.push(function () { document.removeEventListener('mousedown', onDocDown); });
          listeners.push(function () { clearTimeout(debounceId); });
        }
      } catch (searchErr) {
        // البحث غير متاح (مثلاً Places API New غير مفعّلة) — الخريطة والدبوس يكفيان
        searchWrap.style.display = 'none';
      }
    } catch (err) {
      // فشل تحميل الخريطة كليًا — لا نوقف النموذج
      mapDiv.style.display = 'none';
      searchWrap.style.display = 'none';
      const reason = (err && err.message) === 'no_api_key' ? 'المفتاح غير مضبوط' : 'تعذّر تحميل الخريطة';
      setHint(reason + '. يمكنك حفظ الأرضية بدون تحديد الموقع، أو المحاولة لاحقًا.', 'warn');
    }

    return {
      getCoords: function () { return coords ? { lat: coords.lat, lng: coords.lng } : null; },
      destroy: function () {
        destroyed = true;
        listeners.forEach(function (fn) { try { fn(); } catch (_) {} });
        if (marker) { try { marker.setMap(null); } catch (_) {} marker = null; }
        map = null;
      }
    };
  }

  return { create: create, loadGoogleMaps: loadGoogleMaps };
})();
