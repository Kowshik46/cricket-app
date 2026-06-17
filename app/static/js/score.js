// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

const cfg = {               // set on startMatch()
  overs: 6,
  maxWickets: 5,
  rules: { wide_extra: true, nb_extra: true, free_hit: true },
  team1: 'Team A',
  team2: 'Team B',
};

let matchState = {
  matchId: null,
  inningsId: null,
  inningsNum: 1,            // 1 or 2
  scorecard: null,
  nextBallIsFreeHit: false, // set after a no-ball when free_hit rule is on
  inn1Score: null,          // { runs, wickets, overs } — stored after innings 1
};

// rule toggles (UI state)
const ruleToggles = { wide_extra: true, nb_extra: true, free_hit: true };

// modal pick state
let _wideRuns = 0, _nbRuns = 0, _byeRuns = 1, _byeType = 'bye', _wicketType = null;

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

async function api(method, path, body) {
  const opts = { method, headers: {'Content-Type':'application/json'} };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch('/api' + path, opts);
  if (!r.ok) {
    const e = await r.json().catch(() => ({detail: r.statusText}));
    throw new Error(e.detail || r.statusText);
  }
  if (r.status === 204) return null;
  return r.json();
}

function toast(msg, isErr = false) {
  const el = document.getElementById('toastEl');
  el.textContent = msg;
  el.className = 'toast' + (isErr ? ' error' : '');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
  document.getElementById(id).classList.add('on');
  document.querySelectorAll('.bottom-bar').forEach(b => b.style.display = 'none');
  const bar = document.getElementById('bar-' + id);
  if (bar) bar.style.display = 'flex';
  window.scrollTo({top:0, behavior:'smooth'});
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ═══════════════════════════════════════════════════════════════
// SETUP VIEW
// ═══════════════════════════════════════════════════════════════

function onPlayersChange() {
  const p = parseInt(document.getElementById('playersInput').value) || 1;
  const w = Math.max(1, p - 1);
  document.getElementById('wicketsInput').value = w;
}

function toggleRule(key) {
  ruleToggles[key] = !ruleToggles[key];
  const map = { wide_extra: 'tgl-wide', nb_extra: 'tgl-nb', free_hit: 'tgl-fh' };
  document.getElementById(map[key]).classList.toggle('on', ruleToggles[key]);
}

// Pre-populate from query params (coming from index.html)
(function initSetup() {
  const p = new URLSearchParams(location.search);
  if (p.get('name'))  document.getElementById('matchName').value = p.get('name');
  if (p.get('teamA')) document.getElementById('team1Name').value = p.get('teamA');
  if (p.get('teamB')) document.getElementById('team2Name').value = p.get('teamB');
  if (p.get('overs')) document.getElementById('oversInput').value = p.get('overs');
  // default toggles ON
  ['tgl-wide','tgl-nb','tgl-fh'].forEach(id => document.getElementById(id).classList.add('on'));
})();

async function startMatch() {
  const team1 = document.getElementById('team1Name').value.trim() || 'Team A';
  const team2 = document.getElementById('team2Name').value.trim() || 'Team B';
  const overs  = Math.max(1, parseInt(document.getElementById('oversInput').value) || 6);
  const maxWkt = Math.max(1, parseInt(document.getElementById('wicketsInput').value) || 5);
  const sessionId = new URLSearchParams(location.search).get('session') || null;

  cfg.overs      = overs;
  cfg.maxWickets = maxWkt;
  cfg.team1      = team1;
  cfg.team2      = team2;
  cfg.rules      = { ...ruleToggles };

  // Build rules object for backend
  const rules = {
    wide_runs:              cfg.rules.wide_extra ? 1 : 0,
    wide_counts_as_ball:    false,
    wide_reball:            true,
    no_ball_runs:           cfg.rules.nb_extra ? 1 : 0,
    no_ball_counts_as_ball: false,
    no_ball_reball:         true,
    free_hit_enabled:       cfg.rules.free_hit,
    free_hit_dismissals:    'run_out',
    wicket_types:           ['bowled','caught','run_out','lbw','stumped','hit_wicket'],
    last_man_standing:      false,
    retirement_runs:        null,
    boundary_four:          4,
    boundary_six:           6,
  };

  try {
    const match = await api('POST', '/matches', {
      session_id: sessionId,
      match_type: 'quick',
      overs,
      players_per_side: parseInt(document.getElementById('playersInput').value) || 6,
      rules_preset: 'custom',
      rules,
    });
    matchState.matchId = match.id;
    matchState.inningsNum = 1;
    matchState.nextBallIsFreeHit = false;
    matchState.inn1Score = null;

    const inn = await api('POST', `/matches/${match.id}/innings`, {
      batting_team: team1,
      bowling_team: team2,
    });
    matchState.inningsId = inn.id;
    matchState.scorecard = null;

    showView('viewScoring');
    updateScoringHeader();
    await refreshScorecard();
  } catch(e) {
    toast(e.message, true);
  }
}

// ═══════════════════════════════════════════════════════════════
// SCORING VIEW
// ═══════════════════════════════════════════════════════════════

function updateScoringHeader() {
  const isSecond = matchState.inningsNum === 2;
  const batting  = isSecond ? cfg.team2 : cfg.team1;
  document.getElementById('battingLabel').textContent = batting + ' batting';
  const badge = document.getElementById('innBadge');
  badge.textContent = isSecond ? '2nd Inn' : '1st Inn';
  badge.className = 'inn-badge ' + (isSecond ? 'second' : 'first');

  if (isSecond && matchState.inn1Score) {
    const target = matchState.inn1Score.runs + 1;
    document.getElementById('statTargetWrap').style.display = '';
    document.getElementById('statTarget').textContent = target;
    document.getElementById('statRRRWrap').style.display = '';
    document.getElementById('chaseBar').classList.add('show');
  }
}

async function refreshScorecard() {
  if (!matchState.inningsId) return;
  try {
    const sc = await api('GET', `/matches/${matchState.matchId}/innings/${matchState.inningsId}/scorecard`);
    matchState.scorecard = sc;
    renderBoard(sc);
  } catch(e) { /* ignore on first load */ }
}

async function postBall(body) {
  // Tag free-hit if active
  if (matchState.nextBallIsFreeHit) {
    body.metadata = { ...( body.metadata || {}), free_hit: true };
  }

  try {
    const sc = await api('POST', `/matches/${matchState.matchId}/innings/${matchState.inningsId}/ball`, body);
    matchState.scorecard = sc;

    // Free-hit consumed — clear it (unless this ball was itself a no-ball, which re-arms it)
    const wasNoBall = body.event_type === 'no_ball';
    if (!wasNoBall) matchState.nextBallIsFreeHit = false;
    // If this no-ball has free-hit rule on, next ball is free hit
    if (wasNoBall && cfg.rules.free_hit) matchState.nextBallIsFreeHit = true;

    setFreehitBanner(matchState.nextBallIsFreeHit);
    renderBoard(sc);
    checkInningsEnd(sc);
  } catch(e) {
    toast(e.message, true);
  }
}

function setFreehitBanner(show) {
  document.getElementById('freehitBanner').classList.toggle('show', show);
}

// ── render ───────────────────────────────────────────────────

function renderBoard(sc) {
  document.getElementById('scoreRuns').textContent    = sc.total_runs;
  document.getElementById('scoreWickets').textContent = sc.total_wickets;
  document.getElementById('scoreOvers').textContent   = `${sc.total_overs} / ${cfg.overs} overs`;
  document.getElementById('statRR').textContent       = sc.run_rate.toFixed(2);

  // Chase stats
  if (matchState.inningsNum === 2 && matchState.inn1Score) {
    const target   = matchState.inn1Score.runs + 1;
    const needed   = target - sc.total_runs;
    const legalB   = sc.balls.filter(isLegal).length;
    const ballsLeft = cfg.overs * 6 - legalB;
    const rrr      = ballsLeft > 0 && needed > 0 ? (needed / (ballsLeft / 6)).toFixed(2) : '0.00';
    document.getElementById('statRRR').textContent = rrr;
    document.getElementById('chaseTxt').textContent = `Need ${needed} more in ${ballsLeft} balls`;
    document.getElementById('chaseRRR').textContent = `RRR ${rrr}`;
  }

  renderBallsStrip(sc.balls);
  renderOverRows(sc.balls);
  renderLastOver(sc.balls);
}

function ballClass(b) {
  if (b.event_type === 'wicket')  return 'wkt';
  if (b.boundary_type === 'six')  return 'six';
  if (b.boundary_type === 'four') return 'four';
  if (b.event_type === 'wide')    return 'wide';
  if (b.event_type === 'no_ball') return 'nb';
  if (b.event_type === 'bye' || b.event_type === 'leg_bye') return 'bye';
  if (b.runs === 0 && b.extras === 0) return 'dot';
  return 'run';
}

function ballLabel(b) {
  if (b.event_type === 'wicket')   return 'W';
  if (b.event_type === 'wide')     return 'Wd';
  if (b.event_type === 'no_ball')  return 'Nb';
  if (b.event_type === 'bye')      return b.extras > 0 ? `B${b.extras}` : 'B';
  if (b.event_type === 'leg_bye')  return b.extras > 0 ? `Lb${b.extras}` : 'Lb';
  if (b.runs === 0) return '·';
  return String(b.runs);
}

function isFreeHitBall(b) {
  return b.metadata && b.metadata.free_hit;
}

function isLegal(b) { return b.is_legal_ball === true || b.is_legal_ball === 'true'; }

function renderBallsStrip(balls) {
  const el = document.getElementById('ballsStrip');
  const recent = balls.slice(-12);
  if (!recent.length) {
    el.innerHTML = '<span class="no-balls-msg">No balls yet — tap to score</span>';
  } else {
    el.innerHTML = recent.map(b => {
      const fh = isFreeHitBall(b) ? ' fh' : '';
      return `<div class="bchip ${ballClass(b)}${fh}" title="${b.event_type}">${ballLabel(b)}</div>`;
    }).join('');
  }
  const legal = balls.filter(isLegal).length;
  document.getElementById('overLbl').textContent =
    `Over ${Math.floor(legal / 6) + 1} · Ball ${legal % 6}`;
}

function renderOverRows(balls) {
  const el = document.getElementById('overRows');
  if (!balls.length) { el.innerHTML = '<div class="empty">No overs yet</div>'; return; }

  const overs = {};
  for (const b of balls) {
    if (!overs[b.over_number]) overs[b.over_number] = [];
    overs[b.over_number].push(b);
  }

  el.innerHTML = Object.entries(overs).map(([ov, obs]) => {
    const ovRuns = obs.reduce((s,b) => s + b.runs + b.extras, 0);
    const bHtml  = obs.map(b => {
      let cls = 'run';
      if (b.event_type === 'wicket')  cls = 'wkt';
      else if (b.boundary_type === 'six')  cls = 'six';
      else if (b.boundary_type === 'four') cls = 'four';
      else if (b.runs === 0 && b.extras === 0) cls = 'dot';
      else if (['wide','no_ball','bye','leg_bye'].includes(b.event_type)) cls = 'ext';
      const fh = isFreeHitBall(b) ? ' fh' : '';
      return `<div class="ob ${cls}${fh}">${ballLabel(b)}</div>`;
    }).join('');
    return `<div class="over-row">
      <span class="ov-num">Ov ${parseInt(ov)+1}</span>
      <div class="ov-balls">${bHtml}</div>
      <span class="ov-runs">${ovRuns}</span>
    </div>`;
  }).join('');
}

function renderLastOver(balls) {
  const el = document.getElementById('statLastOv');
  if (!balls.length) { el.textContent = '—'; return; }
  const legal = balls.filter(isLegal).length;
  // A completed over exists only if at least 6 legal balls have been bowled
  const completedOvers = Math.floor(legal / 6);
  if (completedOvers === 0) { el.textContent = '—'; return; }
  // The last completed over is index (completedOvers - 1)
  const lastOvNum = completedOvers - 1;
  const ovBalls = balls.filter(b => b.over_number === lastOvNum);
  el.textContent = ovBalls.reduce((s, b) => s + b.runs + b.extras, 0);
}

// ── innings-end detection ────────────────────────────────────

function checkInningsEnd(sc) {
  const legal = sc.balls.filter(isLegal).length;
  const allOut = sc.total_wickets >= cfg.maxWickets;
  const oversDone = legal >= cfg.overs * 6;

  // 2nd innings win condition: chasing team passes target
  if (matchState.inningsNum === 2 && matchState.inn1Score) {
    const target = matchState.inn1Score.runs + 1;
    if (sc.total_runs >= target) { finishMatch(sc); return; }
  }

  if (allOut || oversDone) {
    if (matchState.inningsNum === 1) {
      autoEndFirstInnings(sc);
    } else {
      finishMatch(sc);
    }
  }
}

// ─── confirm / manual end innings ───────────────────────────

function confirmEndInnings() {
  const sc = matchState.scorecard;
  const legal = sc ? sc.balls.filter(isLegal).length : 0;
  const left  = cfg.overs * 6 - legal;
  document.getElementById('endInnMsg').textContent =
    left > 0 ? `${left} ball${left!==1?'s':''} remaining. End innings early?`
             : 'All overs bowled.';
  openModal('endInnModal');
}

function endInnings() {
  closeModal('endInnModal');
  const sc = matchState.scorecard;
  if (matchState.inningsNum === 1) autoEndFirstInnings(sc);
  else finishMatch(sc);
}

async function autoEndFirstInnings(sc) {
  try {
    await api('POST', `/matches/${matchState.matchId}/innings/${matchState.inningsId}/complete`);
  } catch(e) { /* ignore */ }

  matchState.inn1Score = { runs: sc.total_runs, wickets: sc.total_wickets, overs: sc.total_overs };
  const target = sc.total_runs + 1;

  document.getElementById('breakScore').textContent = `${sc.total_runs}/${sc.total_wickets}`;
  document.getElementById('breakSub').textContent   = `${sc.total_overs} overs · RR ${sc.run_rate.toFixed(2)}`;
  document.getElementById('breakTarget').textContent = `Target: ${target} runs in ${cfg.overs} overs`;

  // Pre-fill 2nd innings — swap batting/bowling
  document.getElementById('bat2Name').value = cfg.team2;
  document.getElementById('bow2Name').value = cfg.team1;

  showView('viewInnBreak');
}

async function startSecondInnings() {
  const bat = document.getElementById('bat2Name').value.trim() || cfg.team2;
  const bow = document.getElementById('bow2Name').value.trim() || cfg.team1;

  try {
    const inn = await api('POST', `/matches/${matchState.matchId}/innings`, {
      batting_team: bat,
      bowling_team: bow,
    });
    matchState.inningsId = inn.id;
    matchState.inningsNum = 2;
    matchState.scorecard  = null;
    matchState.nextBallIsFreeHit = false;

    setFreehitBanner(false);
    showView('viewScoring');
    updateScoringHeader();
    await refreshScorecard();
  } catch(e) {
    toast(e.message, true);
  }
}

// ─── match finish ────────────────────────────────────────────

async function finishMatch(sc) {
  try {
    await api('POST', `/matches/${matchState.matchId}/innings/${matchState.inningsId}/complete`);
  } catch(e) { /* ignore */ }

  const s1 = matchState.inn1Score;
  const s2 = { runs: sc.total_runs, wickets: sc.total_wickets, overs: sc.total_overs };

  let title = 'Match Complete', sub = '', trophy = '🏆';
  if (s1) {
    const diff = s2.runs - s1.runs;
    if (diff > 0) {
      const wleft = cfg.maxWickets - s2.wickets;
      title = `${cfg.team2} won!`;
      sub   = `by ${wleft} wicket${wleft!==1?'s':''}`;
    } else if (diff < 0) {
      title = `${cfg.team1} won!`;
      sub   = `by ${Math.abs(diff)} run${Math.abs(diff)!==1?'s':''}`;
    } else {
      title = 'Match Tied!'; sub = 'What a game!'; trophy = '🤝';
    }
  }

  document.getElementById('resultTrophy').textContent = trophy;
  document.getElementById('resultTitle').textContent  = title;
  document.getElementById('resultSub').textContent    = sub;

  const t1Label = cfg.team1;
  const t2Label = cfg.team2;
  document.getElementById('resultScores').innerHTML = `
    <div class="result-row">
      <span class="result-team">${t1Label} <small style="opacity:.6">(1st Inn)</small></span>
      <span class="result-score">${s1 ? s1.runs+'/'+s1.wickets : '—'}</span>
    </div>
    <div class="result-row">
      <span class="result-team">${t2Label} <small style="opacity:.6">(2nd Inn)</small></span>
      <span class="result-score">${s2.runs}/${s2.wickets}</span>
    </div>
  `;

  showView('viewResult');
}

// ═══════════════════════════════════════════════════════════════
// BALL RECORDING
// ═══════════════════════════════════════════════════════════════

function recordRuns(n) {
  postBall({
    event_type:    n === 0 ? 'dot' : 'runs',
    runs:          n,
    is_boundary:   n === 4 || n === 6,
    boundary_type: n === 4 ? 'four' : (n === 6 ? 'six' : null),
  });
}

// ── Wide ─────────────────────────────────────────────────────
function openWideModal() {
  _wideRuns = 0;
  buildPickBtns('wideRunBtns', [0,1,2,3,4], _wideRuns, v => { _wideRuns = v; }, n => '+'+n);
  openModal('wideModal');
}
function submitWide() {
  closeModal('wideModal');
  postBall({ event_type: 'wide', runs: _wideRuns, extra_type: 'wide' });
}

// ── No Ball ──────────────────────────────────────────────────
function openNoBallModal() {
  _nbRuns = 0;
  buildPickBtns('nbRunBtns', [0,1,2,3,4,6], _nbRuns, v => { _nbRuns = v; }, n => '+'+n);
  openModal('noBallModal');
}
function submitNoBall() {
  closeModal('noBallModal');
  postBall({ event_type: 'no_ball', runs: _nbRuns, extra_type: 'no_ball' });
}

// ── Bye / Leg Bye ─────────────────────────────────────────────
function openByeModal(type) {
  _byeType = type;
  _byeRuns = 1;
  document.getElementById('byeTitle').textContent = type === 'bye' ? 'Bye' : 'Leg Bye';
  buildPickBtns('byeRunBtns', [1,2,3,4], _byeRuns, v => { _byeRuns = v; }, n => String(n));
  openModal('byeModal');
}
function submitBye() {
  closeModal('byeModal');
  postBall({ event_type: _byeType, runs: _byeRuns, extra_type: _byeType });
}

// ── Wicket ────────────────────────────────────────────────────
function openWicketModal() {
  _wicketType = null;
  const isFH  = matchState.nextBallIsFreeHit;
  const types = isFH
    ? ['run_out']
    : ['bowled','caught','run_out','lbw','stumped','hit_wicket'];
  const labels = {bowled:'Bowled', caught:'Caught', run_out:'Run Out', lbw:'LBW', stumped:'Stumped', hit_wicket:'Hit Wkt'};

  document.getElementById('wktGrid').innerHTML = types.map(w =>
    `<button class="wkt-btn" onclick="selectWicket('${w}')">${labels[w]}</button>`
  ).join('');
  document.getElementById('freehitWktNote').style.display = isFH ? '' : 'none';
  openModal('wicketModal');
}
function selectWicket(w) {
  _wicketType = w;
  document.querySelectorAll('.wkt-btn').forEach(b =>
    b.classList.toggle('on', b.onclick && b.onclick.toString().includes(`'${w}'`))
  );
}
function submitWicket() {
  closeModal('wicketModal');
  postBall({ event_type: 'wicket', runs: 0, wicket_type: _wicketType });
}

// ── Undo ──────────────────────────────────────────────────────
async function undoLast() {
  if (!matchState.inningsId) return;
  try {
    const sc = await api('POST', `/matches/${matchState.matchId}/innings/${matchState.inningsId}/undo`);
    matchState.scorecard = sc;
    // If last ball was a no-ball we had armed free-hit — undo clears it
    matchState.nextBallIsFreeHit = false;
    setFreehitBanner(false);
    renderBoard(sc);
    toast('Last ball undone');
  } catch(e) {
    toast(e.message, true);
  }
}

// ═══════════════════════════════════════════════════════════════
// SCORECARD VIEW
// ═══════════════════════════════════════════════════════════════

function viewScorecard() {
  const sc = matchState.scorecard;
  if (!sc) { toast('No scorecard yet'); return; }

  const ovHtml = (() => {
    if (!sc.balls.length) return '<div class="empty">No balls recorded</div>';
    const overs = {};
    for (const b of sc.balls) {
      if (!overs[b.over_number]) overs[b.over_number] = [];
      overs[b.over_number].push(b);
    }
    return Object.entries(overs).map(([ov, obs]) => {
      const ovRuns = obs.reduce((s,b) => s + b.runs + b.extras, 0);
      const bHtml  = obs.map(b => {
        let cls = 'run';
        if (b.event_type === 'wicket')  cls = 'wkt';
        else if (b.boundary_type === 'six')  cls = 'six';
        else if (b.boundary_type === 'four') cls = 'four';
        else if (b.runs === 0 && b.extras === 0) cls = 'dot';
        else if (['wide','no_ball','bye','leg_bye'].includes(b.event_type)) cls = 'ext';
        const fh = isFreeHitBall(b) ? ' fh' : '';
        return `<div class="ob ${cls}${fh}" title="${isFreeHitBall(b)?'Free Hit':''}">${ballLabel(b)}</div>`;
      }).join('');
      return `<div class="over-row">
        <span class="ov-num">Ov ${parseInt(ov)+1}</span>
        <div class="ov-balls">${bHtml}</div>
        <span class="ov-runs">${ovRuns}</span>
      </div>`;
    }).join('');
  })();

  document.getElementById('scorecardContent').innerHTML = `
    <div class="ctitle">Scorecard</div>
    <div style="font-family:'DM Mono',monospace;font-size:.68rem;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:4px">
      ${sc.innings.batting_team} · ${matchState.inningsNum === 1 ? '1st' : '2nd'} Innings
    </div>
    <div style="font-family:'Playfair Display',serif;font-size:2rem;font-weight:900;margin-bottom:2px">
      ${sc.total_runs}/${sc.total_wickets}
    </div>
    <div style="font-family:'DM Mono',monospace;font-size:.72rem;color:var(--muted);margin-bottom:14px">
      ${sc.total_overs} overs · RR ${sc.run_rate.toFixed(2)}${sc.target ? ' · Target ' + sc.target : ''}
    </div>
    <div class="hr" style="margin:10px 0"></div>
    <div style="font-family:'DM Mono',monospace;font-size:.62rem;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Ball by Ball</div>
    <div class="over-rows" style="max-height:none">${ovHtml}</div>
  `;
  showView('viewScorecard');
}

function backToScoring() { showView('viewScoring'); }

// ═══════════════════════════════════════════════════════════════
// PICK-BUTTON HELPER
// ═══════════════════════════════════════════════════════════════

function buildPickBtns(containerId, values, initial, setter, labelFn) {
  const el = document.getElementById(containerId);
  el.innerHTML = values.map(v =>
    `<button class="pick-btn${v === initial ? ' on' : ''}" onclick="pickVal('${containerId}',${v})">${labelFn(v)}</button>`
  ).join('');
  el._setter = setter;
}

function pickVal(containerId, v) {
  const el = document.getElementById(containerId);
  el.querySelectorAll('.pick-btn').forEach(b => b.classList.remove('on'));
  // find the right button by its text value matching label
  el.querySelectorAll('.pick-btn').forEach(b => {
    if (b.onclick && b.onclick.toString().includes(`,${v})`)) b.classList.add('on');
  });
  if (el._setter) el._setter(v);
}

// ═══════════════════════════════════════════════════════════════
// RESET
// ═══════════════════════════════════════════════════════════════

function resetToSetup() {
  matchState = { matchId:null, inningsId:null, inningsNum:1, scorecard:null,
                 nextBallIsFreeHit:false, inn1Score:null };
  document.getElementById('team1Name').value = '';
  document.getElementById('team2Name').value = '';
  document.getElementById('statTargetWrap').style.display = 'none';
  document.getElementById('statRRRWrap').style.display = 'none';
  document.getElementById('chaseBar').classList.remove('show');
  setFreehitBanner(false);
  showView('viewSetup');
}
