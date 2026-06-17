var SUPA_URL  = window.SUPA_URL || '';
var SUPA_ANON = window.SUPA_ANON || '';
var supaAuth  = null;
var currentUser = null;
var historyLoaded = false;
var statsLoaded   = false;

if(SUPA_URL && SUPA_ANON && !SUPA_ANON.startsWith('your-')){
  try {
    supaAuth = (window.supabase || window.supabase_js).createClient(SUPA_URL, SUPA_ANON);
  } catch(e){ console.warn('Supabase init failed:', e); }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
(async function boot(){
  if(!supaAuth){
    showGuestGate();
    return;
  }

  try {
    var result = await supaAuth.auth.getSession();
    var session = result.data && result.data.session;
    if(!session){
      showGuestGate();
      return;
    }
    currentUser = session.user;
  } catch(e){
    console.error('getSession failed:', e);
    showGuestGate();
    return;
  }

  showProfile();
  loadDisplayName();
  loadHistory();
  loadStats();
})();

function showGuestGate(){
  document.getElementById('guestGate').style.display = '';
}

function showProfile(){
  document.getElementById('profileContent').style.display = '';
  var email = currentUser.email || '';
  document.getElementById('avatarEmail').textContent = email;
  // avatar/name updated by loadDisplayName(); set placeholder from email for now
  var fallback = email.split('@')[0] || 'User';
  document.getElementById('avatarLg').textContent  = fallback.charAt(0).toUpperCase();
  document.getElementById('avatarName').textContent = fallback;
}

async function loadDisplayName(){
  try {
    var res = await apiProfile('GET', '/display_name');
    var name = res.display_name || '';
    if(name){
      document.getElementById('avatarLg').textContent  = name.charAt(0).toUpperCase();
      document.getElementById('avatarName').textContent = name;
      document.getElementById('inputDisplayName').value = name;
    }
  } catch(e){ /* non-fatal */ }
}

// ─── API helper ───────────────────────────────────────────────────────────────
async function apiProfile(method, path, body){
  // Use the already-resolved currentUser's token; fall back to a fresh getSession
  var token = null;
  if(supaAuth){
    var { data: { session } } = await supaAuth.auth.getSession();
    token = session ? session.access_token : null;
  }
  var headers = { 'Content-Type': 'application/json' };
  if(token) headers['Authorization'] = 'Bearer ' + token;
  var opts = { method: method, headers: headers };
  if(body) opts.body = JSON.stringify(body);

  // Abort after 15 s so we never spin forever
  var controller = new AbortController();
  var timer = setTimeout(function(){ controller.abort(); }, 15000);
  opts.signal = controller.signal;

  try {
    var r = await fetch('/api/profile' + path, opts);
    clearTimeout(timer);
    if(!r.ok){
      var err = await r.json().catch(function(){ return { detail: r.statusText }; });
      throw new Error(err.detail || r.statusText);
    }
    if(r.status === 204) return null;
    return r.json();
  } catch(e) {
    clearTimeout(timer);
    if(e.name === 'AbortError') throw new Error('Request timed out');
    throw e;
  }
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
var currentTab = 'account';
function switchTab(name){
  currentTab = name;
  document.querySelectorAll('.tab-btn').forEach(function(b,i){
    var names = ['account','history','stats'];
    b.classList.toggle('on', names[i] === name);
  });
  document.querySelectorAll('.tab-sec').forEach(function(s){
    s.classList.remove('on');
  });
  document.getElementById('tab' + name.charAt(0).toUpperCase() + name.slice(1)).classList.add('on');
}

// ─── Account: display name ────────────────────────────────────────────────────
async function saveDisplayName(){
  var val = document.getElementById('inputDisplayName').value.trim();
  if(!val){ showFb('fbDisplayName','Name cannot be empty.','err'); return; }
  loading(true);
  try {
    await apiProfile('PATCH', '/display_name', { display_name: val });
    document.getElementById('avatarLg').textContent  = val.charAt(0).toUpperCase();
    document.getElementById('avatarName').textContent = val;
    showFb('fbDisplayName','Display name updated!','ok');
    toast('Name saved!');
  } catch(e){
    showFb('fbDisplayName', e.message, 'err');
  } finally { loading(false); }
}

// ─── Account: email ────────────────────────────────────────────────────────────
async function saveEmail(){
  var val = document.getElementById('inputEmail').value.trim();
  if(!val){ showFb('fbEmail','Enter a new email.','err'); return; }
  loading(true);
  try {
    var { error } = await supaAuth.auth.updateUser({ email: val });
    if(error) throw error;
    showFb('fbEmail', 'Check your new inbox to confirm the change.', 'ok');
    document.getElementById('inputEmail').value = '';
  } catch(e){
    showFb('fbEmail', e.message || 'Failed to update email.', 'err');
  } finally { loading(false); }
}

// ─── Account: password ────────────────────────────────────────────────────────
function openPasswordModal(){
  document.getElementById('inputPwCurrent').value = '';
  document.getElementById('inputPwNew').value = '';
  document.getElementById('inputPwConfirm').value = '';
  document.getElementById('pwModalError').style.display = 'none';
  document.getElementById('pwSaveBtn').disabled = false;
  openModal('passwordModal');
  setTimeout(function(){ document.getElementById('inputPwCurrent').focus(); }, 80);
}

async function savePassword(){
  var current = document.getElementById('inputPwCurrent').value;
  var newPw   = document.getElementById('inputPwNew').value;
  var confirm = document.getElementById('inputPwConfirm').value;
  var errEl   = document.getElementById('pwModalError');

  function pwErr(msg){ errEl.textContent = msg; errEl.style.display = 'block'; }

  if(!current){ pwErr('Please enter your current password.'); return; }
  if(newPw.length < 6){ pwErr('New password must be at least 6 characters.'); return; }
  if(newPw !== confirm){ pwErr('Passwords do not match.'); return; }

  var btn = document.getElementById('pwSaveBtn');
  btn.disabled = true;
  errEl.style.display = 'none';

  try {
    // Re-authenticate with current password first
    var { error: signInErr } = await supaAuth.auth.signInWithPassword({
      email: currentUser.email,
      password: current,
    });
    if(signInErr) throw new Error('Current password is incorrect.');

    var { error } = await supaAuth.auth.updateUser({ password: newPw });
    if(error) throw error;

    closeModal('passwordModal');
    showFb('fbPassword', 'Password updated successfully.', 'ok');
  } catch(e){
    pwErr(e.message || 'Failed to update password.');
  } finally {
    btn.disabled = false;
  }
}

// ─── Delete account ────────────────────────────────────────────────────────────
function openDeleteModal(){ openModal('deleteModal'); }

async function confirmDeleteAccount(){
  closeModal('deleteModal');
  loading(true);
  try {
    await apiProfile('DELETE', '');
    await supaAuth.auth.signOut();
    toast('Account deleted. Goodbye!');
    setTimeout(function(){ window.location = '/'; }, 1800);
  } catch(e){
    toast('Delete failed: ' + e.message, true);
  } finally { loading(false); }
}

// ─── History ──────────────────────────────────────────────────────────────────
async function loadHistory(){
  try {
    var history = await apiProfile('GET', '/history');
    renderHistory(history);
  } catch(e){
    document.getElementById('historyList').innerHTML =
      '<div class="empty-state">Failed to load history: ' + esc(e.message) + '</div>';
  }
}

function renderHistory(history){
  var el = document.getElementById('historyList');
  if(!history.length){
    el.innerHTML = '<div class="empty-state">No matches yet — go play some cricket!</div>';
    return;
  }

  var html = '';
  history.forEach(function(match, idx){
    var playerCount = match.players.length;
    var tossCount   = match.toss_history.length;
    var dateStr     = fmtDate(match.created_at);

    // Toss winner summary (last toss)
    var lastToss = match.toss_history.length ? match.toss_history[match.toss_history.length - 1].result : null;

    html += '<div class="match-card" id="mc-' + idx + '">';
    html += '<div class="match-header" onclick="toggleMatch(' + idx + ')">';
    html += '<div class="match-meta">';
    html += '<div class="match-name">' + esc(match.name) + '</div>';
    html += '<div class="match-date">' + dateStr + '</div>';
    html += '</div>';
    html += '<div class="match-badges">';
    if(playerCount) html += '<span class="mbadge mbadge-players">' + playerCount + ' players</span>';
    if(tossCount)   html += '<span class="mbadge mbadge-toss">🪙 ' + tossCount + ' toss' + (tossCount>1?'es':'') + '</span>';
    html += '</div>';
    html += '<span class="match-chevron">▼</span>';
    html += '</div>';

    // Body
    html += '<div class="match-body">';

    if(match.team_a_name && match.team_b_name && playerCount > 0){
      var teamA = match.players.filter(function(p){ return p.team_name === match.team_a_name; });
      var teamB = match.players.filter(function(p){ return p.team_name === match.team_b_name; });

      html += '<div class="teams-grid">';
      html += teamColHTML(teamA, match.team_a_name, 'ta');
      html += teamColHTML(teamB, match.team_b_name, 'tb');
      html += '</div>';
    } else if(playerCount > 0){
      html += '<div class="no-teams">Players added but teams not generated.</div>';
    } else {
      html += '<div class="no-teams">No players in this session.</div>';
    }

    if(tossCount > 0){
      html += '<div class="toss-log">';
      html += '<div class="toss-log-title">Toss History</div>';
      html += '<div class="toss-chips">';
      match.toss_history.forEach(function(t, ti){
        html += '<span class="toss-chip ' + t.result + '">#' + (ti+1) + ' ' + t.result.toUpperCase() + '</span>';
      });
      html += '</div></div>';
    }

    html += '</div>'; // match-body
    html += '</div>'; // match-card
  });

  el.innerHTML = html;
}

function teamColHTML(players, name, cls){
  var rows = players.map(function(p){
    return '<div class="team-player' + (p.is_captain?' cap':'') + '">'
      + (p.is_captain ? '<span>👑</span>' : '<span style="width:1.1em;display:inline-block"></span>')
      + '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.name) + '</span>'
      + (p.can_bowl ? '<span class="sbadge sb-bowl" style="margin-right:2px">Bowl</span>' : '')
      + '<span class="sbadge sb-' + p.skill + '">' + p.skill.slice(0,3) + '</span>'
      + '</div>';
  }).join('');
  return '<div class="team-col">'
    + '<div class="team-col-head ' + cls + '">' + esc(name) + '</div>'
    + rows
    + '</div>';
}

function toggleMatch(idx){
  var card = document.getElementById('mc-' + idx);
  card.classList.toggle('open');
}

// ─── Stats ────────────────────────────────────────────────────────────────────
async function loadStats(){
  try {
    var stats = await apiProfile('GET', '/stats');
    renderStats(stats);
  } catch(e){
    document.getElementById('statsContent').innerHTML =
      '<div class="empty-state">Failed to load stats: ' + esc(e.message) + '</div>';
  }
}

function renderStats(stats){
  var el = document.getElementById('statsContent');
  if(!stats.length){
    el.innerHTML = '<div class="empty-state">No player data yet.</div>';
    return;
  }

  var rows = stats.map(function(p, i){
    var medals = ['🥇','🥈','🥉'];
    var rank = i < 3 ? medals[i] : (i+1);
    return '<tr>'
      + '<td class="stats-rank">' + rank + '</td>'
      + '<td style="font-weight:500">' + esc(p.name) + '</td>'
      + '<td class="stat-num" style="text-align:center">' + p.games + '</td>'
      + '<td class="stat-num" style="text-align:center">' + p.as_captain + '</td>'
      + '<td class="stat-num" style="text-align:center">' + p.as_bowler + '</td>'
      + '</tr>';
  }).join('');

  el.innerHTML = '<table class="stats-table">'
    + '<thead><tr>'
    + '<th>#</th><th>Player</th>'
    + '<th style="text-align:center">Games</th>'
    + '<th style="text-align:center">Captain</th>'
    + '<th style="text-align:center">Bowled</th>'
    + '</tr></thead>'
    + '<tbody>' + rows + '</tbody>'
    + '</table>';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function showFb(id, msg, type){
  var el = document.getElementById(id);
  el.textContent = msg;
  el.className = 'feedback ' + type;
  el.style.display = 'block';
}

var toastTimer;
function toast(msg, isError){
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 2800);
}

function loading(on){ document.getElementById('loader').classList.toggle('on', on); }

function esc(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(iso){
  var d = new Date(iso);
  return d.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
}

function openModal(id){ document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-bg').forEach(function(bg){
  bg.addEventListener('click', function(e){ if(e.target === bg) bg.classList.remove('open'); });
});
