// Shared ground picker: pick a saved ground, or add a new one (name + optional GPS fix).
//   var gp = GroundPicker.mount(el, { value: id, onChange: function(id){} });
//   gp.getValue() / gp.setValue(id) / gp.reload()
(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function mapsUrl(g) {
    return 'https://www.google.com/maps?q=' + g.latitude + ',' + g.longitude;
  }

  function mount(el, opts) {
    opts = opts || {};
    var grounds = [];
    var value = opts.value || '';
    var coords = null;

    el.classList.add('gp');
    el.innerHTML =
      '<select class="gp-select" aria-label="Ground"></select>' +
      '<a class="gp-map" target="_blank" rel="noopener" hidden>📍 Open in Maps ↗</a>' +
      '<div class="gp-new" hidden>' +
        '<input class="gp-name" type="text" maxlength="80" placeholder="Ground name, e.g. Oval Park" autocomplete="off">' +
        '<div class="gp-row"><button type="button" class="gp-btn gp-geo">📍 Use my location</button><span class="gp-coords"></span></div>' +
        '<div class="gp-row"><button type="button" class="gp-btn gp-save">Save ground</button><button type="button" class="gp-btn gp-cancel">Cancel</button></div>' +
      '</div>';

    var sel = el.querySelector('.gp-select');
    var mapLink = el.querySelector('.gp-map');
    var form = el.querySelector('.gp-new');
    var nameIn = el.querySelector('.gp-name');
    var coordsEl = el.querySelector('.gp-coords');
    var geoBtn = el.querySelector('.gp-geo');

    function findGround(id) {
      return grounds.find(function (g) { return g.id === id; });
    }

    function render() {
      sel.innerHTML = '<option value="">— No ground —</option>' +
        grounds.map(function (g) { return '<option value="' + esc(g.id) + '">' + esc(g.name) + '</option>'; }).join('') +
        '<option value="__new__">＋ Add new ground…</option>';
      sel.value = findGround(value) ? value : '';
      var g = findGround(sel.value);
      mapLink.hidden = !(g && g.latitude != null && g.longitude != null);
      if (!mapLink.hidden) mapLink.href = mapsUrl(g);
    }

    function setValue(id, silent) {
      value = id || '';
      render();
      if (!silent && opts.onChange) opts.onChange(value);
    }

    function reload() {
      return fetch('/api/grounds')
        .then(function (r) { return r.ok ? r.json() : []; })
        .catch(function () { return []; })
        .then(function (rows) { grounds = rows; render(); });
    }

    function closeForm() {
      form.hidden = true;
      nameIn.value = '';
      coords = null;
      coordsEl.textContent = '';
      render();
    }

    sel.addEventListener('change', function () {
      if (sel.value === '__new__') {
        form.hidden = false;
        sel.value = findGround(value) ? value : '';
        nameIn.focus();
        return;
      }
      setValue(sel.value);
    });

    geoBtn.addEventListener('click', function () {
      if (!navigator.geolocation) { coordsEl.textContent = 'Location not supported on this device'; return; }
      coordsEl.textContent = 'Locating…';
      navigator.geolocation.getCurrentPosition(function (pos) {
        coords = { lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6) };
        coordsEl.textContent = coords.lat + ', ' + coords.lng + ' ✓';
      }, function (err) {
        coords = null;
        coordsEl.textContent = err.code === 1 ? 'Location blocked — you can still save the name' : 'Could not get location';
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    });

    el.querySelector('.gp-cancel').addEventListener('click', closeForm);

    el.querySelector('.gp-save').addEventListener('click', function () {
      var name = nameIn.value.trim();
      if (!name) { nameIn.focus(); return; }
      var body = { name: name };
      if (coords) { body.latitude = coords.lat; body.longitude = coords.lng; }
      fetch('/api/grounds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.detail || r.statusText); return j; }); })
        .then(function (g) {
          if (!findGround(g.id)) {
            grounds.push(g);
            grounds.sort(function (a, b) { return a.name.localeCompare(b.name); });
          } else {
            grounds = grounds.map(function (x) { return x.id === g.id ? g : x; });
          }
          form.hidden = true; nameIn.value = ''; coords = null; coordsEl.textContent = '';
          setValue(g.id);
        })
        .catch(function (e) { coordsEl.textContent = e.message || 'Could not save ground'; });
    });

    render();
    reload();

    return {
      getValue: function () { return value; },
      setValue: function (id) { setValue(id, true); if (id && !findGround(id)) return reload(); },
      reload: reload,
    };
  }

  window.GroundPicker = { mount: mount };
})();
