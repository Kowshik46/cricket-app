// Super-admin page: day events (+ games), saved grounds, visitor log.
// Auth is an HttpOnly cookie set by POST /api/admin/login; any 401 sends us back to the login card.
(function () {
  var events = [];
  var openId = null;      // event whose manage panel is expanded
  var gamePicker = null;  // GroundPicker inside the open panel's "new game" row
  var visitDays = 7;
  var loaded = { grounds: false, visitors: false };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var toastTimer;
  function toast(msg, isErr) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 2800);
  }

  function api(method, path, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
    if (body) opts.body = JSON.stringify(body);
    return fetch('/api/admin' + path, opts).then(function (r) {
      if (r.status === 204) return null;
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && path !== '/login') { showLogin(); }
        if (!r.ok) {
          var msg = typeof j.detail === 'string' ? j.detail
            : Array.isArray(j.detail) ? j.detail.map(function (d) { return d.msg; }).join('; ') : r.statusText;
          throw new Error(msg);
        }
        return j;
      });
    });
  }

  // ── Login ──────────────────────────────────────────────────────────────────
  function showLogin() {
    $('app').hidden = true;
    $('loginCard').hidden = false;
    $('logoutBtn').hidden = true;
    $('hdrSpacer').hidden = false;
  }
  function showApp() {
    $('loginCard').hidden = true;
    $('app').hidden = false;
    $('logoutBtn').hidden = false;
    $('hdrSpacer').hidden = true;
    loadEvents();
  }

  function login() {
    var pw = $('pw').value;
    if (!pw) return;
    $('loginBtn').disabled = true;
    $('loginErr').hidden = true;
    api('POST', '/login', { password: pw })
      .then(function () { $('pw').value = ''; showApp(); })
      .catch(function (e) { $('loginErr').textContent = e.message; $('loginErr').hidden = false; })
      .then(function () { $('loginBtn').disabled = false; });
  }

  function logout() {
    api('POST', '/logout').then(function () { events = []; openId = null; showLogin(); });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toLocalInput(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function endOfDay(dateStr) { // 'YYYY-MM-DD' → local 23:59
    var p = dateStr.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2], 23, 59, 0);
  }
  function fmtDateTime(iso) {
    return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  function fmtDay(ymd) {
    var p = ymd.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  function mapsUrl(g) { return 'https://www.google.com/maps?q=' + g.latitude + ',' + g.longitude; }
  function groundHtml(g) {
    if (!g) return '<span style="color:var(--muted)">No ground</span>';
    return g.latitude != null
      ? '📍 <a href="' + esc(mapsUrl(g)) + '" target="_blank" rel="noopener">' + esc(g.name) + ' ↗</a>'
      : '📍 ' + esc(g.name);
  }
  function joinUrl(code) { return location.origin + '/join?code=' + encodeURIComponent(code); }

  function copyText(text, okMsg) {
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, function () { prompt('Copy:', text); });
    else prompt('Copy:', text);
  }
  function shareEvent(ev) {
    var text = 'Join ' + ev.name + ' — day code ' + ev.code;
    if (navigator.share) navigator.share({ title: ev.name, text: text, url: joinUrl(ev.code) }).catch(function () {});
    else copyText(text + '\n' + joinUrl(ev.code), 'Invite copied ✓');
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  function loadEvents() {
    return api('GET', '/events').then(function (rows) { events = rows; renderEvents(); }).catch(function (e) { toast(e.message, true); });
  }

  function renderEvents() {
    var el = $('eventList');
    if (!events.length) { el.innerHTML = '<div class="card"><div class="empty">No events yet. Create one above and share its code.</div></div>'; return; }
    el.innerHTML = events.map(function (ev) {
      return '<div class="card" data-id="' + esc(ev.id) + '">' +
        '<div class="evc-top"><div>' +
          '<div class="evc-name">' + esc(ev.name) + '</div>' +
          '<div class="evc-sub">' + (ev.organisation ? esc(ev.organisation) + ' · ' : '') + esc(fmtDay(ev.event_date)) +
            ' · until ' + esc(fmtDateTime(ev.expires_at)) + '<br>' + groundHtml(ev.ground) + '</div>' +
          '</div><span class="badge ' + (ev.live ? 'live' : 'ended') + '">' + (ev.status === 'closed' ? 'closed' : ev.live ? 'live' : 'expired') + '</span></div>' +
        '<div class="evc-code"><span class="code-chip">' + esc(ev.code) + '</span>' +
          '<button class="btn btn-sm" data-act="copy">Copy link</button>' +
          '<button class="btn btn-sm" data-act="share">Share</button>' +
          '<span class="cnt">' + ev.players_count + ' players<br>' + ev.games_count + ' games</span></div>' +
        '<div class="row">' +
          '<button class="btn btn-sm grow" data-act="manage">' + (openId === ev.id ? 'Hide ▴' : 'Manage ▾') + '</button>' +
          '<button class="btn btn-sm" data-act="toggle">' + (ev.status === 'closed' ? 'Reopen' : 'Close') + '</button>' +
          '<button class="btn btn-sm btn-danger" data-act="delete">Delete</button>' +
        '</div>' +
        '<div class="panel" id="panel-' + esc(ev.id) + '" hidden></div>' +
        '</div>';
    }).join('');
    if (openId) openPanel(openId);
  }

  function findEvent(id) { return events.find(function (e) { return e.id === id; }); }

  function createEvent() {
    var name = $('evName').value.trim();
    if (!name) { toast('Give the event a name', true); $('evName').focus(); return; }
    var date = $('evDate').value;
    var until = new Date($('evUntil').value);
    if (!date || isNaN(until)) { toast('Pick a date and expiry', true); return; }
    $('createEventBtn').disabled = true;
    api('POST', '/events', {
      name: name, organisation: $('evOrg').value.trim() || null, event_date: date,
      expires_at: until.toISOString(), ground_id: evGround.getValue() || null,
    }).then(function (r) {
      $('evName').value = ''; $('evOrg').value = '';
      toast('Created — code ' + r.event.code);
      openId = r.event.id;
      return loadEvents();
    }).catch(function (e) { toast(e.message, true); })
      .then(function () { $('createEventBtn').disabled = false; });
  }

  function patchEvent(id, body, msg) {
    return api('PATCH', '/events/' + id, body).then(function () { if (msg) toast(msg); return loadEvents(); })
      .catch(function (e) { toast(e.message, true); });
  }

  function onEventAction(e) {
    var b = e.target.closest('button[data-act]');
    var card = e.target.closest('[data-id]');
    if (!b || !card) return;
    var ev = findEvent(card.dataset.id);
    if (!ev) return;
    var act = b.dataset.act;
    if (act === 'copy') copyText(joinUrl(ev.code), 'Link copied ✓');
    else if (act === 'share') shareEvent(ev);
    else if (act === 'manage') { openId = openId === ev.id ? null : ev.id; renderEvents(); }
    else if (act === 'toggle') {
      if (ev.status === 'closed') {
        var body = { status: 'active' };
        if (!ev.live) body.expires_at = new Date(Date.now() + 3 * 3600 * 1000).toISOString(); // reopen for 3h if already past
        patchEvent(ev.id, body, 'Reopened');
      } else patchEvent(ev.id, { status: 'closed' }, 'Closed — the code no longer works');
    } else if (act === 'delete') {
      if (!confirm('Delete "' + ev.name + '"?\nThe player list is removed. Games and their match data are kept.')) return;
      api('DELETE', '/events/' + ev.id).then(function () { if (openId === ev.id) openId = null; toast('Deleted'); return loadEvents(); })
        .catch(function (er) { toast(er.message, true); });
    }
  }

  // ── Manage panel (expiry + games) ──────────────────────────────────────────
  function openPanel(id) {
    var panel = $('panel-' + id);
    if (!panel) return;
    panel.hidden = false;
    panel.innerHTML = '<div class="empty">Loading…</div>';
    api('GET', '/events/' + id).then(function (d) {
      var ev = d.event;
      panel.innerHTML =
        '<h3>Code valid until</h3>' +
        '<div class="row"><input class="finput grow-input" type="datetime-local" id="untilIn" value="' + esc(toLocalInput(new Date(ev.expires_at))) + '">' +
          '<button class="btn btn-sm" data-p="until">Save</button>' +
          '<button class="btn btn-sm" data-p="plus" data-h="1">+1 h</button>' +
          '<button class="btn btn-sm" data-p="eod">End of day</button></div>' +
        '<h3>Games (' + d.games.length + ')</h3>' +
        (d.games.length ? '<div class="list">' + d.games.map(function (g) {
          return '<div class="item gitem" data-gid="' + esc(g.id) + '"><div class="nm" style="white-space:normal">' + esc(g.name) +
            '<div class="sub">' + g.player_names.length + ' players · ' + g.matches.length + ' matches' +
            (g.ground ? ' · ' + groundHtml(g.ground) : '') + '</div></div>' +
            '<a class="btn btn-sm" href="/?session=' + encodeURIComponent(g.id) + '&event=' + encodeURIComponent(ev.code) + '">Open</a>' +
            '<button class="x" data-p="delgame" aria-label="Delete game">✕</button></div>';
        }).join('') + '</div>' : '<div class="empty">No games yet.</div>') +
        '<h3>New game</h3>' +
        '<input class="finput" id="gameName" maxlength="60" placeholder="e.g. Game 1 — Reds vs Blues">' +
        '<label class="flabel">Ground (defaults to the event ground)</label><div id="gameGround"></div>' +
        '<button class="btn btn-prim btn-block" style="margin-top:12px" data-p="addgame">Add game</button>' +
        '<h3>Players today (' + d.players.length + ')</h3>' +
        (d.players.length ? '<div class="row" style="gap:6px">' + d.players.map(function (p) {
          return '<span class="badge ' + esc(p.skill) + '">' + esc(p.name) + '</span>';
        }).join('') + '</div>' : '<div class="empty">Nobody has joined yet.</div>');
      gamePicker = GroundPicker.mount($('gameGround'), { value: ev.ground ? ev.ground.id : '' });
      panel.dataset.expires = ev.expires_at;
      panel.dataset.date = ev.event_date;
    }).catch(function (e) { panel.innerHTML = '<div class="err">' + esc(e.message) + '</div>'; });
  }

  function onPanelAction(e) {
    var b = e.target.closest('[data-p]');
    var card = e.target.closest('[data-id]');
    if (!b || !card) return;
    var id = card.dataset.id, panel = $('panel-' + id), act = b.dataset.p;
    if (act === 'until') {
      var d = new Date($('untilIn').value);
      if (isNaN(d)) { toast('Pick a valid date and time', true); return; }
      patchEvent(id, { expires_at: d.toISOString() }, 'Expiry updated');
    } else if (act === 'plus') {
      var base = Math.max(new Date(panel.dataset.expires).getTime(), Date.now());
      patchEvent(id, { expires_at: new Date(base + 3600 * 1000).toISOString() }, 'Extended by 1 hour');
    } else if (act === 'eod') {
      patchEvent(id, { expires_at: endOfDay(toLocalInput(new Date()).slice(0, 10)).toISOString() }, 'Valid until end of today');
    } else if (act === 'addgame') {
      var name = $('gameName').value.trim();
      if (!name) { toast('Name the game', true); return; }
      api('POST', '/events/' + id + '/games', { name: name, ground_id: gamePicker.getValue() || null })
        .then(function () { toast('Game added'); return loadEvents(); })
        .catch(function (er) { toast(er.message, true); });
    } else if (act === 'delgame') {
      var row = b.closest('[data-gid]');
      if (!confirm('Delete this game and all its teams, tosses and matches?')) return;
      api('DELETE', '/events/' + id + '/games/' + row.dataset.gid)
        .then(function () { toast('Game deleted'); return loadEvents(); })
        .catch(function (er) { toast(er.message, true); });
    }
  }

  // ── Grounds ────────────────────────────────────────────────────────────────
  function loadGrounds() {
    fetch('/api/grounds').then(function (r) { return r.json(); }).then(function (rows) {
      loaded.grounds = true;
      $('groundList').innerHTML = rows.length ? rows.map(function (g) {
        return '<div class="item gitem" data-id="' + esc(g.id) + '" data-name="' + esc(g.name) + '">' +
          '<div class="nm" style="white-space:normal">' + esc(g.name) +
            '<div class="sub">' + (g.latitude != null ? esc(g.latitude + ', ' + g.longitude) + ' · <a href="' + esc(mapsUrl(g)) + '" target="_blank" rel="noopener">map ↗</a>' : 'no location saved') + '</div></div>' +
          '<button class="btn btn-sm" data-g="rename">Rename</button>' +
          '<button class="x" data-g="del" aria-label="Delete ground">✕</button></div>';
      }).join('') : '<div class="empty">No grounds saved yet.</div>';
    }).catch(function () { toast('Could not load grounds', true); });
  }

  function onGroundAction(e) {
    var b = e.target.closest('[data-g]');
    var row = e.target.closest('[data-id]');
    if (!b || !row) return;
    if (b.dataset.g === 'rename') {
      var name = prompt('New name for this ground', row.dataset.name);
      if (!name || !name.trim() || name.trim() === row.dataset.name) return;
      api('PATCH', '/grounds/' + row.dataset.id, { name: name.trim() }).then(function () { toast('Renamed'); loadGrounds(); })
        .catch(function (er) { toast(er.message, true); });
    } else if (b.dataset.g === 'del') {
      if (!confirm('Delete "' + row.dataset.name + '"? Matches that used it will just lose the label.')) return;
      api('DELETE', '/grounds/' + row.dataset.id).then(function () { toast('Deleted'); loadGrounds(); })
        .catch(function (er) { toast(er.message, true); });
    }
  }

  // ── Visitors ───────────────────────────────────────────────────────────────
  var PAGE_NAMES = { '/': 'Home', '/score': 'Scoring', '/watch': 'Watch live', '/join': 'Day lobby', '/profile': 'Profile' };

  function barList(rows, mapLabel) {
    if (!rows.length) return '<div class="empty">No data yet</div>';
    var max = Math.max.apply(null, rows.map(function (r) { return r.count; }));
    return rows.map(function (r) {
      return '<div class="bar-row lbl"><span class="k">' + esc(mapLabel ? mapLabel(r.label) : r.label) + '</span>' +
        '<span class="track"><span class="fill" style="display:block;width:' + Math.round(r.count / max * 100) + '%"></span></span>' +
        '<span class="n">' + r.count + '</span></div>';
    }).join('');
  }

  function loadVisitors() {
    var off = -new Date().getTimezoneOffset();
    api('GET', '/visitors?days=' + visitDays + '&tz_offset=' + off).then(function (v) {
      loaded.visitors = true;
      $('kpis').innerHTML =
        '<div class="kpi"><div class="v">' + v.views + '</div><div class="l">Page views</div></div>' +
        '<div class="kpi"><div class="v">' + v.unique_visitors + '</div><div class="l">Unique visitors</div></div>' +
        '<div class="kpi"><div class="v">' + v.bot_views + '</div><div class="l">Bots ignored</div></div>';
      var max = Math.max.apply(null, v.series.map(function (d) { return d.views; }).concat([1]));
      $('series').innerHTML = v.series.map(function (d) {
        return '<div class="bar-row"><span class="k">' + esc(fmtDay(d.date)) + '</span>' +
          '<span class="track"><span class="fill" style="display:block;width:' + Math.round(d.views / max * 100) + '%"></span></span>' +
          '<span class="n">' + d.views + ' · ' + d.visitors + '👤</span></div>';
      }).join('');
      $('topPaths').innerHTML = barList(v.paths, function (p) { return PAGE_NAMES[p] || p; });
      $('topDevices').innerHTML = barList(v.devices);
      $('topBrowsers').innerHTML = barList(v.browsers);
      $('topOs').innerHTML = barList(v.os);
      $('topCountries').innerHTML = barList(v.countries);
      $('topReferrers').innerHTML = barList(v.referrers);
      $('recent').innerHTML = '<tr><th>When</th><th>Page</th><th>Device</th><th>Browser · OS</th><th>Country</th><th>Visitor</th></tr>' +
        v.recent.map(function (r) {
          return '<tr><td>' + esc(fmtDateTime(r.created_at)) + '</td><td>' + esc(PAGE_NAMES[r.path] || r.path) + '</td><td>' + esc(r.device_type) +
            '</td><td>' + esc(r.browser) + ' · ' + esc(r.os) + '</td><td>' + esc(r.country || '—') + '</td><td class="mono">' + esc(r.visitor || '—') + '</td></tr>';
        }).join('');
    }).catch(function (e) { toast(e.message, true); });
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  var evGround;

  function init() {
    $('loginBtn').addEventListener('click', login);
    $('pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); });
    $('logoutBtn').addEventListener('click', logout);

    // defaults for the new-event form
    var today = new Date();
    $('evDate').value = toLocalInput(today).slice(0, 10);
    $('evUntil').value = toLocalInput(endOfDay($('evDate').value));
    $('evDate').addEventListener('change', function () {
      if (this.value) $('evUntil').value = toLocalInput(endOfDay(this.value));
    });
    evGround = GroundPicker.mount($('evGround'), {});
    $('createEventBtn').addEventListener('click', createEvent);

    $('eventList').addEventListener('click', function (e) { onEventAction(e); onPanelAction(e); });
    $('groundList').addEventListener('click', onGroundAction);

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) { x.classList.toggle('on', x === t); });
        ['events', 'grounds', 'visitors'].forEach(function (n) { $('tab' + n[0].toUpperCase() + n.slice(1)).hidden = t.dataset.tab !== n; });
        if (t.dataset.tab === 'grounds') loadGrounds();
        if (t.dataset.tab === 'visitors') loadVisitors();
      });
    });
    $('rangePills').addEventListener('click', function (e) {
      var b = e.target.closest('.pill'); if (!b) return;
      visitDays = +b.dataset.days;
      Array.prototype.forEach.call($('rangePills').children, function (x) { x.classList.toggle('on', x === b); });
      loadVisitors();
    });

    api('GET', '/me').then(showApp).catch(showLogin);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
