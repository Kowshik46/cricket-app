// Day lobby (/join?code=XXXXXX): shared player pool + games for one organiser's day.
(function () {
  var LS_EVENT = 'cricket_event_code';
  var SKILLS = ['beginner', 'intermediate', 'expert'];
  var code = '';
  var data = null;
  var pickGameId = null;
  var form = { skill: 'intermediate', canBowl: false, bowlType: 'legal' };
  var pollTimer = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

  var toastTimer;
  function toast(msg, isErr) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 2600);
  }

  function apiErr(j, fallback) {
    if (!j || !j.detail) return fallback;
    if (typeof j.detail === 'string') return j.detail;
    return j.detail.map(function (d) { return d.msg; }).join('; ');
  }

  function api(method, path, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    return fetch('/api/events/' + encodeURIComponent(code) + path, opts).then(function (r) {
      if (r.status === 204) return null;
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(apiErr(j, r.statusText)); e.status = r.status; throw e; }
        return j;
      });
    });
  }

  function mapsUrl(g) { return 'https://www.google.com/maps?q=' + g.latitude + ',' + g.longitude; }
  function groundHtml(g) {
    if (!g) return '';
    var hasPos = g.latitude != null && g.longitude != null;
    return hasPos
      ? '📍 <a href="' + esc(mapsUrl(g)) + '" target="_blank" rel="noopener">' + esc(g.name) + ' ↗</a>'
      : '📍 ' + esc(g.name);
  }

  // ── Screens ────────────────────────────────────────────────────────────────
  function show(which) {
    $('entryCard').hidden = which !== 'entry';
    $('errorCard').hidden = which !== 'error';
    $('lobby').hidden = which !== 'lobby';
  }

  function showError(e) {
    stopPoll();
    var ended = e.status === 410;
    $('errIcon').textContent = ended ? '⌛' : '❌';
    $('errTitle').textContent = ended ? 'This event has ended' : (e.status === 404 ? 'Event not found' : 'Something went wrong');
    $('errMsg').textContent = ended
      ? 'The day code is no longer active. Ask your organiser for a new one.'
      : e.message;
    show('error');
  }

  function enterCode() {
    var v = $('codeInput').value.trim().toUpperCase();
    if (v.length < 4) { toast('Enter the day code first', true); return; }
    location.href = '/join?code=' + encodeURIComponent(v);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function fmtWhen(ev) {
    var d = ev.event_date.split('-');
    var day = new Date(+d[0], +d[1] - 1, +d[2]).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    var until = new Date(ev.expires_at);
    var sameDay = until.toDateString() === new Date().toDateString();
    var t = until.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return '🗓 ' + esc(day) + ' · code valid until ' + esc(sameDay ? t : until.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + t);
  }

  function render() {
    var ev = data.event;
    $('evOrg').textContent = ev.organisation || '';
    $('evOrg').hidden = !ev.organisation;
    $('evName').textContent = ev.name;
    $('evWhen').innerHTML = fmtWhen(ev);
    $('evGround').innerHTML = groundHtml(ev.ground);
    $('evCode').textContent = ev.code;
    $('cntPlayers').textContent = data.players.length || '';
    $('cntGames').textContent = data.games.length || '';
    renderPlayers();
    renderGames();
  }

  function renderPlayers() {
    var el = $('playerList');
    if (!data.players.length) { el.innerHTML = '<div class="empty">No one yet — be the first to add yourself.</div>'; return; }
    el.innerHTML = data.players.map(function (p) {
      return '<div class="item">' +
        '<span class="nm">' + esc(p.name) + '</span>' +
        '<button class="badge ' + esc(p.skill) + '" data-act="skill" data-id="' + esc(p.id) + '">' + esc(p.skill) + '</button>' +
        '<button class="badge" data-act="role" data-id="' + esc(p.id) + '">' + (p.can_bowl ? 'Bat &amp; Bowl' : 'Bat') + '</button>' +
        '<button class="x" data-act="del" data-id="' + esc(p.id) + '" aria-label="Remove ' + esc(p.name) + '">✕</button>' +
        '</div>';
    }).join('');
  }

  function renderGames() {
    var el = $('gameList');
    if (!data.games.length) {
      el.innerHTML = '<div class="card"><div class="empty">Your organiser hasn\'t created any games yet.<br>Add yourself in the Players tab and check back soon.</div></div>';
      return;
    }
    el.innerHTML = data.games.map(function (g) {
      var matches = g.matches.length
        ? g.matches.map(function (m) {
            return '<div class="mrow"><span class="nm">' + esc(m.name || (m.overs + '-over match')) + '</span>' +
              '<span class="badge ' + (m.status === 'live' ? 'live' : '') + '">' + esc(String(m.status).replace('_', ' ')) + '</span>' +
              (m.watch_code ? '<a href="/watch?code=' + encodeURIComponent(m.watch_code) + '">👁 Watch</a>' : '') + '</div>';
          }).join('')
        : '<div class="mrow" style="color:var(--muted)">No matches played yet</div>';
      return '<div class="card">' +
        '<div class="game-name">' + esc(g.name) + '</div>' +
        '<div class="game-sub">' + g.player_names.length + ' player' + (g.player_names.length === 1 ? '' : 's') +
          (g.ground ? ' · ' + groundHtml(g.ground) : '') + '</div>' +
        matches +
        '<div class="row" style="margin-top:12px">' +
          '<button class="btn grow" data-act="pick" data-id="' + esc(g.id) + '">＋ Add players</button>' +
          '<a class="btn btn-prim grow" href="/?session=' + encodeURIComponent(g.id) + '&event=' + encodeURIComponent(code) + '">Open game →</a>' +
        '</div></div>';
    }).join('');
  }

  // ── Data ───────────────────────────────────────────────────────────────────
  function load(first) {
    return api('GET', '').then(function (d) {
      data = d;
      lsSet(LS_EVENT, code);
      if (first) show('lobby');
      render();
      startPoll();
    }).catch(function (e) {
      if (first) showError(e);
      else if (e.status === 410 || e.status === 404) showError(e);
    });
  }

  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      var modalOpen = $('pickModal').classList.contains('open');
      if (!document.hidden && !modalOpen) load(false);
    }, 15000);
  }
  function stopPoll() { clearInterval(pollTimer); pollTimer = null; }

  // ── Players tab ────────────────────────────────────────────────────────────
  function addPlayer() {
    var name = $('pName').value.trim();
    if (!name) { toast('Enter your name', true); $('pName').focus(); return; }
    var btn = $('addBtn');
    btn.disabled = true;
    api('POST', '/players', { name: name, skill: form.skill, can_bowl: form.canBowl, bowl_type: form.canBowl ? form.bowlType : 'legal' })
      .then(function () { $('pName').value = ''; toast('Added ' + name + ' ✓'); return load(false); })
      .catch(function (e) { toast(e.message, true); })
      .then(function () { btn.disabled = false; });
  }

  function findPlayer(id) { return data.players.find(function (p) { return p.id === id; }); }

  function onPlayerAction(e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var p = findPlayer(b.dataset.id);
    if (!p) return;
    var act = b.dataset.act, patch = null;
    if (act === 'skill') patch = { skill: SKILLS[(SKILLS.indexOf(p.skill) + 1) % SKILLS.length] };
    else if (act === 'role') patch = { can_bowl: !p.can_bowl };
    else if (act === 'del') {
      if (!confirm('Remove ' + p.name + ' from today\'s list?')) return;
      api('DELETE', '/players/' + p.id).then(function () { return load(false); }).catch(function (er) { toast(er.message, true); });
      return;
    }
    // optimistic update, then persist
    Object.keys(patch).forEach(function (k) { p[k] = patch[k]; });
    renderPlayers();
    api('PATCH', '/players/' + p.id, patch).catch(function (er) { toast(er.message, true); load(false); });
  }

  // ── Games tab ──────────────────────────────────────────────────────────────
  function openPick(gameId) {
    var g = data.games.find(function (x) { return x.id === gameId; });
    if (!g) return;
    pickGameId = gameId;
    var inGame = {};
    g.player_names.forEach(function (n) { inGame[n.toLowerCase()] = true; });
    $('pickTitle').textContent = 'Add players to ' + g.name;
    $('pickList').innerHTML = data.players.length ? data.players.map(function (p) {
      var dis = !!inGame[p.name.toLowerCase()];
      return '<label class="pick' + (dis ? ' dis' : '') + '">' +
        '<input type="checkbox" value="' + esc(p.id) + '"' + (dis ? ' checked disabled' : '') + '>' +
        '<span class="nm">' + esc(p.name) + '</span>' +
        (dis ? '<span class="badge">in game</span>' : '<span class="badge ' + esc(p.skill) + '">' + esc(p.skill) + '</span>') +
        '</label>';
    }).join('') : '<div class="empty">Nobody has added themselves yet.</div>';
    $('pickModal').classList.add('open');
    updatePickCount();
  }

  function pickBoxes() { return Array.prototype.slice.call($('pickList').querySelectorAll('input[type=checkbox]:not(:disabled)')); }
  function updatePickCount() {
    var n = pickBoxes().filter(function (b) { return b.checked; }).length;
    $('pickConfirm').textContent = n ? 'Add ' + n + ' player' + (n === 1 ? '' : 's') : 'Add';
    $('pickConfirm').disabled = !n;
    var total = data.players.length, avail = pickBoxes().length;
    $('pickInfo').textContent = (total - avail) ? (total - avail) + ' already in this game' : '';
  }

  function confirmPick() {
    var ids = pickBoxes().filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
    if (!ids.length) return;
    $('pickConfirm').disabled = true;
    api('POST', '/games/' + pickGameId + '/players', { player_ids: ids })
      .then(function (r) {
        toast('Added ' + r.added + ' player' + (r.added === 1 ? '' : 's') + ' ✓');
        $('pickModal').classList.remove('open');
        return load(false);
      })
      .catch(function (e) { toast(e.message, true); updatePickCount(); });
  }

  // ── Share ──────────────────────────────────────────────────────────────────
  function share() {
    var url = location.origin + '/join?code=' + encodeURIComponent(code);
    if (navigator.share) {
      navigator.share({ title: data.event.name, text: 'Join ' + data.event.name + ' — code ' + code, url: url }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () { toast('Link copied ✓'); }, function () { prompt('Copy this link', url); });
    } else {
      prompt('Copy this link', url);
    }
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  function init() {
    code = (new URLSearchParams(location.search).get('code') || '').trim().toUpperCase();

    $('joinBtn').addEventListener('click', enterCode);
    $('codeInput').addEventListener('input', function () { this.value = this.value.toUpperCase(); });
    $('codeInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') enterCode(); });
    $('errRetry').addEventListener('click', function () { history.replaceState(null, '', '/join'); code = ''; show('entry'); $('codeInput').focus(); });

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) { x.classList.toggle('on', x === t); });
        $('tabPlayers').hidden = t.dataset.tab !== 'players';
        $('tabGames').hidden = t.dataset.tab !== 'games';
      });
    });

    $('pSkill').addEventListener('click', function (e) {
      var b = e.target.closest('.pill'); if (!b) return;
      form.skill = b.dataset.skill;
      Array.prototype.forEach.call($('pSkill').children, function (x) { x.classList.toggle('on', x === b); });
    });
    $('pBowlRow').addEventListener('click', function () {
      form.canBowl = !form.canBowl;
      this.classList.toggle('on', form.canBowl);
      $('pTypeWrap').hidden = !form.canBowl;
    });
    $('pType').addEventListener('click', function (e) {
      var b = e.target.closest('.pill'); if (!b) return;
      form.bowlType = b.dataset.type;
      Array.prototype.forEach.call($('pType').children, function (x) { x.classList.toggle('on', x === b); x.style.color = x === b ? 'var(--cream)' : ''; });
    });
    $('pName').addEventListener('keydown', function (e) { if (e.key === 'Enter') addPlayer(); });
    $('addBtn').addEventListener('click', addPlayer);
    $('playerList').addEventListener('click', onPlayerAction);
    $('gameList').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act=pick]');
      if (b) openPick(b.dataset.id);
    });
    $('pickList').addEventListener('change', updatePickCount);
    $('pickAll').addEventListener('click', function () {
      var boxes = pickBoxes();
      var all = boxes.every(function (b) { return b.checked; });
      boxes.forEach(function (b) { b.checked = !all; });
      updatePickCount();
    });
    $('pickConfirm').addEventListener('click', confirmPick);
    $('pickCancel').addEventListener('click', function () { $('pickModal').classList.remove('open'); });
    $('pickModal').addEventListener('click', function (e) { if (e.target === this) this.classList.remove('open'); });
    $('shareBtn').addEventListener('click', share);

    if (!code) {
      var last = lsGet(LS_EVENT);
      if (last) $('codeInput').value = last;
      show('entry');
      return;
    }
    load(true);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
