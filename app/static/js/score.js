// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

// Detect team-linked mode from URL before anything else runs
const _urlParams = new URLSearchParams(location.search);
const isTeamLinked = !!_urlParams.get('match_id');

const cfg = {               // set on startMatch()
  overs: 6,
  maxWickets: 5,
  playersPerSide: 6,
  matchNum: 1,
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
  // Team-linked additions (null in quick mode)
  battingTeamPlayers: [],   // [{id, name, can_bowl, bowl_type}]
  bowlingTeamPlayers: [],   // [{id, name, can_bowl, bowl_type}]
  currentStrikerId: null,
  currentNonStrikerId: null,
  currentBowlerId: null,
  currentOverNumber: 0,
  pendingBatterId: null,    // set after wicket modal; consumed on next ball
  _pendingBat: null,        // batting team name for next innings create
  _pendingBow: null,
  _openingBowlType: 'legal',
  _newBowlType: 'legal',
  _selectedBowlerId: null,
  _forOver: 0,
};

// rule toggles (UI state)
const ruleToggles = { wide_extra: true, nb_extra: true, free_hit: true };

// share / watch
let _watchCode = null;

// modal pick state
let _wideRuns = 0, _nbRuns = 0, _byeRuns = 1, _byeType = 'bye', _wicketType = null;
let _runOutTarget = 'striker';      // 'striker' | 'non_striker'
let _newBatterPosition = 'striker'; // which end the incoming batter fills
let _pendingNonStrikerId = null;    // piggybacked onto next ball metadata after non-striker run-out
let _openingPairSubmitting = false; // guard against double-tap on "Start Innings"

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

// ── Share / Watch helpers ──────────────────────────────────────────────────
let _qrInstance = null;

function _setWatchCode(code) {
  _watchCode = code || null;
  const btn = document.getElementById('btnShare');
  if (btn) btn.style.display = _watchCode ? '' : 'none';
}

function openShareModal() {
  if (!_watchCode) { toast('No active match to share', true); return; }
  const url = window.location.origin + '/watch?code=' + _watchCode;
  document.getElementById('shareCodeDisplay').textContent = _watchCode;
  document.getElementById('shareLinkInput').value = url;

  const qrWrap = document.getElementById('shareQrWrap');
  qrWrap.innerHTML = '';
  _qrInstance = new QRCode(qrWrap, {
    text: url,
    width: 200,
    height: 200,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.H,
  });

  openModal('shareMatchModal');
}

function copyShareLink() {
  const url = document.getElementById('shareLinkInput').value;
  navigator.clipboard.writeText(url)
    .then(() => toast('Link copied!'))
    .catch(() => {
      const inp = document.getElementById('shareLinkInput');
      inp.select();
      document.execCommand('copy');
      toast('Link copied!');
    });
}
// ─────────────────────────────────────────────────────────────────────────────

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

function buildRulesObject(extra = {}) {
  return {
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
    ...extra,
  };
}

// Pre-populate from query params (or from match record when team-linked)
(async function initSetup() {
  const p = _urlParams;
  if (p.get('name'))  document.getElementById('matchName').value = p.get('name');
  if (p.get('teamA')) document.getElementById('team1Name').value = p.get('teamA');
  if (p.get('teamB')) document.getElementById('team2Name').value = p.get('teamB');
  if (p.get('overs')) document.getElementById('oversInput').value = p.get('overs');
  // default toggles ON
  ['tgl-wide','tgl-nb','tgl-fh'].forEach(id => document.getElementById(id).classList.add('on'));

  if (isTeamLinked) {
    await loadTeamLinkedSetup();
  }
})();

async function startMatch() {
  const team1 = document.getElementById('team1Name').value.trim() || 'Team A';
  const team2 = document.getElementById('team2Name').value.trim() || 'Team B';
  const overs  = Math.max(1, parseInt(document.getElementById('oversInput').value) || 6);
  const maxWkt = Math.max(1, parseInt(document.getElementById('wicketsInput').value) || 5);

  cfg.overs          = overs;
  cfg.maxWickets     = maxWkt;
  cfg.team1          = team1;
  cfg.team2          = team2;
  cfg.rules          = { ...ruleToggles };
  cfg.playersPerSide = parseInt(document.getElementById('playersInput').value) || 6;

  if (isTeamLinked) {
    const maxBowlerOvers = parseInt(document.getElementById('maxBowlerOversInput').value) || null;
    const maxThrowOvers  = parseInt(document.getElementById('maxThrowOversInput').value);
    const throwCap       = isNaN(maxThrowOvers) ? null : (maxThrowOvers || null);
    const rules = buildRulesObject({
      max_overs_per_bowler:   maxBowlerOvers,
      max_throw_overs_per_team: throwCap,
    });
    try {
      await api('PATCH', `/matches/${matchState.matchId}/rules`, { rules });
    } catch(e) {
      toast(e.message, true); return;
    }
    matchState.inningsNum = 1;
    matchState._pendingBat = team1;
    matchState._pendingBow = team2;
    matchState._batTeamName = team1;
    matchState.inn1Score = null;
    matchState.nextBallIsFreeHit = false;
    openOpeningPairModal();
    return;
  }

  // Quick mode
  const sessionId = _urlParams.get('session') || null;
  const rules = buildRulesObject();

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
    _setWatchCode(match.watch_code);

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
    body.metadata = { ...(body.metadata || {}), free_hit: true };
  }

  // Attach batter/bowler IDs for team-linked mode
  if (isTeamLinked) {
    if (!body.batter_id) {
      body.batter_id = matchState.pendingBatterId || matchState.currentStrikerId || undefined;
    }
    if (!body.bowler_id) {
      body.bowler_id = matchState.currentBowlerId || undefined;
    }
    // Piggyback pending new non-striker onto metadata (after non-striker run-out)
    if (_pendingNonStrikerId) {
      body.metadata = { ...(body.metadata || {}), new_non_striker_id: _pendingNonStrikerId };
    }
  }

  try {
    const sc = await api('POST', `/matches/${matchState.matchId}/innings/${matchState.inningsId}/ball`, body);
    matchState.scorecard = sc;

    // Free-hit logic
    const wasNoBall = body.event_type === 'no_ball';
    if (!wasNoBall) matchState.nextBallIsFreeHit = false;
    if (wasNoBall && cfg.rules.free_hit) matchState.nextBallIsFreeHit = true;

    setFreehitBanner(matchState.nextBallIsFreeHit);

    if (isTeamLinked) {
      matchState.currentStrikerId    = sc.current_striker_id;
      matchState.currentNonStrikerId = sc.current_non_striker_id;
      matchState.currentBowlerId     = sc.current_bowler_id;
      matchState.currentOverNumber   = sc.current_over_number;
      matchState.pendingBatterId = null;  // consumed
      _pendingNonStrikerId = null;        // consumed
    }

    renderBoard(sc);

    // Innings-end check — if innings ends, stop here
    if (checkInningsEnd(sc)) return;

    // Team-linked modal triggers (only when innings continues)
    if (isTeamLinked) {
      const legal = sc.balls.filter(isLegal).length;
      const wasWicket = body.event_type === 'wicket';
      const overJustDone = legal > 0 && legal % 6 === 0;

      if (wasWicket) {
        if (sc.current_striker_id === null) {
          await openNewBatterModal('striker');
        } else if (sc.current_non_striker_id === null) {
          // Non-striker run-out: need a replacement at the non-striker end
          await openNewBatterModal('non_striker');
        }
      }
      // Separate check: new bowler modal fires even when over ends on a wicket
      if (overJustDone && sc.current_bowler_id === null) {
        await openNewBowlerModal(sc.current_over_number);
      }
    }
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
  if (isTeamLinked) renderPlayerStrip(sc);
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

// Returns true if the innings/match ended (caller should stop further processing)
function checkInningsEnd(sc) {
  const legal = sc.balls.filter(isLegal).length;
  const allOut = sc.total_wickets >= cfg.maxWickets;
  const oversDone = legal >= cfg.overs * 6;

  // 2nd innings win condition: chasing team passes target
  if (matchState.inningsNum === 2 && matchState.inn1Score) {
    const target = matchState.inn1Score.runs + 1;
    if (sc.total_runs >= target) { finishMatch(sc); return true; }
  }

  if (allOut || oversDone) {
    if (matchState.inningsNum === 1) {
      autoEndFirstInnings(sc);
    } else {
      finishMatch(sc);
    }
    return true;
  }
  return false;
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

  if (isTeamLinked) {
    // Swap batting/bowling player lists for innings 2
    const temp = matchState.battingTeamPlayers;
    matchState.battingTeamPlayers = matchState.bowlingTeamPlayers;
    matchState.bowlingTeamPlayers = temp;
    matchState.inningsNum = 2;
    matchState._pendingBat = bat;
    matchState._pendingBow = bow;
    matchState._batTeamName = bat;
    openOpeningPairModal();
    return;
  }

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
  _runOutTarget = 'striker';
  const runOutRow = document.getElementById('runOutEndRow');
  if (runOutRow) runOutRow.style.display = 'none';

  const isFH  = matchState.nextBallIsFreeHit;
  const types = isFH
    ? ['run_out']
    : ['bowled','caught','run_out','lbw','stumped','hit_wicket'];
  const labels = {bowled:'Bowled', caught:'Caught', run_out:'Run Out', lbw:'LBW', stumped:'Stumped', hit_wicket:'Hit Wkt'};

  document.getElementById('wktGrid').innerHTML = types.map(w =>
    `<button class="wkt-btn" onclick="selectWicket('${w}')">${labels[w]}</button>`
  ).join('');
  document.getElementById('freehitWktNote').style.display = isFH ? '' : 'none';
  // Free hit forces run-out; auto-show end picker in team-linked mode
  if (isFH && isTeamLinked && runOutRow) {
    runOutRow.style.display = '';
    document.getElementById('roStrikerBtn').classList.add('on');
    document.getElementById('roNonStrikerBtn').classList.remove('on');
  }
  openModal('wicketModal');
}
function selectWicket(w) {
  _wicketType = w;
  document.querySelectorAll('.wkt-btn').forEach(b =>
    b.classList.toggle('on', b.onclick && b.onclick.toString().includes(`'${w}'`))
  );
  // Show/hide run-out end picker
  const runOutRow = document.getElementById('runOutEndRow');
  if (isTeamLinked && runOutRow) {
    const show = w === 'run_out';
    runOutRow.style.display = show ? '' : 'none';
    if (show) {
      _runOutTarget = 'striker';
      document.getElementById('roStrikerBtn').classList.add('on');
      document.getElementById('roNonStrikerBtn').classList.remove('on');
    }
  }
}
function setRunOutTarget(val) {
  _runOutTarget = val;
  document.getElementById('roStrikerBtn').classList.toggle('on', val === 'striker');
  document.getElementById('roNonStrikerBtn').classList.toggle('on', val === 'non_striker');
}
function submitWicket() {
  if (!_wicketType) { toast('Select a dismissal type', true); return; }
  const body = { event_type: 'wicket', runs: 0, wicket_type: _wicketType };
  if (isTeamLinked && _wicketType === 'run_out') {
    body.metadata = { run_out_end: _runOutTarget };
    // For non-striker run-out, tag the correct dismissed player now
    if (_runOutTarget === 'non_striker' && matchState.currentNonStrikerId) {
      body.batter_id = matchState.currentNonStrikerId;
    }
  }
  closeModal('wicketModal');
  postBall(body);
}

// ── Undo ──────────────────────────────────────────────────────
async function undoLast() {
  if (!matchState.inningsId) return;
  try {
    const sc = await api('POST', `/matches/${matchState.matchId}/innings/${matchState.inningsId}/undo`);
    matchState.scorecard = sc;
    matchState.nextBallIsFreeHit = false;
    setFreehitBanner(false);
    if (isTeamLinked) {
      matchState.currentStrikerId    = sc.current_striker_id;
      matchState.currentNonStrikerId = sc.current_non_striker_id;
      matchState.currentBowlerId     = sc.current_bowler_id;
      matchState.currentOverNumber   = sc.current_over_number;
      matchState.pendingBatterId = null;
    }
    renderBoard(sc);
    toast('Last ball undone');
  } catch(e) {
    toast(e.message, true);
  }
}

// ═══════════════════════════════════════════════════════════════
// SCORECARD VIEW
// ═══════════════════════════════════════════════════════════════

function _buildBallByBall(sc) {
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
      return `<div class="ob ${cls}${fh}">${ballLabel(b)}</div>`;
    }).join('');
    return `<div class="over-row">
      <span class="ov-num">Ov ${parseInt(ov)+1}</span>
      <div class="ov-balls">${bHtml}</div>
      <span class="ov-runs">${ovRuns}</span>
    </div>`;
  }).join('');
}

// ─── shared scorecard renderer ──────────────────────────────────

function _buildInningsScorecardHtml(sc, innNum) {
  let battingHtml = '';
  if (sc.batters && sc.batters.length) {
    const rows = sc.batters.map(b => {
      const notOut = b.status !== 'out';
      const sr = b.balls > 0 ? (b.runs / b.balls * 100).toFixed(1) : '0.0';
      const nameHtml = notOut
        ? `<span class="sc-not-out">${b.name}*</span>`
        : `${b.name}<span class="sc-dis">${(b.dismissal || 'out').replace(/_/g,' ')}</span>`;
      return `<tr>
        <td>${nameHtml}</td>
        <td style="font-weight:700">${b.runs}</td>
        <td>${b.balls}</td>
        <td>${b.fours}</td>
        <td>${b.sixes}</td>
        <td>${sr}</td>
      </tr>`;
    }).join('');
    battingHtml = `
      <div class="sc-section">
        <div class="sc-hdr">Batting · ${sc.innings.batting_team}</div>
        <table class="sc-table">
          <thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  let bowlingHtml = '';
  if (sc.bowlers && sc.bowlers.length) {
    const rows = sc.bowlers.map(b => {
      const ovStr = `${b.overs}.${b.balls_legal}`;
      const econ  = b.overs > 0 || b.balls_legal > 0
        ? (b.runs_conceded / ((b.overs * 6 + b.balls_legal) / 6)).toFixed(2)
        : '—';
      const throwTag = b.throw_overs > 0
        ? ` <span style="font-size:.6rem;color:#f09060">T${b.throw_overs}</span>` : '';
      return `<tr>
        <td>${b.name}${throwTag}</td>
        <td>${ovStr}</td>
        <td>${b.runs_conceded}</td>
        <td style="font-weight:700">${b.wickets}</td>
        <td>${econ}</td>
      </tr>`;
    }).join('');
    bowlingHtml = `
      <div class="sc-section">
        <div class="sc-hdr">Bowling · ${sc.innings.bowling_team}</div>
        <table class="sc-table">
          <thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>Econ</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  const innLabel = innNum === 1 ? '1st' : '2nd';
  const hasTables = battingHtml || bowlingHtml;
  const ovHtml = _buildBallByBall(sc);
  return `
    <div style="font-family:'DM Mono',monospace;font-size:.68rem;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:4px">
      ${sc.innings.batting_team} · ${innLabel} Innings
    </div>
    <div style="font-family:'Playfair Display',serif;font-size:2rem;font-weight:900;margin-bottom:2px">
      ${sc.total_runs}/${sc.total_wickets}
    </div>
    <div style="font-family:'DM Mono',monospace;font-size:.72rem;color:var(--muted);margin-bottom:14px">
      ${sc.total_overs} overs · RR ${sc.run_rate.toFixed(2)}${sc.target ? ' · Target ' + sc.target : ''}
    </div>
    ${battingHtml}
    ${bowlingHtml}
    ${hasTables ? '<div class="hr" style="margin:2px 0 14px"></div>' : ''}
    <div style="font-family:'DM Mono',monospace;font-size:.62rem;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Ball by Ball</div>
    <div class="over-rows" style="max-height:none">${ovHtml}</div>
  `;
}

// ─── live score tab ──────────────────────────────────────────────

function switchScoreTab(tab) {
  const toLive = tab === 'live';
  document.getElementById('panelLive').style.display = toLive ? '' : 'none';
  document.getElementById('panelCard').style.display = toLive ? 'none' : '';
  document.getElementById('tabLive').classList.toggle('on', toLive);
  document.getElementById('tabCard').classList.toggle('on', !toLive);
  if (!toLive) {
    const el = document.getElementById('inlineScorecardContent');
    const sc = matchState.scorecard;
    if (!sc || !sc.balls || sc.balls.length === 0) {
      el.innerHTML = '<div class="ctitle">Scorecard</div><p style="color:var(--muted);font-family:\'DM Mono\',monospace;font-size:.72rem;text-align:center;padding:20px 0">No balls yet</p>';
    } else {
      el.innerHTML = '<div class="ctitle">Scorecard</div>' + _buildInningsScorecardHtml(sc, matchState.inningsNum);
    }
  }
}

function viewScorecard() { switchScoreTab('card'); }

function backToScoring() { switchScoreTab('live'); }

// ─── full match scorecard (after match) ─────────────────────────

async function viewFullScorecard() {
  try {
    const sc = await api('GET', `/matches/${matchState.matchId}/scorecard`);
    let html = '<div class="ctitle">Full Scorecard</div>';
    for (const inn of sc.innings_list) {
      html += _buildInningsScorecardHtml(inn, inn.innings.innings_number);
      if (sc.innings_list.indexOf(inn) < sc.innings_list.length - 1) {
        html += '<div class="hr" style="margin:16px 0"></div>';
      }
    }
    document.getElementById('scorecardContent').innerHTML = html;
    showView('viewScorecard');
  } catch(e) {
    toast('Could not load scorecard: ' + e.message, true);
  }
}

function backToResult() { showView('viewResult'); }

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
// PLAY AGAIN (same teams)
// ═══════════════════════════════════════════════════════════════

function openPlayAgainModal() {
  cfg.matchNum = (cfg.matchNum || 1) + 1;
  document.getElementById('paMatchNum').textContent = `Match ${cfg.matchNum}`;
  document.getElementById('paTeamInfo').textContent = `${cfg.team1} vs ${cfg.team2} · ${cfg.overs} overs`;
  document.getElementById('paTeam1Btn').textContent = `${cfg.team1} bats first`;
  document.getElementById('paTeam2Btn').textContent = `${cfg.team2} bats first`;

  document.getElementById('paTossSection').style.display = '';
  document.getElementById('paChooseSection').style.display = 'none';
  document.getElementById('paTossText').textContent = 'Who bats first?';
  document.getElementById('paCoin').textContent = '🪙';
  document.getElementById('paCoin').classList.remove('spinning');

  openModal('playAgainModal');
}

function doPlayAgainToss() {
  const coinEl = document.getElementById('paCoin');
  coinEl.textContent = '🪙';
  coinEl.classList.add('spinning');
  setTimeout(() => {
    coinEl.classList.remove('spinning');
    const isHeads = Math.random() < 0.5;
    coinEl.textContent = isHeads ? 'H' : 'T';
    const side = isHeads ? 'Heads' : 'Tails';
    document.getElementById('paTossText').textContent = `${side}! Choose who bats:`;
    document.getElementById('paTossSection').style.display = 'none';
    document.getElementById('paChooseSection').style.display = '';
  }, 700);
}

async function startPlayAgain(battingTeam) {
  closeModal('playAgainModal');
  const bowlingTeam = battingTeam === cfg.team1 ? cfg.team2 : cfg.team1;

  try {
    const sessionId = _urlParams.get('session') || null;
    const rules = buildRulesObject();

    const match = await api('POST', '/matches', {
      session_id: sessionId,
      match_type: isTeamLinked ? 'team' : 'quick',
      overs: cfg.overs,
      players_per_side: cfg.playersPerSide || 6,
      rules_preset: 'custom',
      rules,
    });

    // Reset state for new match
    matchState.matchId = match.id;
    matchState.inningsId = null;
    matchState.inningsNum = 1;
    matchState.scorecard = null;
    matchState.nextBallIsFreeHit = false;
    matchState.inn1Score = null;
    matchState.currentStrikerId = null;
    matchState.currentNonStrikerId = null;
    matchState.currentBowlerId = null;
    matchState.currentOverNumber = 0;
    matchState.pendingBatterId = null;
    _pendingNonStrikerId = null;
    _setWatchCode(match.watch_code);

    // Update cfg so team1 is always the first-innings batter
    cfg.team1 = battingTeam;
    cfg.team2 = bowlingTeam;

    setFreehitBanner(false);
    document.getElementById('statTargetWrap').style.display = 'none';
    document.getElementById('statRRRWrap').style.display = 'none';
    document.getElementById('chaseBar').classList.remove('show');
    const ps = document.getElementById('playerStrip');
    if (ps) ps.style.display = 'none';

    if (isTeamLinked) {
      await api('PATCH', `/matches/${match.id}/rules`, { rules });

      // Swap player arrays if needed so battingTeamPlayers matches the new bat team
      if (battingTeam !== matchState._batTeamName) {
        const temp = matchState.battingTeamPlayers;
        matchState.battingTeamPlayers = matchState.bowlingTeamPlayers;
        matchState.bowlingTeamPlayers = temp;
      }
      matchState._batTeamName = battingTeam;
      matchState._pendingBat = battingTeam;
      matchState._pendingBow = bowlingTeam;

      openOpeningPairModal();
    } else {
      const inn = await api('POST', `/matches/${match.id}/innings`, {
        batting_team: battingTeam,
        bowling_team: bowlingTeam,
      });
      matchState.inningsId = inn.id;
      matchState._batTeamName = battingTeam;

      switchScoreTab('live');
      showView('viewScoring');
      updateScoringHeader();
      await refreshScorecard();
    }
  } catch(e) {
    toast(e.message, true);
  }
}

// ═══════════════════════════════════════════════════════════════
// RESET
// ═══════════════════════════════════════════════════════════════

function resetToSetup() {
  matchState = {
    matchId:null, inningsId:null, inningsNum:1, scorecard:null,
    nextBallIsFreeHit:false, inn1Score:null,
    battingTeamPlayers:[], bowlingTeamPlayers:[],
    currentStrikerId:null, currentNonStrikerId:null,
    currentBowlerId:null, currentOverNumber:0,
    pendingBatterId:null, _pendingBat:null, _pendingBow:null,
    _openingBowlType:'legal', _newBowlType:'legal',
    _selectedBowlerId:null, _forOver:0,
  };
  cfg.matchNum = 1;
  document.getElementById('team1Name').value = '';
  document.getElementById('team2Name').value = '';
  document.getElementById('statTargetWrap').style.display = 'none';
  document.getElementById('statRRRWrap').style.display = 'none';
  document.getElementById('chaseBar').classList.remove('show');
  const ps = document.getElementById('playerStrip');
  if (ps) ps.style.display = 'none';
  setFreehitBanner(false);
  switchScoreTab('live');
  showView('viewSetup');
}

// ═══════════════════════════════════════════════════════════════
// TEAM-LINKED MODE
// ═══════════════════════════════════════════════════════════════

async function loadTeamLinkedSetup() {
  const matchId  = _urlParams.get('match_id');
  const sessionId = _urlParams.get('session');
  if (!matchId) return;

  matchState.matchId = matchId;
  document.getElementById('teamLinkedExtras').style.display = '';

  try {
    const match = await api('GET', `/matches/${matchId}`);
    _setWatchCode(match.watch_code);
    cfg.overs = match.overs;
    cfg.maxWickets = match.players_per_side - 1;
    cfg.playersPerSide = match.players_per_side;
    document.getElementById('oversInput').value = match.overs;
    document.getElementById('playersInput').value = match.players_per_side;
    document.getElementById('wicketsInput').value = match.players_per_side - 1;

    if (sessionId) {
      const teams = await api('GET', `/sessions/${sessionId}/teams`);
      cfg.team1 = teams.team_a_name;
      cfg.team2 = teams.team_b_name;
      document.getElementById('team1Name').value = teams.team_a_name;
      document.getElementById('team2Name').value = teams.team_b_name;
      document.getElementById('team1Name').readOnly = true;
      document.getElementById('team2Name').readOnly = true;
      document.getElementById('team1Name').style.opacity = '.65';
      document.getElementById('team2Name').style.opacity = '.65';

      const aName = teams.team_a_name;
      matchState.battingTeamPlayers = teams.assignments
        .filter(a => a.team_name === aName)
        .map(a => ({ id: String(a.player_id), name: a.player_name, can_bowl: a.can_bowl, bowl_type: a.bowl_type || 'legal' }));
      matchState.bowlingTeamPlayers = teams.assignments
        .filter(a => a.team_name !== aName)
        .map(a => ({ id: String(a.player_id), name: a.player_name, can_bowl: a.can_bowl, bowl_type: a.bowl_type || 'legal' }));
      matchState._batTeamName = aName;
    }
  } catch(e) {
    toast('Failed to load match data: ' + e.message, true);
  }
}

// ── Opening Pair Modal ───────────────────────────────────────

function openOpeningPairModal() {
  const batters = matchState.battingTeamPlayers;
  const bowlers = matchState.bowlingTeamPlayers; // all players eligible to bowl

  const strikerSel    = document.getElementById('opStrikerSel');
  const nonStrikerSel = document.getElementById('opNonStrikerSel');
  const bowlerSel     = document.getElementById('opBowlerSel');

  const batterOpts = '<option value="">Pick...</option>' +
    batters.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  strikerSel.innerHTML = batterOpts;
  nonStrikerSel.innerHTML = batterOpts;

  bowlerSel.innerHTML = '<option value="">Pick...</option>' +
    bowlers.map(p => `<option value="${p.id}">${p.name}</option>`).join('');

  matchState._openingBowlType = 'legal';
  document.getElementById('opBtLegal').classList.add('on');
  document.getElementById('opBtThrow').classList.remove('on');

  const isInn2 = matchState.inningsNum === 2;
  document.getElementById('openingPairTitle').textContent =
    isInn2 ? '2nd Innings Opening Pair' : 'Opening Pair';
  document.getElementById('opSubmitBtn').textContent =
    isInn2 ? 'Start 2nd Innings' : 'Start Over 1';

  openModal('openingPairModal');
}

function refreshNonStrikerOpts() {
  const striker = document.getElementById('opStrikerSel').value;
  const sel = document.getElementById('opNonStrikerSel');
  const current = sel.value;
  sel.innerHTML = '<option value="">Pick...</option>' +
    matchState.battingTeamPlayers
      .filter(p => p.id !== striker)
      .map(p => `<option value="${p.id}" ${p.id === current ? 'selected' : ''}>${p.name}</option>`)
      .join('');
}

function setOpeningBowlType(val) {
  matchState._openingBowlType = val;
  document.getElementById('opBtLegal').classList.toggle('on', val === 'legal');
  document.getElementById('opBtThrow').classList.toggle('on', val === 'throw');
}

async function submitOpeningPair() {
  if (_openingPairSubmitting) return;  // guard against double-tap
  const strikerId    = document.getElementById('opStrikerSel').value;
  const nonStrikerId = document.getElementById('opNonStrikerSel').value;
  const bowlerId     = document.getElementById('opBowlerSel').value;

  if (!strikerId || !nonStrikerId || !bowlerId) {
    toast('Select striker, non-striker and bowler', true); return;
  }
  if (strikerId === nonStrikerId) {
    toast('Striker and non-striker must be different players', true); return;
  }

  _openingPairSubmitting = true;
  const bat  = matchState._pendingBat || cfg.team1;
  const bowl = matchState._pendingBow || cfg.team2;

  try {
    const inn = await api('POST', `/matches/${matchState.matchId}/innings`, {
      batting_team: bat,
      bowling_team: bowl,
      opening_striker_id: strikerId,
      opening_non_striker_id: nonStrikerId,
    });

    await api('POST', `/matches/${matchState.matchId}/innings/${inn.id}/overs`, {
      bowler_id: bowlerId,
      bowl_type: matchState._openingBowlType || 'legal',
    });

    matchState.inningsId           = inn.id;
    matchState.scorecard           = null;
    matchState.nextBallIsFreeHit   = false;
    matchState.currentStrikerId    = strikerId;
    matchState.currentNonStrikerId = nonStrikerId;
    matchState.currentBowlerId     = bowlerId;
    matchState.currentOverNumber   = 0;
    matchState.pendingBatterId     = null;

    closeModal('openingPairModal');
    setFreehitBanner(false);
    showView('viewScoring');
    updateScoringHeader();
    await refreshScorecard();
  } catch(e) {
    toast(e.message, true);
  } finally {
    _openingPairSubmitting = false;
  }
}

// ── New Batter Modal ─────────────────────────────────────────

async function openNewBatterModal(position = 'striker') {
  _newBatterPosition = position;
  try {
    const res = await api('GET',
      `/matches/${matchState.matchId}/innings/${matchState.inningsId}/eligible_batters`);
    const batters = res.batters || [];
    if (!batters.length) return; // innings ended / last man
    const titleEl = document.querySelector('#newBatterModal h2');
    if (titleEl) titleEl.textContent = position === 'non_striker' ? 'New Non-Striker In' : 'New Batter In';
    const sel = document.getElementById('newBatterSel');
    sel.innerHTML = '<option value="">Pick incoming batter...</option>' +
      batters.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    openModal('newBatterModal');
  } catch(e) {
    toast(e.message, true);
  }
}

function submitNewBatter() {
  const batterId = document.getElementById('newBatterSel').value;
  if (!batterId) { toast('Select a batter', true); return; }
  if (_newBatterPosition === 'non_striker') {
    // Non-striker run-out replacement: stored in metadata on next ball
    _pendingNonStrikerId = batterId;
    matchState.currentNonStrikerId = batterId; // optimistic display
  } else {
    matchState.pendingBatterId = batterId;
    matchState.currentStrikerId = batterId; // optimistic display
  }
  closeModal('newBatterModal');
}

function cancelNewBatter() {
  matchState.pendingBatterId = null;
  _pendingNonStrikerId = null;
  closeModal('newBatterModal');
}

// ── New Bowler Modal ─────────────────────────────────────────

async function openNewBowlerModal(forOver) {
  matchState._forOver = forOver;
  try {
    const res = await api('GET',
      `/matches/${matchState.matchId}/innings/${matchState.inningsId}/eligible_bowlers?for_over=${forOver}`);
    const eligible = res.bowlers || [];

    const listEl = document.getElementById('bowlerPickList');
    listEl.innerHTML = '';
    matchState._selectedBowlerId = null;

    eligible.forEach(b => {
      const canPlay = b.can_legal || b.can_throw;
      const item = document.createElement('div');
      const thrLabel = b.throw_overs_bowled > 0 ? ` 🤾 ${b.throw_overs_bowled}` : '';
      const reason = !canPlay ? `<span class="bp-blocked">${b.reason_blocked || 'Ineligible'}</span>` : '';
      item.innerHTML = `<button class="bowler-pick-btn" id="bpb-${b.id}"
          onclick="selectEligibleBowler('${b.id}',this)" ${canPlay ? '' : 'disabled'}>
        <span class="bp-name">${b.name}</span>
        <span class="bp-info">${b.overs_bowled}ov${thrLabel}</span>
        ${reason}
      </button>`;
      listEl.appendChild(item);
    });

    document.getElementById('newBowlerTitle').textContent = `Over ${forOver + 1} — Pick Bowler`;

    // Default bowl type
    matchState._newBowlType = 'legal';
    document.getElementById('newBtLegal').classList.add('on');
    document.getElementById('newBtThrow').classList.remove('on');

    openModal('newBowlerModal');
  } catch(e) {
    toast(e.message, true);
  }
}

function selectEligibleBowler(bowlerId, btn) {
  document.querySelectorAll('.bowler-pick-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  matchState._selectedBowlerId = bowlerId;
}

function setNewBowlType(val) {
  matchState._newBowlType = val;
  document.getElementById('newBtLegal').classList.toggle('on', val === 'legal');
  document.getElementById('newBtThrow').classList.toggle('on', val === 'throw');
}

async function submitNewBowler() {
  if (!matchState._selectedBowlerId) { toast('Select a bowler', true); return; }
  try {
    await api('POST', `/matches/${matchState.matchId}/innings/${matchState.inningsId}/overs`, {
      bowler_id: matchState._selectedBowlerId,
      bowl_type: matchState._newBowlType || 'legal',
    });
    matchState.currentBowlerId = matchState._selectedBowlerId;
    closeModal('newBowlerModal');
  } catch(e) {
    toast(e.message, true);
  }
}

// ── Player Strip Renderer ────────────────────────────────────

function renderPlayerStrip(sc) {
  const el = document.getElementById('playerStrip');
  if (!el) return;

  const sid = sc.current_striker_id;
  const nid = sc.current_non_striker_id;
  const bid = sc.current_bowler_id;

  if (!sid && !bid) { el.style.display = 'none'; return; }
  el.style.display = '';

  const findBatter  = id => sc.batters  ? sc.batters.find(b => String(b.player_id) === String(id)) : null;
  const findBowler  = id => sc.bowlers  ? sc.bowlers.find(b => String(b.player_id) === String(id)) : null;

  const sk  = findBatter(sid);
  const nsk = findBatter(nid);
  const bwl = findBowler(bid);

  const skName  = sk  ? sk.name  : (sid  ? '...' : '—');
  const skLine  = sk  ? `${sk.runs}(${sk.balls})` : '';
  const nskName = nsk ? nsk.name : (nid ? '...' : '—');
  const nskLine = nsk ? `${nsk.runs}(${nsk.balls})` : '';

  const bwlName = bwl ? bwl.name : (bid ? '...' : '—');
  const bwlLine = bwl
    ? `${bwl.overs}.${bwl.balls_legal} · ${bwl.runs_conceded}-${bwl.wickets}`
    : '';

  el.innerHTML = `
    <div class="ps-batting">
      <span class="ps-player ps-striker">${skName}* <span class="ps-stat">${skLine}</span></span>
      <span class="ps-sep">|</span>
      <span class="ps-player ps-nonstrike">${nskName} <span class="ps-stat">${nskLine}</span></span>
    </div>
    <div class="ps-bowling">
      <span class="ps-bowler">${bwlName}</span>
      ${bwlLine ? `<span class="ps-bowlstat">${bwlLine}</span>` : ''}
    </div>
  `;
}
