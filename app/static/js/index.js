// ─── Supabase Auth client (browser-side) ─────────────────────────────────────
var SUPA_URL  = window.SUPA_URL || '';
var SUPA_ANON = window.SUPA_ANON || '';
var supaAuth  = null;
if(SUPA_URL && SUPA_ANON && !SUPA_ANON.startsWith('your-')) {
  try {
    // UMD bundle exposes supabase.createClient
    var _sb = window.supabase || (window.supabase_js);
    supaAuth = _sb.createClient(SUPA_URL, SUPA_ANON);
  } catch(e) {
    console.warn('Supabase client init failed:', e);
  }
}

// ─── State ───────────────────────────────────────────────────────────────────
var currentSessionId = null;
var players = [];
var teamsData = null;
var tossN = 0;
var tossing = false;
var lastTossId = null;
var tossWinner = null;    // 'a' or 'b'
var currentUser = null;
var canBowl = false;         // step-1 add-player toggle
var lateCanBowl = false;     // step-2 late-player toggle
var lateTeamPick = 'a';      // which team the late player goes to

var LS_KEY = 'cricket_last_session';
var LS_SESSIONS = 'cricket_sessions';

function _getGuestIds(){
  try {
    var arr = JSON.parse(localStorage.getItem(LS_SESSIONS) || '[]');
    // backward compat: seed from last-session key if array is empty
    var last = localStorage.getItem(LS_KEY);
    if(last && !arr.includes(last)){ arr.push(last); localStorage.setItem(LS_SESSIONS, JSON.stringify(arr)); }
    return arr;
  } catch(e){ return []; }
}
function _addGuestId(id){
  var arr = _getGuestIds();
  if(!arr.includes(id)){ arr.push(id); localStorage.setItem(LS_SESSIONS, JSON.stringify(arr)); }
}
function _removeGuestId(id){
  var arr = _getGuestIds().filter(function(x){ return x !== id; });
  localStorage.setItem(LS_SESSIONS, JSON.stringify(arr));
}

// ─── Init ─────────────────────────────────────────────────────────────────────
setPill('intermediate');
setLPill('intermediate');
document.getElementById('nameInput').addEventListener('keydown', function(e){
  if(e.key === 'Enter'){ e.preventDefault(); addPlayer(); }
});
document.getElementById('latePlayerName').addEventListener('keydown', function(e){
  if(e.key === 'Enter'){ e.preventDefault(); addLatePlayer(); }
});
document.getElementById('newSessionName').addEventListener('keydown', function(e){
  if(e.key === 'Enter'){ e.preventDefault(); createSession(); }
});
document.getElementById('renameSessionName').addEventListener('keydown', function(e){
  if(e.key === 'Enter'){ e.preventDefault(); renameSession(); }
});
document.getElementById('authEmail').addEventListener('keydown', function(e){
  if(e.key === 'Enter'){ e.preventDefault(); document.getElementById('authPassword').focus(); }
});
document.getElementById('authPassword').addEventListener('keydown', function(e){
  if(e.key === 'Enter'){ e.preventDefault(); submitAuth(); }
});

// Close user menu when clicking outside
document.addEventListener('click', function(e){
  var menu = document.getElementById('userMenu');
  var chip = document.getElementById('authChip');
  if(menu.style.display !== 'none' && !menu.contains(e.target) && !chip.contains(e.target)){
    menu.style.display = 'none';
  }
});

initAuth();

// ─── Auth Init ────────────────────────────────────────────────────────────────
async function initAuth(){
  if(!supaAuth){
    // Anon key not configured — chip stays visible but clicking shows setup hint
    updateAuthChip();
    await loadSessions();
    return;
  }

  // Listen for auth state changes (login, logout, token refresh)
  // Check current session on startup first, before attaching the listener,
  // so we know whether a subsequent SIGNED_IN event is a fresh login or a refresh.
  var { data: { session: initSession } } = await supaAuth.auth.getSession();
  if(initSession){
    currentUser = initSession.user;
    updateAuthChip();
    fetchDisplayName(initSession.access_token);
  }

  supaAuth.auth.onAuthStateChange(async function(event, session){
    currentUser = session ? session.user : null;
    updateAuthChip();

    if(event === 'PASSWORD_RECOVERY'){
      // User clicked the reset link — show the set-new-password modal
      document.getElementById('resetPwInput').value = '';
      document.getElementById('resetPwConfirm').value = '';
      document.getElementById('resetPwError').style.display = 'none';
      document.getElementById('resetPwSubmitBtn').disabled = false;
      openModal('resetPwModal');
      return;
    }

    if(event === 'SIGNED_IN' && !initSession){
      // Only treat as fresh login if there was no session at startup
      initSession = session; // prevent duplicate on token refresh
      fetchDisplayName(session.access_token);
      await claimAnonymousSessions(session.access_token);
      await loadSessions();
    } else if(event === 'SIGNED_OUT'){
      initSession = null;
      currentDisplayName = '';
      await loadSessions();
    }
    // INITIAL_SESSION / TOKEN_REFRESHED: session already loaded below, skip
  });

  await loadSessions();
}

var currentDisplayName = '';

async function fetchDisplayName(accessToken){
  try {
    var res = await fetch('/api/profile/display_name', {
      headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    if(res.ok){
      var data = await res.json();
      currentDisplayName = (data.display_name || '').trim();
    }
  } catch(e){ /* silent */ }
  updateAuthChip();
}

function updateAuthChip(){
  var chip   = document.getElementById('authChip');
  var avatar = document.getElementById('authAvatar');
  var label  = document.getElementById('authLabel');
  if(currentUser){
    var email = currentUser.email || '';
    var name  = currentDisplayName || email.split('@')[0] || 'Account';
    var initial = currentDisplayName ? currentDisplayName.charAt(0).toUpperCase()
                                     : email.charAt(0).toUpperCase() || 'U';
    avatar.textContent = initial;
    label.textContent  = name;
    label.classList.add('signed-in');
    chip.title = email;
  } else {
    currentDisplayName = '';
    avatar.textContent = '?';
    label.textContent  = 'Sign in';
    label.classList.remove('signed-in');
    chip.title = '';
  }
}

function onAuthChipClick(){
  if(currentUser){
    var menu = document.getElementById('userMenu');
    var email = currentUser.email || '';
    var menuLabel = currentDisplayName ? currentDisplayName + '\n' + email : email;
    var el = document.getElementById('userMenuEmail');
    if(currentDisplayName){
      el.innerHTML = '<strong style="color:var(--cream);display:block">' + currentDisplayName + '</strong>' + email;
    } else {
      el.textContent = email;
    }
    menu.style.display = menu.style.display === 'none' ? '' : 'none';
  } else if(!supaAuth){
    toast('Set SUPABASE_ANON_KEY in .env to enable sign-in', true);
  } else {
    openAuthModal();
  }
}

function closeUserMenu(){ document.getElementById('userMenu').style.display = 'none'; }

async function signOut(){
  closeUserMenu();
  if(!supaAuth) return;
  loading(true);
  try {
    await supaAuth.auth.signOut();
    currentUser = null;
    localStorage.removeItem(LS_KEY);
    currentSessionId = null; players = []; teamsData = null;
    updateAuthChip();
    toast('Signed out.');
    await loadSessions();
  } catch(e){
    toast('Sign-out failed: ' + e.message, true);
  } finally {
    loading(false);
  }
}

// ─── Auth Modal ───────────────────────────────────────────────────────────────
var authMode = 'signin';

function openAuthModal(){
  switchAuthTab('signin');
  document.getElementById('authEmail').value = '';
  document.getElementById('authPassword').value = '';
  document.getElementById('authDisplayName').value = '';
  hideAuthFeedback();
  openModal('authModal');
  setTimeout(function(){ document.getElementById('authEmail').focus(); }, 80);
}

function switchAuthTab(mode){
  authMode = mode;
  document.getElementById('tabSignIn').classList.toggle('on', mode === 'signin');
  document.getElementById('tabSignUp').classList.toggle('on', mode === 'signup');
  document.getElementById('authModalTitle').textContent = mode === 'signin' ? 'Welcome back' : 'Create account';
  document.getElementById('authSubmitBtn').textContent  = mode === 'signin' ? 'Sign In' : 'Sign Up';
  document.getElementById('authPassword').autocomplete  = mode === 'signin' ? 'current-password' : 'new-password';
  document.getElementById('authDisplayName').style.display = mode === 'signup' ? '' : 'none';
  document.getElementById('forgotPwRow').style.display = mode === 'signin' ? '' : 'none';
  hideAuthFeedback();
}

function hideAuthFeedback(){
  document.getElementById('authError').style.display   = 'none';
  document.getElementById('authSuccess').style.display = 'none';
}

function showAuthError(msg){
  var el = document.getElementById('authError');
  el.textContent = msg; el.style.display = 'block';
  document.getElementById('authSuccess').style.display = 'none';
}

function showAuthSuccess(msg){
  var el = document.getElementById('authSuccess');
  el.textContent = msg; el.style.display = 'block';
  document.getElementById('authError').style.display = 'none';
}

async function submitAuth(){
  if(!supaAuth) return;
  var email    = document.getElementById('authEmail').value.trim();
  var password = document.getElementById('authPassword').value;
  if(!email || !password){ showAuthError('Please enter email and password.'); return; }

  var btn = document.getElementById('authSubmitBtn');
  btn.disabled = true;
  hideAuthFeedback();

  try {
    if(authMode === 'signin'){
      var { error } = await supaAuth.auth.signInWithPassword({ email, password });
      if(error) throw error;
      closeModal('authModal');
      toast('Signed in!');
    } else {
      var displayName = document.getElementById('authDisplayName').value.trim();
      var { data: signUpData, error } = await supaAuth.auth.signUp({ email, password });
      if(error) throw error;
      // Supabase silently "succeeds" for duplicate emails when confirmation is on.
      // A duplicate returns a user with an empty identities array.
      if(signUpData && signUpData.user && Array.isArray(signUpData.user.identities) && signUpData.user.identities.length === 0){
        showAuthError('An account with this email already exists. Please sign in instead.');
        return;
      }
      // Save display name immediately if provided and we got a session (auto-confirm on)
      if(displayName && signUpData && signUpData.session && signUpData.session.access_token){
        try {
          await fetch('/api/profile/display_name', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + signUpData.session.access_token,
            },
            body: JSON.stringify({ display_name: displayName }),
          });
        } catch(e2){ /* non-fatal */ }
      }
      showAuthSuccess('Account created! Check your email to confirm, then sign in.');
    }
  } catch(e){
    showAuthError(e.message || 'Authentication failed.');
  } finally {
    btn.disabled = false;
  }
}

// ─── Forgot / Reset password ──────────────────────────────────────────────────
function openForgotModal(){
  closeModal('authModal');
  document.getElementById('forgotEmail').value = '';
  document.getElementById('forgotError').style.display = 'none';
  document.getElementById('forgotSuccess').style.display = 'none';
  document.getElementById('forgotSubmitBtn').disabled = false;
  openModal('forgotModal');
  setTimeout(function(){ document.getElementById('forgotEmail').focus(); }, 80);
}

async function submitForgotPassword(){
  var email = document.getElementById('forgotEmail').value.trim();
  var errEl = document.getElementById('forgotError');
  var okEl  = document.getElementById('forgotSuccess');
  errEl.style.display = 'none'; okEl.style.display = 'none';
  if(!email){ errEl.textContent = 'Please enter your email address.'; errEl.style.display = 'block'; return; }

  var btn = document.getElementById('forgotSubmitBtn');
  btn.disabled = true;
  try {
    var { error } = await supaAuth.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/',
    });
    if(error) throw error;
    okEl.textContent = 'Reset link sent! Check your inbox.';
    okEl.style.display = 'block';
  } catch(e){
    errEl.textContent = e.message || 'Failed to send reset link.';
    errEl.style.display = 'block';
    btn.disabled = false;
  }
}

async function submitResetPassword(){
  var pw      = document.getElementById('resetPwInput').value;
  var confirm = document.getElementById('resetPwConfirm').value;
  var errEl   = document.getElementById('resetPwError');
  errEl.style.display = 'none';
  if(pw.length < 6){ errEl.textContent = 'Password must be at least 6 characters.'; errEl.style.display = 'block'; return; }
  if(pw !== confirm){ errEl.textContent = 'Passwords do not match.'; errEl.style.display = 'block'; return; }

  var btn = document.getElementById('resetPwSubmitBtn');
  btn.disabled = true;
  try {
    var { error } = await supaAuth.auth.updateUser({ password: pw });
    if(error) throw error;
    closeModal('resetPwModal');
    toast('Password updated! You are now signed in.');
  } catch(e){
    errEl.textContent = e.message || 'Failed to update password.';
    errEl.style.display = 'block';
    btn.disabled = false;
  }
}

// ─── Claim anonymous sessions ─────────────────────────────────────────────────
async function claimAnonymousSessions(accessToken){
  // Collect all session UUIDs from localStorage and the current dropdown
  var ids = [];
  var last = localStorage.getItem(LS_KEY);
  if(last) ids.push(last);

  // Also grab any session ids already in the dropdown that might not be the last one
  var sel = document.getElementById('sessionSelect');
  for(var i = 0; i < sel.options.length; i++){
    var v = sel.options[i].value;
    if(v && !ids.includes(v)) ids.push(v);
  }

  if(!ids.length) return;

  try {
    await api('POST', '/auth/claim', { session_ids: ids }, accessToken);
  } catch(e){
    console.warn('Claim failed:', e.message);
  }
}

// ─── API helpers ─────────────────────────────────────────────────────────────
async function getAccessToken(){
  if(!supaAuth) return null;
  var { data: { session } } = await supaAuth.auth.getSession();
  return session ? session.access_token : null;
}

async function api(method, path, body, overrideToken){
  var token = overrideToken !== undefined ? overrideToken : await getAccessToken();
  var headers = { 'Content-Type': 'application/json' };
  if(token) headers['Authorization'] = 'Bearer ' + token;
  var opts = { method: method, headers: headers };
  if(body) opts.body = JSON.stringify(body);
  var r = await fetch('/api' + path, opts);
  if(!r.ok){
    var err = await r.json().catch(function(){ return { detail: r.statusText }; });
    throw new Error(err.detail || r.statusText);
  }
  if(r.status === 204) return null;
  return r.json();
}

// ─── Sessions ─────────────────────────────────────────────────────────────────
var _loadingSessionsLock = false;
async function loadSessions(){
  if(_loadingSessionsLock) return;
  _loadingSessionsLock = true;
  loading(true);
  try {
    var token = await getAccessToken();
    var sessionsPath = '/sessions';
    if(!token){
      var guestIds = _getGuestIds();
      if(guestIds.length) sessionsPath = '/sessions?ids=' + guestIds.join(',');
    }
    var sessions = await api('GET', sessionsPath);
    var sel = document.getElementById('sessionSelect');
    sel.innerHTML = '<option value="">— select or create a match —</option>';
    sessions.forEach(function(s){
      var opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name + '  (' + fmtDate(s.created_at) + ')';
      sel.appendChild(opt);
    });
    var last = localStorage.getItem(LS_KEY);
    if(last && sessions.find(function(s){ return s.id === last; })){
      sel.value = last;
      await selectSession(last);
    } else {
      renderPlayers();
    }
  } catch(e){
    toast('Could not load sessions: ' + e.message, true);
  } finally {
    _loadingSessionsLock = false;
    loading(false);
  }
}

async function createSession(){
  var name = document.getElementById('newSessionName').value.trim() || 'Match';
  closeModal('newSessionModal');
  loading(true);
  try {
    var s = await api('POST', '/sessions', { name: name });
    currentSessionId = s.id;
    localStorage.setItem(LS_KEY, s.id);
    _addGuestId(s.id);
    players = [];
    teamsData = null;
    await loadSessions();
    document.getElementById('sessionSelect').value = s.id;
    document.getElementById('deleteSessionBtn').style.display = ''; document.getElementById('renameSessionBtn').style.display = '';
    document.getElementById('noSessionInfo').style.display = 'none';
    document.getElementById('playerForm').style.display = '';
    renderPlayers();
    goTo(1);
    toast('Match "' + name + '" created!');
  } catch(e){
    toast('Failed: ' + e.message, true);
  } finally {
    loading(false);
  }
}

function onSessionChange(){
  var id = document.getElementById('sessionSelect').value;
  if(!id){ currentSessionId = null; players = []; teamsData = null; renderPlayers(); document.getElementById('deleteSessionBtn').style.display = 'none'; document.getElementById('renameSessionBtn').style.display = 'none'; return; }
  selectSession(id);
}

async function selectSession(id){
  loading(true);
  try {
    currentSessionId = id;
    localStorage.setItem(LS_KEY, id);
    document.getElementById('deleteSessionBtn').style.display = ''; document.getElementById('renameSessionBtn').style.display = '';
    document.getElementById('noSessionInfo').style.display = 'none';
    document.getElementById('playerForm').style.display = '';
    var loaded = await api('GET', '/sessions/' + id + '/players');
    players = loaded;
    // Try to restore existing teams without regenerating
    try {
      teamsData = await api('GET', '/sessions/' + id + '/teams');
    } catch(e){
      teamsData = null; // 404 = no teams yet, that's fine
    }
    renderPlayers();
    goTo(1);
  } catch(e){
    toast('Failed to load session: ' + e.message, true);
  } finally {
    loading(false);
  }
}

function goToTeams(){
  if(teamsData){ renderTeams(); goTo(2); }
}

function confirmDeleteSession(){
  document.getElementById('confirmTitle').textContent = 'Delete this match?';
  document.getElementById('confirmMsg').textContent = 'All players and teams for this match will be deleted permanently.';
  document.getElementById('confirmOk').onclick = deleteSession;
  openModal('confirmModal');
}

async function deleteSession(){
  closeModal('confirmModal');
  if(!currentSessionId) return;
  loading(true);
  try {
    var deletedId = currentSessionId;
    await api('DELETE', '/sessions/' + currentSessionId);
    localStorage.removeItem(LS_KEY);
    _removeGuestId(deletedId);
    currentSessionId = null; players = []; teamsData = null;
    document.getElementById('deleteSessionBtn').style.display = 'none';
    document.getElementById('renameSessionBtn').style.display = 'none';
    document.getElementById('noSessionInfo').style.display = 'block';
    document.getElementById('playerForm').style.display = 'none';
    await loadSessions();
    renderPlayers();
    goTo(1);
    toast('Match deleted.');
  } catch(e){
    toast('Failed: ' + e.message, true);
  } finally {
    loading(false);
  }
}

// ─── Players ─────────────────────────────────────────────────────────────────
async function addPlayer(){
  if(!currentSessionId){ toast('Select or create a match first!'); return; }
  var name = document.getElementById('nameInput').value.trim();
  if(!name){ toast('Enter a name first!'); return; }
  var skill = getSkill();
  loading(true);
  try {
    var p = await api('POST', '/sessions/' + currentSessionId + '/players', { name: name, skill: skill, can_bowl: canBowl });
    players.push(p);
    document.getElementById('nameInput').value = '';
    document.getElementById('nameInput').focus();
    renderPlayers();
    toast(name + ' added!');
  } catch(e){
    toast(e.message, true);
  } finally {
    loading(false);
  }
}

async function removePlayer(pid){
  if(!currentSessionId) return;
  loading(true);
  try {
    await api('DELETE', '/sessions/' + currentSessionId + '/players/' + pid);
    players = players.filter(function(p){ return p.id !== pid; });
    renderPlayers();
  } catch(e){
    toast('Failed to remove: ' + e.message, true);
  } finally {
    loading(false);
  }
}

var _editingPlayerId = null;

function editPlayer(pid){
  _editingPlayerId = pid;
  renderPlayers();
  // focus the name input after render
  setTimeout(function(){
    var inp = document.getElementById('edit-name-' + pid);
    if(inp){ inp.focus(); inp.select(); }
  }, 30);
}

function cancelPlayerEdit(){
  _editingPlayerId = null;
  renderPlayers();
}

async function savePlayerEdit(pid){
  var nameInp = document.getElementById('edit-name-' + pid);
  var name = nameInp ? nameInp.value.trim() : null;
  if(!name){ toast('Name cannot be empty.', true); return; }

  // read selected skill
  var skillBtns = document.querySelectorAll('#edit-skill-' + pid + ' button');
  var skill = null;
  skillBtns.forEach(function(b){ if(b.classList.contains('on')) skill = b.dataset.skill; });

  // read bowl toggle
  var bowlBtn = document.getElementById('edit-bowl-' + pid);
  var can_bowl = bowlBtn ? bowlBtn.classList.contains('on') : false;

  var orig = players.find(function(p){ return p.id === pid; });
  var updates = {};
  if(name !== orig.name) updates.name = name;
  if(skill && skill !== orig.skill) updates.skill = skill;
  if(can_bowl !== orig.can_bowl) updates.can_bowl = can_bowl;

  if(!Object.keys(updates).length){
    _editingPlayerId = null;
    renderPlayers();
    return;
  }

  loading(true);
  try {
    var updated = await api('PATCH', '/sessions/' + currentSessionId + '/players/' + pid, updates);
    var idx = players.findIndex(function(p){ return p.id === pid; });
    if(idx !== -1) players[idx] = updated;
    _editingPlayerId = null;
    renderPlayers();
    toast('Player updated!');
  } catch(e){
    toast(e.message || 'Failed to update player.', true);
  } finally {
    loading(false);
  }
}

function toggleEditBowl(pid){
  var btn = document.getElementById('edit-bowl-' + pid);
  if(btn) btn.classList.toggle('on');
}

function setEditSkill(pid, skill){
  var skMap = {beginner:'b', intermediate:'m', expert:'e'};
  var btns = document.querySelectorAll('#edit-skill-' + pid + ' button');
  btns.forEach(function(b){ b.classList.remove('on','b','m','e'); });
  var target = document.querySelector('#edit-skill-' + pid + ' button[data-skill="' + skill + '"]');
  if(target){ target.classList.add('on'); if(skMap[skill]) target.classList.add(skMap[skill]); }
}

function renderPlayers(){
  var list  = document.getElementById('plist');
  var empty = document.getElementById('emptyMsg');
  var count = document.getElementById('pcount');
  var warn  = document.getElementById('warnMsg');
  var btn   = document.getElementById('genBtn');
  var noSes = document.getElementById('noSessionInfo');

  if(!currentSessionId){
    list.innerHTML = ''; empty.style.display = 'block'; count.textContent = '';
    warn.style.display = 'none'; btn.disabled = true;
    noSes.style.display = 'block';
    document.getElementById('playerForm').style.display = 'none';
    return;
  }
  noSes.style.display = 'none';
  document.getElementById('playerForm').style.display = '';

  if(players.length === 0){
    list.innerHTML = ''; empty.style.display = 'block'; count.textContent = '';
    warn.style.display = 'none'; btn.disabled = true; return;
  }
  empty.style.display = 'none';

  var html = '';
  players.forEach(function(p){
    var isEditing = (_editingPlayerId === p.id);
    if(isEditing){
      var skMap = {beginner:'b', intermediate:'m', expert:'e'};
      html += '<div class="ptag editing" id="ptag-' + p.id + '">'
        + '<div class="edit-row">'
        + '<input class="edit-name-input" id="edit-name-' + p.id + '" value="' + esc(p.name) + '" maxlength="30" onkeydown="if(event.key===\'Enter\')savePlayerEdit(\'' + p.id + '\');else if(event.key===\'Escape\')cancelPlayerEdit()">'
        + '</div>'
        + '<div class="edit-row">'
        + '<div class="edit-skill-pills" id="edit-skill-' + p.id + '">'
        + ['beginner','intermediate','expert'].map(function(s){
            var cls = 'edit-skill-pills button' + (p.skill===s?' on '+skMap[s]:'');
            return '<button class="' + (p.skill===s?'on '+skMap[s]:'') + '" data-skill="' + s + '" onclick="setEditSkill(\'' + p.id + '\',\'' + s + '\')">' + s.charAt(0).toUpperCase()+s.slice(1) + '</button>';
          }).join('')
        + '</div>'
        + '<button class="edit-bowl-btn' + (p.can_bowl?' on':'') + '" id="edit-bowl-' + p.id + '" onclick="toggleEditBowl(\'' + p.id + '\')">'
        + (p.can_bowl ? '🏏 Bowl' : '🏏 Bowl?') + '</button>'
        + '</div>'
        + '<div class="edit-actions">'
        + '<button class="btn-cancel-sm" onclick="cancelPlayerEdit()">Cancel</button>'
        + '<button class="btn-save-sm" onclick="savePlayerEdit(\'' + p.id + '\')">Save</button>'
        + '</div>'
        + '</div>';
    } else {
      var roleLabel = p.can_bowl ? 'Bat &amp; Bowl' : 'Bat';
      html += '<div class="ptag" id="ptag-' + p.id + '">'
        + '<div class="pleft"><span class="pname">' + esc(p.name) + '</span>'
        + '<span class="sbadge sb-' + p.skill + '">' + p.skill + '</span>'
        + '<span class="sbadge" style="background:rgba(253,246,227,.07);color:var(--muted);border:1px solid var(--cb);font-size:.5rem">' + roleLabel + '</span>'
        + '</div>'
        + '<button class="btnedit" onclick="editPlayer(\'' + p.id + '\')">✎</button>'
        + '<button class="btnrm" onclick="removePlayer(\'' + p.id + '\')">✕</button>'
        + '</div>';
    }
  });
  list.innerHTML = html;

  var b=0, m=0, e=0;
  players.forEach(function(p){
    if(p.skill==='beginner') b++;
    else if(p.skill==='intermediate') m++;
    else e++;
  });
  count.textContent = players.length + ' player' + (players.length!==1?'s':'')
    + ' · ' + b + ' beg · ' + m + ' int · ' + e + ' exp';

  btn.disabled = players.length < 2;

  var viewBtn = document.getElementById('viewTeamsBtn');
  if(teamsData && players.length >= 2){
    viewBtn.style.display = '';
  } else {
    viewBtn.style.display = 'none';
  }

  if(players.length === 1){
    warn.textContent = 'Add at least 2 players to generate teams.';
    warn.style.display = 'block';
  } else if(players.length % 2 !== 0){
    warn.textContent = '⚠️ Odd number (' + players.length + '): one team gets an extra player.';
    warn.style.display = 'block';
  } else {
    warn.style.display = 'none';
  }
}

// ─── Teams ────────────────────────────────────────────────────────────────────
function openGenerateModal(){
  document.getElementById('teamAName').value = '';
  document.getElementById('teamBName').value = '';
  openModal('generateModal');
}

async function makeTeams(){
  if(!currentSessionId || players.length < 2) return;
  var aName = document.getElementById('teamAName').value.trim() || 'Team A';
  var bName = document.getElementById('teamBName').value.trim() || 'Team B';
  closeModal('generateModal');
  loading(true);
  try {
    teamsData = await api('POST', '/sessions/' + currentSessionId + '/teams/generate', { team_a_name: aName, team_b_name: bName });
    renderTeams();
    renderPlayers(); // refresh "View Teams" button visibility
    goTo(2);
  } catch(e){
    toast('Failed: ' + e.message, true);
  } finally {
    loading(false);
  }
}

async function reshuffle(){
  if(!teamsData) return;
  loading(true);
  try {
    var aName = teamsData.team_a_name;
    var bName = teamsData.team_b_name;
    teamsData = await api('POST', '/sessions/' + currentSessionId + '/teams/generate', { team_a_name: aName, team_b_name: bName });
    // Close add-player panel on reshuffle since teams change completely
    document.getElementById('addPlayerForm').classList.add('hidden');
    document.getElementById('addPlayerToggle').classList.remove('open');
    renderTeams();
    toast('Teams reshuffled!');
  } catch(e){
    toast('Failed: ' + e.message, true);
  } finally {
    loading(false);
  }
}

function renderTeams(){
  if(!teamsData) return;
  var aName = teamsData.team_a_name;
  var bName = teamsData.team_b_name;
  var teamA = teamsData.assignments.filter(function(a){ return a.team_name === aName; });
  var teamB = teamsData.assignments.filter(function(a){ return a.team_name === bName; });

  function teamHTML(team, cls, emoji, label){
    var capRow = team.find(function(p){ return p.is_captain; });
    var rows = team.map(function(p){
      return '<div class="trow' + (p.is_captain?' cap':'') + '">'
        + (p.is_captain ? '<span>👑</span>' : '<span style="width:1.1em;display:inline-block"></span>')
        + '<span style="flex:1">' + esc(p.player_name) + '</span>'
        + (p.can_bowl ? '<span class="sbadge sb-bowl" style="margin-right:4px">Bowl</span>' : '')
        + '<span class="sbadge sb-' + p.skill + '">' + p.skill + '</span>'
        + '</div>';
    }).join('');
    return '<div class="tcard ' + cls + '">'
      + '<div class="thead">'
      + '<span class="tname">' + emoji + ' ' + esc(label) + '</span>'
      + (capRow ? '<span class="capbadge">👑 ' + esc(capRow.player_name) + '</span>' : '')
      + '</div>'
      + '<div class="tplayers">' + rows + '</div>'
      + '</div>';
  }

  document.getElementById('tstack').innerHTML =
    teamHTML(teamA, 'ta', '🟢', aName) +
    teamHTML(teamB, 'tb', '🔴', bName);

  // Update the late-player team pick buttons with real names
  document.getElementById('pickA').textContent = '🟢 ' + aName;
  document.getElementById('pickB').textContent = '🔴 ' + bName;
  // Default pick to the smaller team
  lateTeamPick = teamA.length <= teamB.length ? 'a' : 'b';
  selectTeamPick(lateTeamPick);
}

function buildShareText(){
  if(!teamsData) return '';
  var aName = teamsData.team_a_name;
  var bName = teamsData.team_b_name;
  var teamA = teamsData.assignments.filter(function(a){ return a.team_name === aName; });
  var teamB = teamsData.assignments.filter(function(a){ return a.team_name === bName; });
  function fmt(team, label){
    return label + ' (' + team.length + ')\n'
      + team.map(function(p){
          return (p.is_captain ? '👑 ' : '   ') + p.player_name + ' [' + p.skill + (p.can_bowl ? ' · bowl' : '') + ']';
        }).join('\n');
  }
  return '🏏 Cricket Teams\n\n' + fmt(teamA, '🟢 ' + aName) + '\n\n' + fmt(teamB, '🔴 ' + bName);
}

async function shareTeams(){
  if(!teamsData) return;
  var text = buildShareText();
  if(navigator.share){
    try {
      await navigator.share({ text: text });
      return;
    } catch(e){
      if(e.name === 'AbortError') return;
    }
  }
  document.getElementById('shareText').textContent = text;
  openModal('shareModal');
}

function shareWhatsApp(){
  var text = buildShareText();
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}

async function copyShare(){
  var text = document.getElementById('shareText').textContent;
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard!');
    closeModal('shareModal');
  } catch(e){
    toast('Copy failed — select text manually', true);
  }
}

// ─── Can Bowl toggle (step 1) ────────────────────────────────────────────────
function toggleBowl(){
  canBowl = !canBowl;
  document.getElementById('bowlToggle').classList.toggle('on', canBowl);
}

// ─── Late-player bowl toggle (step 2) ────────────────────────────────────────
function toggleLateBowl(){
  lateCanBowl = !lateCanBowl;
  document.getElementById('lateBowlToggle').classList.toggle('on', lateCanBowl);
}

// ─── Add-player panel (step 2) ───────────────────────────────────────────────
function toggleAddPlayerPanel(){
  var form    = document.getElementById('addPlayerForm');
  var toggle  = document.getElementById('addPlayerToggle');
  var isOpen  = !form.classList.contains('hidden');
  form.classList.toggle('hidden', isOpen);
  toggle.classList.toggle('open', !isOpen);
  if(!isOpen) setTimeout(function(){ document.getElementById('latePlayerName').focus(); }, 60);
}

function setLPill(val){
  document.querySelectorAll('#addPlayerForm .skill-pills label').forEach(function(l){ l.classList.remove('checked'); });
  var lbl = document.querySelector('#addPlayerForm .skill-pills label[for="lrb-' + val + '"]');
  if(lbl) lbl.classList.add('checked');
}

function getLSkill(){
  var radios = document.querySelectorAll('input[name="lskill"]');
  for(var i=0;i<radios.length;i++) if(radios[i].checked) return radios[i].value;
  return 'intermediate';
}

function selectTeamPick(side){
  lateTeamPick = side;
  document.getElementById('pickA').classList.toggle('sel', side === 'a');
  document.getElementById('pickB').classList.toggle('sel', side === 'b');
}

async function addLatePlayer(){
  if(!currentSessionId || !teamsData) return;
  var name = document.getElementById('latePlayerName').value.trim();
  if(!name){ toast('Enter a name first!'); return; }
  var skill     = getLSkill();
  var teamName  = lateTeamPick === 'a' ? teamsData.team_a_name : teamsData.team_b_name;
  loading(true);
  try {
    teamsData = await api('POST', '/sessions/' + currentSessionId + '/teams/add_player', {
      name: name, skill: skill, can_bowl: lateCanBowl, team_name: teamName
    });
    // Also add to local players list so step 1 stays in sync
    var pRes = await api('GET', '/sessions/' + currentSessionId + '/players');
    players = pRes;
    document.getElementById('latePlayerName').value = '';
    lateCanBowl = false;
    document.getElementById('lateBowlToggle').classList.remove('on');
    renderTeams();
    toast(name + ' added to ' + teamName + '!');
  } catch(e){
    toast(e.message, true);
  } finally {
    loading(false);
  }
}

// ─── Toss ─────────────────────────────────────────────────────────────────────
async function quickToss(){
  if(!currentSessionId){
    var d = new Date();
    var label = d.toLocaleDateString('en-GB', {day:'numeric', month:'short'});
    try {
      var s = await api('POST', '/sessions', { name: 'Quick Toss – ' + label });
      currentSessionId = s.id;
      localStorage.setItem(LS_KEY, s.id);
      _addGuestId(s.id);
      players = [];
      teamsData = null;
      await loadSessions();
      document.getElementById('sessionSelect').value = s.id;
    } catch(e){
      toast('Could not create session: ' + e.message, true);
      return;
    }
  }
  goTo(3);
}

async function tossCoin(){
  if(tossing || !currentSessionId) return;
  tossing = true;
  var coin = document.getElementById('coin');
  var res  = document.getElementById('tres');
  var sub  = document.getElementById('tsub');
  res.classList.remove('show');
  sub.textContent = '';
  coin.style.animation = 'none';
  void coin.offsetWidth;

  // Reset decision UI
  lastTossId = null; tossWinner = null;
  var dec = document.getElementById('tdecision');
  dec.classList.remove('show');
  document.getElementById('tdresult').textContent = '';
  document.getElementById('tdelectlabel').style.display = 'none';
  document.getElementById('tdelect').style.display = 'none';
  document.querySelectorAll('#tdteams .tdbtn').forEach(function(b){ b.classList.remove('sel'); });
  document.querySelectorAll('#tdelect .tdbtn').forEach(function(b){ b.classList.remove('sel'); });

  try {
    var data = await api('POST', '/sessions/' + currentSessionId + '/toss');
    tossN = data.toss_number;
    lastTossId = data.id;
    var out = data.result;
    void coin.offsetWidth;
    coin.style.animation = 'cspin-' + out + ' 1.5s cubic-bezier(.25,.1,.25,1) forwards';
    setTimeout(function(){
      res.textContent = out === 'heads' ? '🌟 HEADS' : '🌑 TAILS';
      res.className = 'tres ' + out + ' show';
      sub.textContent = out === 'heads' ? 'Bright side up!' : 'Dark side up!';
      var hist = document.getElementById('thist');
      var row = document.createElement('div');
      row.className = 'thist-row';
      row.setAttribute('data-toss-id', data.id);
      row.innerHTML = '<span>Toss #' + tossN + '</span>'
        + '<span style="color:' + (out==='heads'?'var(--gold)':'#c8a96e') + '">' + out.toUpperCase() + '</span>';
      hist.insertBefore(row, hist.firstChild);

      // Populate winner buttons with actual team names
      var nameA = (teamsData && teamsData.team_a_name) ? teamsData.team_a_name : 'Team A';
      var nameB = (teamsData && teamsData.team_b_name) ? teamsData.team_b_name : 'Team B';
      document.getElementById('tdwinA').textContent = nameA;
      document.getElementById('tdwinB').textContent = nameB;
      dec.classList.add('show');

      tossing = false;
    }, 1550);
  } catch(e){
    toast('Toss failed: ' + e.message, true);
    tossing = false;
  }
}

function selectTossWinner(side){
  tossWinner = side;
  document.getElementById('tdwinA').classList.toggle('sel', side === 'a');
  document.getElementById('tdwinB').classList.toggle('sel', side === 'b');
  document.getElementById('tdelectlabel').style.display = '';
  document.getElementById('tdelect').style.display = '';
  document.querySelectorAll('#tdelect .tdbtn').forEach(function(b){ b.classList.remove('sel'); });
  document.getElementById('tdresult').textContent = '';
}

async function selectTossElect(choice){
  if(!lastTossId || !tossWinner) return;
  var btns = document.querySelectorAll('#tdelect .tdbtn');
  btns.forEach(function(b){ b.classList.toggle('sel', b.textContent.toLowerCase().includes(choice)); });

  var winnerName = tossWinner === 'a'
    ? document.getElementById('tdwinA').textContent
    : document.getElementById('tdwinB').textContent;

  try {
    await api('PATCH', '/sessions/' + currentSessionId + '/toss/' + lastTossId, {
      winner_team: winnerName,
      elected_to: choice
    });
    var label = choice === 'bat' ? 'bat first' : 'field first';
    document.getElementById('tdresult').textContent = winnerName + ' elected to ' + label + ' ✓';

    // Update the latest history row
    var hist = document.getElementById('thist');
    var latest = hist.querySelector('[data-toss-id="' + lastTossId + '"]');
    if(latest){
      var existing = latest.innerHTML;
      latest.innerHTML = existing
        + '<span style="color:#74d494;margin-left:auto">' + winnerName + ' → ' + (choice==='bat'?'BAT':'FIELD') + '</span>';
    }
  } catch(e){
    toast('Could not save decision: ' + e.message, true);
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function goTo(n){
  for(var i=1;i<=3;i++){
    document.getElementById('sec'+i).classList.toggle('on', i===n);
    document.getElementById('sn'+i).className = 'snum'+(i===n?' on':i<n?' done':'');
    document.getElementById('sl'+i).className = 'slabel'+(i===n?' on':'');
  }
  // Step 4 (Score) is a separate page — mark it done only if on step 3
  if(document.getElementById('sn4')){
    document.getElementById('sn4').className = 'snum';
    document.getElementById('sl4').className = 'slabel';
  }
  window.scrollTo({top:0,behavior:'smooth'});
}

function goToScore(){
  // Navigate to /score, passing current session and team info via query params
  if(!currentSessionId){ toast('Select a match first', true); return; }
  var params = new URLSearchParams({ session: currentSessionId });
  var selEl = document.getElementById('sessionSelect');
  if(selEl && selEl.options[selEl.selectedIndex]){
    params.set('name', selEl.options[selEl.selectedIndex].text);
  }
  if(teamsData){
    params.set('teamA', teamsData.team_a_name || 'Team A');
    params.set('teamB', teamsData.team_b_name || 'Team B');
  }
  params.set('overs', '6');
  window.location.href = '/score?' + params.toString();
}

// ─── Confirm helpers ──────────────────────────────────────────────────────────
function confirmNewMatch(){
  document.getElementById('confirmTitle').textContent = 'New Match?';
  document.getElementById('confirmMsg').textContent = 'This will clear toss history and take you back to step 1. Players are kept.';
  document.getElementById('confirmOk').style.background = 'var(--grass)';
  document.getElementById('confirmOk').textContent = 'Continue';
  document.getElementById('confirmOk').onclick = function(){
    closeModal('confirmModal');
    tossN = 0; tossing = false; lastTossId = null; tossWinner = null;
    document.getElementById('thist').innerHTML = '';
    document.getElementById('tres').className = 'tres';
    document.getElementById('tsub').textContent = '';
    document.getElementById('tdecision').classList.remove('show');
    document.getElementById('tdresult').textContent = '';
    goTo(1);
  };
  openModal('confirmModal');
}

// ─── Skill pills ─────────────────────────────────────────────────────────────
function setPill(val){
  document.querySelectorAll('.skill-pills label').forEach(function(l){ l.classList.remove('checked'); });
  var lbl = document.querySelector('.skill-pills label[for="rb-' + val + '"]');
  if(lbl) lbl.classList.add('checked');
}

function getSkill(){
  var radios = document.querySelectorAll('input[name="skill"]');
  for(var i=0;i<radios.length;i++) if(radios[i].checked) return radios[i].value;
  return 'intermediate';
}

// ─── Modals ───────────────────────────────────────────────────────────────────
function openNewSessionModal(){
  document.getElementById('newSessionName').value = '';
  openModal('newSessionModal');
  setTimeout(function(){ document.getElementById('newSessionName').focus(); }, 50);
}

function openRenameModal(){
  if(!currentSessionId) return;
  var sel = document.getElementById('sessionSelect');
  var currentName = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
  var inp = document.getElementById('renameSessionName');
  inp.value = currentName;
  openModal('renameSessionModal');
  setTimeout(function(){ inp.focus(); inp.select(); }, 50);
}

async function renameSession(){
  var name = document.getElementById('renameSessionName').value.trim();
  if(!name) return;
  closeModal('renameSessionModal');
  loading(true);
  try {
    var updated = await api('PATCH', '/sessions/' + currentSessionId, { name: name });
    // update the dropdown option text in place
    var sel = document.getElementById('sessionSelect');
    for(var i = 0; i < sel.options.length; i++){
      if(sel.options[i].value === currentSessionId){
        sel.options[i].text = updated.name;
        break;
      }
    }
    toast('Match renamed!');
  } catch(e){
    toast('Failed to rename: ' + e.message, true);
  } finally {
    loading(false);
  }
}
function openModal(id){ document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-bg').forEach(function(bg){
  bg.addEventListener('click', function(e){ if(e.target === bg) bg.classList.remove('open'); });
});

// ─── Misc ─────────────────────────────────────────────────────────────────────
var toastTimer;
function toast(msg, isError){
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 2500);
}

function loading(on){ document.getElementById('loader').classList.toggle('on', on); }

function esc(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(iso){
  var d = new Date(iso);
  return d.toLocaleDateString(undefined, { month:'short', day:'numeric' });
}

// ─── Service Worker ───────────────────────────────────────────────────────────
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/static/sw.js').catch(function(e){ console.warn('SW:', e); });
}
