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

      // صندوق البحث بالاسم (Places API New) — دفاعيًا: إن فشل، تبقى الخريطة تعمل
      try {
        const placesLib = await google.maps.importLibrary('places');
        const PAC = placesLib.PlaceAutocompleteElement;
        if (PAC) {
          const pac = new PAC({ includedRegionCodes: ['sa'] });
          pac.className = 'locpick__pac';
          searchWrap.appendChild(pac);

          const onSelect = async function (ev) {
            try {
              let place = null;
              if (ev && ev.placePrediction && typeof ev.placePrediction.toPlace === 'function') {
                place = ev.placePrediction.toPlace();
              } else if (ev && ev.place) {
                place = ev.place;
              }
              if (!place) return;
              if (typeof place.fetchFields === 'function') {
                await place.fetchFields({ fields: ['location'] });
              }
              const c = toCoords(place.location);
              if (c) placeMarker(c.lat, c.lng, 17);
            } catch (_) { /* تجاهل خطأ اختيار مكان مفرد */ }
          };
          // أسماء الأحداث اختلفت بين إصدارات المكوّن — نستمع للاثنين
          pac.addEventListener('gmp-select', onSelect);
          pac.addEventListener('gmp-placeselect', onSelect);
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
