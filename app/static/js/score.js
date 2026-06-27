// ═══════════════════════════════════════════════════════════════
// GAME ENGINE — client-side scoring logic
// Replicates app/routers/matches.py helpers so the server is
// only used for persistence, not for state derivation.
// ═══════════════════════════════════════════════════════════════

class GameEngine {
  constructor() { this.reset(); }

  reset() {
    this.overs = 6;
    this.maxWickets = 5;
    this.rules = {};

    this.inningsRow = null;
    this.overAssignments = [];

    this.totalRuns = 0;
    this.totalWickets = 0;
    this.totalExtras = 0;
    this.legalBalls = 0;

    this.strikerId = null;
    this.nonStrikerId = null;
    this.bowlerId = null;
    this.nextBallIsFreeHit = false;

    this._balls = [];

    this._batterStats = {};
    this._bowlerStats = {};
    this._bowlerLegalOvers = {};
    this._bowlerThrowOvers = {};

    this.dismissedIds = new Set();

    this._playerNames = {};
    this.battingPlayers = [];
    this.bowlingPlayers = [];
  }

  init(inningsRow, rules, overs, maxWickets, battingPlayers, bowlingPlayers) {
    this.reset();
    this.inningsRow = inningsRow;
    this.rules = rules || {};
    this.overs = overs;
    this.maxWickets = maxWickets;

    this.battingPlayers = battingPlayers || [];
    this.bowlingPlayers = bowlingPlayers || [];
    for (const p of this.battingPlayers) this._playerNames[String(p.id)] = p.name;
    for (const p of this.bowlingPlayers) this._playerNames[String(p.id)] = p.name;

    if (inningsRow && inningsRow.opening_striker_id) {
      this.strikerId = String(inningsRow.opening_striker_id);
      this.nonStrikerId = inningsRow.opening_non_striker_id ? String(inningsRow.opening_non_striker_id) : null;
    }
  }

  rebuild(storedBalls, overAssignments, inningsRow, rules, overs, maxWickets, battingPlayers, bowlingPlayers) {
    this.init(inningsRow, rules, overs, maxWickets, battingPlayers, bowlingPlayers);
    this.overAssignments = (overAssignments || []).map(o => ({
      over_number: o.over_number,
      bowler_id: o.bowler_id ? String(o.bowler_id) : null,
      bowl_type: o.bowl_type || 'legal',
    }));

    const overMap = {};
    for (const ov of this.overAssignments) {
      overMap[ov.over_number] = ov.bowler_id || null;
      if (ov.bowler_id) {
        if (ov.bowl_type === 'throw') {
          this._bowlerThrowOvers[ov.bowler_id] = (this._bowlerThrowOvers[ov.bowler_id] || 0) + 1;
        } else {
          this._bowlerLegalOvers[ov.bowler_id] = (this._bowlerLegalOvers[ov.bowler_id] || 0) + 1;
        }
      }
    }

    this.bowlerId = overMap[0] || null;

    for (const ball of (storedBalls || [])) {
      this._applyStoredBall(ball, overMap);
    }
  }

  _applyStoredBall(ball, overMap) {
    let meta = ball.metadata;
    if (!meta || typeof meta !== 'object') meta = {};

    if (meta.new_non_striker_id) {
      this.nonStrikerId = String(meta.new_non_striker_id);
    }

    if (ball.bowler_id) this.bowlerId = String(ball.bowler_id);

    this._updateBatterStats(ball);
    this._updateBowlerStats(ball);

    this.totalRuns += (ball.runs || 0) + (ball.extras || 0);
    if (ball.event_type === 'wicket') this.totalWickets++;
    this.totalExtras += (ball.extras || 0);

    this.nextBallIsFreeHit = ball.event_type === 'no_ball' && !!this.rules.free_hit_enabled;

    let rot = 0;
    if (ball.event_type === 'wide') rot = 0;
    else if (ball.event_type === 'bye' || ball.event_type === 'leg_bye') rot = ball.extras || 0;
    else rot = ball.runs || 0;

    if (rot % 2 === 1) {
      const tmp = this.strikerId; this.strikerId = this.nonStrikerId; this.nonStrikerId = tmp;
    }

    if (ball.is_legal_ball) {
      this.legalBalls++;
      if (this.legalBalls % 6 === 0) {
        const tmp = this.strikerId; this.strikerId = this.nonStrikerId; this.nonStrikerId = tmp;
        const nxtOver = (this.legalBalls / 6) | 0;
        this.bowlerId = (overMap && Object.prototype.hasOwnProperty.call(overMap, nxtOver))
          ? overMap[nxtOver] : null;
      }
    }

    if (ball.event_type === 'wicket') {
      const runOutEnd = meta.run_out_end;
      const dismissedId = ball.batter_id ? String(ball.batter_id) : null;

      if (runOutEnd === 'non_striker') {
        if (this.nonStrikerId) this.dismissedIds.add(String(this.nonStrikerId));
        this.nonStrikerId = null;
      } else if (dismissedId && dismissedId === String(this.nonStrikerId)) {
        this.dismissedIds.add(dismissedId);
        this.nonStrikerId = null;
      } else {
        if (this.strikerId) this.dismissedIds.add(String(this.strikerId));
        else if (dismissedId) this.dismissedIds.add(dismissedId);
        this.strikerId = null;
      }
    }

    this._balls.push(ball);
  }

  applyBall(input) {
    const isLegal = this._isLegal(input.event_type);
    const extras  = this._extrasFor(input.event_type, input.runs || 0);
    const scored  = this._runsFor(input.event_type, input.runs || 0);

    const overNum = (this.legalBalls / 6) | 0;
    const ballNum = this.legalBalls % 6;

    const meta = input.metadata || {};

    const ball = {
      event_type:    input.event_type,
      runs:          scored,
      extras:        extras,
      extra_type:    input.extra_type || null,
      is_legal_ball: isLegal,
      is_boundary:   input.is_boundary || false,
      boundary_type: input.boundary_type || null,
      wicket_type:   input.wicket_type || null,
      batter_id:     input.batter_id || null,
      bowler_id:     input.bowler_id || null,
      metadata:      meta,
      over_number:   overNum,
      ball_number:   ballNum,
    };

    const overMap = {};
    for (const ov of this.overAssignments) {
      overMap[ov.over_number] = ov.bowler_id || null;
    }

    this._applyStoredBall(ball, overMap);

    const overJustDone   = isLegal && this.legalBalls > 0 && this.legalBalls % 6 === 0;
    const wasWicket      = input.event_type === 'wicket';
    const needsNewBatter = wasWicket && (this.strikerId === null || this.nonStrikerId === null);
    const needsNewBowler = overJustDone && this.bowlerId === null;

    return {
      overJustDone,
      needsNewBatter,
      needsNewBowler,
      newBatterPosition: this.strikerId === null ? 'striker' : 'non_striker',
      inningsEnded: this.isInningsOver(),
    };
  }

  undo(overAssignments) {
    if (this._balls.length === 0) return false;

    const poppedBalls = this._balls.slice(0, -1);
    const overs = overAssignments || this.overAssignments;
    const savedRow   = this.inningsRow;
    const savedRules = this.rules;
    const savedOvers = this.overs;
    const savedMax   = this.maxWickets;
    const savedBat   = this.battingPlayers;
    const savedBowl  = this.bowlingPlayers;

    this.rebuild(poppedBalls, overs, savedRow, savedRules, savedOvers, savedMax, savedBat, savedBowl);
    return true;
  }

  addOverAssignment(overNumber, bowlerId, bowlType) {
    const bid = String(bowlerId);
    this.overAssignments = this.overAssignments.filter(o => o.over_number !== overNumber);
    this.overAssignments.push({ over_number: overNumber, bowler_id: bid, bowl_type: bowlType });
    this.bowlerId = bid;

    if (bowlType === 'throw') {
      this._bowlerThrowOvers[bid] = (this._bowlerThrowOvers[bid] || 0) + 1;
    } else {
      this._bowlerLegalOvers[bid] = (this._bowlerLegalOvers[bid] || 0) + 1;
    }
  }

  seatBatter(playerId, position) {
    const pid = String(playerId);
    if (position === 'striker') this.strikerId = pid;
    else this.nonStrikerId = pid;
  }

  getScorecard() {
    const legalComplete = (this.legalBalls / 6) | 0;
    const ballsInOver   = this.legalBalls % 6;
    const totalOvers    = parseFloat((legalComplete + ballsInOver / 10).toFixed(1));
    const runRate       = this.legalBalls > 0
      ? parseFloat((this.totalRuns / (this.legalBalls / 6)).toFixed(2))
      : 0.0;

    const innings = this.inningsRow ? {
      id: this.inningsRow.id,
      innings_number: this.inningsRow.innings_number,
      batting_team: this.inningsRow.batting_team,
      bowling_team: this.inningsRow.bowling_team,
      target: this.inningsRow.target,
      status: this.inningsRow.status,
    } : null;

    return {
      innings,
      total_runs:             this.totalRuns,
      total_wickets:          this.totalWickets,
      total_overs:            totalOvers,
      run_rate:               runRate,
      target:                 this.inningsRow ? this.inningsRow.target : null,
      balls:                  [...this._balls],
      current_striker_id:     this.strikerId,
      current_non_striker_id: this.nonStrikerId,
      current_bowler_id:      this.bowlerId,
      current_over_number:    (this.legalBalls / 6) | 0,
      batters:                this._getBatterStats(),
      bowlers:                this._getBowlerStats(),
    };
  }

  isInningsOver() {
    return this.totalWickets >= this.maxWickets || this.legalBalls >= this.overs * 6;
  }

  getEligibleBatters(allBattingPlayers) {
    const atCrease = new Set();
    if (this.strikerId) atCrease.add(String(this.strikerId));
    if (this.nonStrikerId) atCrease.add(String(this.nonStrikerId));
    return (allBattingPlayers || []).filter(p =>
      !this.dismissedIds.has(String(p.id)) && !atCrease.has(String(p.id))
    );
  }

  getEligibleBowlers(allBowlingPlayers) {
    const maxOvPerBowler = this.rules.max_overs_per_bowler != null ? this.rules.max_overs_per_bowler : null;
    const maxThrowOv     = this.rules.max_throw_overs_per_team != null ? this.rules.max_throw_overs_per_team : null;
    const totalThrowSoFar = Object.values(this._bowlerThrowOvers).reduce((s, n) => s + n, 0);

    const currentOver = (this.legalBalls / 6) | 0;
    const lastOverNum = currentOver - 1;
    const lastOverAssign = this.overAssignments.find(o => o.over_number === lastOverNum);
    const prevBowlerId = lastOverAssign ? lastOverAssign.bowler_id : null;

    return (allBowlingPlayers || []).map(p => {
      const pid = String(p.id);
      const legalOv = this._bowlerLegalOvers[pid] || 0;
      const throwOv = this._bowlerThrowOvers[pid] || 0;
      const totalOvers = legalOv + throwOv;

      const blockedConsecutive = prevBowlerId && pid === String(prevBowlerId);
      const blockedCap         = maxOvPerBowler !== null && totalOvers >= maxOvPerBowler;
      const teamThrowCapHit    = maxThrowOv !== null && totalThrowSoFar >= maxThrowOv;

      let reason = null;
      if (blockedConsecutive) reason = 'consecutive';
      else if (blockedCap)    reason = 'overs_cap';

      return {
        id:                 pid,
        name:               p.name,
        overs_bowled:       totalOvers,
        throw_overs_bowled: throwOv,
        bowl_type:          p.bowl_type || 'legal',
        can_legal:          reason === null,
        can_throw:          reason === null && !teamThrowCapHit,
        reason_blocked:     reason,
      };
    });
  }

  _isLegal(eventType) {
    if (eventType === 'wide')      return !!this.rules.wide_counts_as_ball;
    if (eventType === 'no_ball')   return !!this.rules.no_ball_counts_as_ball;
    if (eventType === 'dead_ball') return false;
    return true;
  }

  _extrasFor(eventType, runs) {
    if (eventType === 'wide')    return this.rules.wide_runs != null ? this.rules.wide_runs : 1;
    if (eventType === 'no_ball') return this.rules.no_ball_runs != null ? this.rules.no_ball_runs : 1;
    if (eventType === 'bye' || eventType === 'leg_bye') return runs;
    return 0;
  }

  _runsFor(eventType, runs) {
    if (eventType === 'wide' || eventType === 'bye' || eventType === 'leg_bye') return 0;
    return runs;
  }

  _updateBatterStats(ball) {
    const pid = ball.batter_id ? String(ball.batter_id) : null;
    if (!pid) return;

    if (!this._batterStats[pid]) {
      this._batterStats[pid] = { runs: 0, balls: 0, fours: 0, sixes: 0, dismissed: false, dismissal: null };
    }
    const s = this._batterStats[pid];

    const ev = ball.event_type;
    if (ev !== 'wide' && ev !== 'bye' && ev !== 'leg_bye') s.runs += ball.runs || 0;
    if (ev !== 'wide') s.balls++;
    if (ball.is_boundary) {
      if (ball.boundary_type === 'four') s.fours++;
      else if (ball.boundary_type === 'six') s.sixes++;
    }
    if (ev === 'wicket') {
      s.dismissed = true;
      s.dismissal = ball.wicket_type || 'out';
    }
  }

  _updateBowlerStats(ball) {
    const pid = ball.bowler_id ? String(ball.bowler_id) : null;
    if (!pid) return;

    if (!this._bowlerStats[pid]) {
      this._bowlerStats[pid] = { runs: 0, legal: 0, wickets: 0 };
    }
    const s = this._bowlerStats[pid];
    s.runs += (ball.runs || 0) + (ball.extras || 0);
    if (ball.is_legal_ball) s.legal++;
    if (ball.event_type === 'wicket' && ball.wicket_type !== 'run_out') s.wickets++;
  }

  _getBatterStats() {
    return Object.entries(this._batterStats).map(([pid, s]) => {
      const sr = s.balls > 0 ? parseFloat((s.runs / s.balls * 100).toFixed(1)) : 0.0;
      return {
        player_id:   pid,
        name:        this._playerNames[pid] || 'Unknown',
        runs:        s.runs,
        balls:       s.balls,
        fours:       s.fours,
        sixes:       s.sixes,
        strike_rate: sr,
        status:      s.dismissed ? 'out' : 'batting',
        dismissal:   s.dismissal,
      };
    });
  }

  _getBowlerStats() {
    const allIds = new Set([
      ...Object.keys(this._bowlerStats),
      ...Object.keys(this._bowlerLegalOvers),
      ...Object.keys(this._bowlerThrowOvers),
    ]);
    return [...allIds].map(pid => {
      const s = this._bowlerStats[pid] || { runs: 0, legal: 0, wickets: 0 };
      const lOv = this._bowlerLegalOvers[pid] || 0;
      const tOv = this._bowlerThrowOvers[pid] || 0;
      const econ = s.legal > 0 ? parseFloat((s.runs / (s.legal / 6)).toFixed(2)) : 0.0;
      return {
        player_id:    pid,
        name:         this._playerNames[pid] || 'Unknown',
        overs:        (s.legal / 6) | 0,
        balls_legal:  s.legal % 6,
        runs_conceded: s.runs,
        wickets:      s.wickets,
        economy:      econ,
        bowl_type:    tOv > lOv ? 'throw' : 'legal',
        legal_overs:  lOv,
        throw_overs:  tOv,
      };
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// BALL QUEUE — serialises POST /ball requests to the server.
// The client never sends ball N+1 until ball N is confirmed, so
// the ball_events timeline ordering in the DB is preserved.
// ═══════════════════════════════════════════════════════════════

class BallQueue {
  constructor() {
    this._queue   = [];
    this._running = false;
    this._inFlight = false;
    this._syncEl  = null;
  }

  setSyncIndicator(el) { this._syncEl = el; }

  enqueue(ballData, postFn) {
    this._queue.push({ ballData, postFn });
    if (!this._running) this._drain();
    else this._updateIndicator();
  }

  get pendingCount() { return this._queue.length; }
  get isIdle() { return !this._running && this._queue.length === 0; }

  async _drain() {
    this._running = true;
    this._updateIndicator();

    while (this._queue.length > 0) {
      const { ballData, postFn } = this._queue[0];
      this._inFlight = true;
      try {
        await postFn(ballData);
        this._inFlight = false;
        this._queue.shift();
      } catch (err) {
        this._inFlight = false;
        console.error('BallQueue: POST failed', err);
        try { toast('Sync error — check connection', true); } catch(_) {}
        break;
      }
      this._updateIndicator();
    }

    this._running = false;
    this._updateIndicator();
  }

  async retry() {
    if (!this._running && this._queue.length > 0) {
      await this._drain();
    }
  }

  async drain() {
    if (!this._running && this._queue.length > 0) this._drain();
    while (this._running || this._queue.length > 0) {
      await new Promise(r => setTimeout(r, 80));
    }
  }

  clear() { this._queue = this._inFlight ? this._queue.slice(0, 1) : []; this._updateIndicator(); }

  _updateIndicator() {
    if (!this._syncEl) return;
    if (this._queue.length === 0) {
      this._syncEl.textContent = '';
      this._syncEl.style.display = 'none';
    } else {
      this._syncEl.textContent = `Syncing ${this._queue.length}…`;
      this._syncEl.style.display = '';
    }
  }
}

// ── Module-level engine + queue ────────────────────────────────
const engine = new GameEngine();
const ballQueue = new BallQueue();

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
  sessionName: '',          // e.g. "Chase game"; used to build "Chase game - Match N" labels
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
let _runOutRuns = 0;                // runs completed before run-out
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
  if (p.get('name')) {
    document.getElementById('matchName').value = p.get('name');
    // Strip " - Match N" suffix to recover the base session name
    const raw = p.get('name');
    const cut = raw.lastIndexOf(' - Match ');
    cfg.sessionName = cut > 0 ? raw.substring(0, cut) : raw;
  }
  if (p.get('teamA')) document.getElementById('team1Name').value = p.get('teamA');
  if (p.get('teamB')) document.getElementById('team2Name').value = p.get('teamB');
  if (p.get('overs')) document.getElementById('oversInput').value = p.get('overs');
  // default toggles ON
  ['tgl-wide','tgl-nb','tgl-fh'].forEach(id => document.getElementById(id).classList.add('on'));

  // Wire the sync pill to the ball queue so the user sees pending POSTs
  const syncEl = document.getElementById('syncStatus');
  if (syncEl) ballQueue.setSyncIndicator(syncEl);

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
      name: document.getElementById('matchName').value.trim() || null,
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
    await hydrateEngine(match.id, inn.id);
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

// ── Hydration overlay + engine bootstrap ─────────────────────
let _hydrateArgs = null;

function _showHydrateOverlay(msg, showRetry = false) {
  const ov  = document.getElementById('hydrateOverlay');
  const msgEl = document.getElementById('hydrateMsg');
  const btn = document.getElementById('hydrateRetryBtn');
  if (!ov) return;
  ov.style.display = 'flex';
  if (msgEl) msgEl.textContent = msg;
  if (btn)  btn.style.display = showRetry ? '' : 'none';
}

function _hideHydrateOverlay() {
  const ov = document.getElementById('hydrateOverlay');
  if (ov) ov.style.display = 'none';
}

async function retryHydrate() {
  if (!_hydrateArgs) return;
  await hydrateEngine(_hydrateArgs[0], _hydrateArgs[1]);
}

// Fetches stored timeline + rules + over assignments and rebuilds the engine.
// CRITICAL: never let the user score if hydration fails — the overlay stays
// in place with a Retry button until the fetch succeeds.
async function hydrateEngine(matchId, inningsId) {
  _hydrateArgs = [matchId, inningsId];
  _showHydrateOverlay('Loading match…');

  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY  = 2000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const [inningsResp, rules, balls, overs] = await Promise.all([
        api('GET', `/matches/${matchId}/innings`),
        api('GET', `/matches/${matchId}/rules`),
        api('GET', `/matches/${matchId}/innings/${inningsId}/timeline`),
        api('GET', `/matches/${matchId}/innings/${inningsId}/overs`),
      ]);

      const inningsRow = (inningsResp || []).find(i => i.id === inningsId);
      if (!inningsRow) throw new Error('Innings record not found');

      engine.rebuild(
        balls,
        overs,
        inningsRow,
        rules,
        cfg.overs,
        cfg.maxWickets,
        matchState.battingTeamPlayers,
        matchState.bowlingTeamPlayers,
      );

      matchState.nextBallIsFreeHit = engine.nextBallIsFreeHit;
      if (isTeamLinked) {
        matchState.currentStrikerId    = engine.strikerId;
        matchState.currentNonStrikerId = engine.nonStrikerId;
        matchState.currentBowlerId     = engine.bowlerId;
        matchState.currentOverNumber   = (engine.legalBalls / 6) | 0;
      }

      const sc = engine.getScorecard();
      matchState.scorecard = sc;
      renderBoard(sc);
      setFreehitBanner(engine.nextBallIsFreeHit);
      _hideHydrateOverlay();
      return;

    } catch (err) {
      console.error(`hydrateEngine attempt ${attempt} failed:`, err);
      if (attempt < MAX_ATTEMPTS) {
        _showHydrateOverlay(`Loading… (attempt ${attempt + 1} of ${MAX_ATTEMPTS})`);
        await new Promise(r => setTimeout(r, RETRY_DELAY));
      } else {
        _showHydrateOverlay('Could not load match state. Check your connection and tap Retry.', true);
        throw new Error('Hydration failed after ' + MAX_ATTEMPTS + ' attempts');
      }
    }
  }
}

async function postBall(body) {
  // Tag free-hit if currently active
  if (matchState.nextBallIsFreeHit) {
    body.metadata = { ...(body.metadata || {}), free_hit: true };
  }

  // Attach batter/bowler IDs and piggybacks for team-linked mode
  if (isTeamLinked) {
    if (!body.batter_id) {
      body.batter_id = matchState.pendingBatterId || engine.strikerId || undefined;
    }
    if (!body.bowler_id) {
      body.bowler_id = engine.bowlerId || undefined;
    }
    if (_pendingNonStrikerId) {
      body.metadata = { ...(body.metadata || {}), new_non_striker_id: _pendingNonStrikerId };
    }
  }

  // Apply to local engine INSTANTLY (no await — runs synchronously)
  const result = engine.applyBall(body);

  // Clear consumed pending state
  matchState.pendingBatterId = null;
  _pendingNonStrikerId = null;

  // Sync engine state back to matchState for legacy code that reads it
  if (isTeamLinked) {
    matchState.currentStrikerId    = engine.strikerId;
    matchState.currentNonStrikerId = engine.nonStrikerId;
    matchState.currentBowlerId     = engine.bowlerId;
    matchState.currentOverNumber   = (engine.legalBalls / 6) | 0;
  }
  matchState.nextBallIsFreeHit = engine.nextBallIsFreeHit;

  // Render from engine immediately
  const sc = engine.getScorecard();
  matchState.scorecard = sc;
  renderBoard(sc);
  setFreehitBanner(engine.nextBallIsFreeHit);

  // Queue server persistence (background, fire-and-forget)
  _queueBall(body);

  // Innings-end check — if innings ends, drain queue then stop
  if (checkInningsEnd(sc)) return;

  // Trigger modals from engine result (not from server response)
  if (isTeamLinked) {
    if (result.needsNewBatter) {
      await openNewBatterModal(result.newBatterPosition);
    }
    if (result.needsNewBowler) {
      await openNewBowlerModal((engine.legalBalls / 6) | 0);
    }
  }
}

function _queueBall(body) {
  // Capture current innings ID in closure (may change across innings)
  const matchId = matchState.matchId;
  const inningsId = matchState.inningsId;
  ballQueue.enqueue(body, (b) =>
    api('POST', `/matches/${matchId}/innings/${inningsId}/ball`, b)
  );
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
  // Make sure the server has every ball before we lock the innings,
  // otherwise the target it derives could be short by 1–2 deliveries.
  try { await ballQueue.drain(); } catch(_) {}
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
    await hydrateEngine(matchState.matchId, inn.id);
  } catch(e) {
    toast(e.message, true);
  }
}

// ─── match finish ────────────────────────────────────────────

async function finishMatch(sc) {
  // Drain queued balls before fetching the final scorecard — Best Performers
  // and the scorecard view both depend on the server having every delivery.
  try { await ballQueue.drain(); } catch(_) {}
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

  document.getElementById('bestPerformers').style.display = 'none';
  showView('viewResult');
  _fetchAndShowBestPerformers();
}

// ─── best performers ─────────────────────────────────────────

async function _fetchAndShowBestPerformers() {
  if (!isTeamLinked || !matchState.matchId) return;
  try {
    const fullSc = await api('GET', `/matches/${matchState.matchId}/scorecard`);
    _renderBestPerformers(fullSc);
  } catch(e) { /* non-critical */ }
}

function _renderBestPerformers(fullSc) {
  const byTeam = {};
  for (const inn of (fullSc.innings_list || [])) {
    const bat = inn.innings.batting_team;
    const bow = inn.innings.bowling_team;
    if (!byTeam[bat]) byTeam[bat] = { batters: [], bowlers: [] };
    if (!byTeam[bow]) byTeam[bow] = { batters: [], bowlers: [] };
    (inn.batters  || []).forEach(b => byTeam[bat].batters.push(b));
    (inn.bowlers  || []).forEach(b => byTeam[bow].bowlers.push(b));
  }

  const teams = [cfg.team1, cfg.team2];
  let html = '';
  for (const team of teams) {
    const data = byTeam[team];
    if (!data) continue;
    const bestBat = [...data.batters]
      .filter(b => b.balls > 0)
      .sort((a, b) => b.runs - a.runs || b.strike_rate - a.strike_rate)[0];
    const bestBowl = [...data.bowlers]
      .filter(b => b.balls_legal > 0)
      .sort((a, b) => b.wickets - a.wickets || (a.economy || 99) - (b.economy || 99))[0];

    if (!bestBat && !bestBowl) continue;
    html += `<div class="bp-team"><div class="bp-team-name">${team}</div>`;
    if (bestBat) {
      const sr = bestBat.strike_rate != null ? bestBat.strike_rate.toFixed(0) : '—';
      html += `<div class="bp-row"><span class="bp-icon">🏏</span><span class="bp-name">${bestBat.name}</span><span class="bp-stat">${bestBat.runs} runs (${bestBat.balls}b · SR ${sr})</span></div>`;
    }
    if (bestBowl) {
      const econ = bestBowl.economy != null ? bestBowl.economy.toFixed(1) : '—';
      html += `<div class="bp-row"><span class="bp-icon">🎳</span><span class="bp-name">${bestBowl.name}</span><span class="bp-stat">${bestBowl.wickets}/${bestBowl.runs_conceded} · ${bestBowl.overs} ov · Econ ${econ}</span></div>`;
    }
    html += '</div>';
  }

  if (html) {
    document.getElementById('bpContent').innerHTML = html;
    document.getElementById('bestPerformers').style.display = '';
  }
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
function _getRunOutPlayerName(end) {
  const id = end === 'striker' ? matchState.currentStrikerId : matchState.currentNonStrikerId;
  return (id && engine._playerNames[String(id)]) || (end === 'striker' ? 'Striker' : 'Non-striker');
}
function _refreshRunOutButtons() {
  const sName = _getRunOutPlayerName('striker');
  const nsName = _getRunOutPlayerName('non_striker');
  document.getElementById('roStrikerBtn').textContent = `🏃 ${sName}`;
  document.getElementById('roNonStrikerBtn').textContent = `🏃 ${nsName}`;
}
function _renderRunOutRunBtns() {
  const el = document.getElementById('runOutRunBtns');
  if (!el) return;
  el.innerHTML = [0,1,2,3].map(n =>
    `<button class="pick-btn${_runOutRuns === n ? ' on' : ''}" onclick="setRunOutRuns(${n})">${n}</button>`
  ).join('');
}
function setRunOutRuns(n) {
  _runOutRuns = n;
  _renderRunOutRunBtns();
}
function openWicketModal() {
  _wicketType = null;
  _runOutTarget = 'striker';
  _runOutRuns = 0;
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
    _refreshRunOutButtons();
    _renderRunOutRunBtns();
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
      _runOutRuns = 0;
      _refreshRunOutButtons();
      _renderRunOutRunBtns();
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
  const isRunOut = _wicketType === 'run_out';
  const body = { event_type: 'wicket', runs: isRunOut ? _runOutRuns : 0, wicket_type: _wicketType };
  if (isTeamLinked && isRunOut) {
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
  if (engine._balls.length === 0) { toast('Nothing to undo'); return; }

  // While balls are still draining to the server, wait — undo on top of an
  // in-flight ball would race with its POST and leave engine ≠ DB.
  if (ballQueue.pendingCount > 0) {
    toast('Still syncing — try again in a moment', true);
    return;
  }

  // Roll back engine state from the remaining ball history
  engine.undo(engine.overAssignments);

  // Sync matchState from engine
  if (isTeamLinked) {
    matchState.currentStrikerId    = engine.strikerId;
    matchState.currentNonStrikerId = engine.nonStrikerId;
    matchState.currentBowlerId     = engine.bowlerId;
    matchState.currentOverNumber   = (engine.legalBalls / 6) | 0;
    matchState.pendingBatterId     = null;
  }
  matchState.nextBallIsFreeHit = engine.nextBallIsFreeHit;

  // Render from engine immediately
  const sc = engine.getScorecard();
  matchState.scorecard = sc;
  renderBoard(sc);
  setFreehitBanner(engine.nextBallIsFreeHit);

  // Tell server to delete the last stored ball (background)
  try {
    await api('POST', `/matches/${matchState.matchId}/innings/${matchState.inningsId}/undo`);
    toast('Last ball undone');
  } catch(e) {
    toast('Undo saved locally but server sync failed', true);
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
// PLAY AGAIN — multi-page modal
// ═══════════════════════════════════════════════════════════════

let _paTeamAPlayers = null; // null = use existing matchState arrays; set when new teams chosen
let _paTeamBPlayers = null;
let _paEditPlayers  = null; // [{id,name,can_bowl,bowl_type,team:'A'|'B'}] for manual editor
let _paManualPrevPage = 'paPageOptions';

function _paShowPage(id) {
  ['paPageOptions','paPageRandom','paPageManual','paPageToss'].forEach(p => {
    const el = document.getElementById(p);
    if (el) el.style.display = p === id ? '' : 'none';
  });
}

function openPlayAgainModal() {
  cfg.matchNum = (cfg.matchNum || 1) + 1;
  _paTeamAPlayers = null;
  _paTeamBPlayers = null;
  _paEditPlayers  = null;

  const _paTitle = cfg.sessionName ? `${cfg.sessionName} - Match ${cfg.matchNum}` : `Match ${cfg.matchNum}`;
  document.getElementById('paMatchNum').textContent = _paTitle;
  document.getElementById('paTeamInfo').textContent = `${cfg.team1} vs ${cfg.team2} · ${cfg.overs} overs`;
  document.getElementById('paTeam1Btn').textContent = `${cfg.team1} bats first`;
  document.getElementById('paTeam2Btn').textContent = `${cfg.team2} bats first`;

  const hasSession = !!(isTeamLinked && _urlParams.get('session'));
  document.getElementById('paOptRandom').style.display = hasSession ? '' : 'none';
  document.getElementById('paOptManual').style.display = hasSession ? '' : 'none';

  _paShowPage('paPageOptions');
  openModal('playAgainModal');
}

function _paSameTeams() { _paToss(); }

async function _paRandom() {
  _paShowPage('paPageRandom');
  const sessionId = _urlParams.get('session');
  document.getElementById('paRandomContent').innerHTML =
    '<div style="color:var(--muted);font-family:\'DM Mono\',monospace;font-size:.72rem;text-align:center;padding:14px 0">Generating…</div>';

  try {
    const teams = await api('POST', `/sessions/${sessionId}/teams/generate`, {
      team_a_name: cfg.team1,
      team_b_name: cfg.team2,
    });
    _paTeamAPlayers = (teams.assignments || [])
      .filter(a => a.team_name === cfg.team1)
      .map(a => ({ id: a.player_id, name: a.player_name, can_bowl: a.can_bowl, bowl_type: a.bowl_type || 'legal' }));
    _paTeamBPlayers = (teams.assignments || [])
      .filter(a => a.team_name === cfg.team2)
      .map(a => ({ id: a.player_id, name: a.player_name, can_bowl: a.can_bowl, bowl_type: a.bowl_type || 'legal' }));

    const tagList = players => players.map(p => `<span class="pa-player-tag">${p.name}</span>`).join('');
    document.getElementById('paRandomContent').innerHTML = `
      <div class="pa-preview-block"><div class="pa-preview-label">${cfg.team1}</div><div class="pa-player-tags">${tagList(_paTeamAPlayers)}</div></div>
      <div class="pa-preview-block" style="margin-top:10px"><div class="pa-preview-label">${cfg.team2}</div><div class="pa-player-tags">${tagList(_paTeamBPlayers)}</div></div>`;
  } catch(e) {
    document.getElementById('paRandomContent').innerHTML =
      `<div style="color:var(--red);font-family:'DM Mono',monospace;font-size:.72rem;text-align:center;padding:14px 0">Error: ${e.message}</div>`;
  }
}

function _paManual(backTarget) {
  _paManualPrevPage = backTarget || 'paPageOptions';

  if (_paTeamAPlayers && _paTeamBPlayers) {
    _paEditPlayers = [
      ..._paTeamAPlayers.map(p => ({ ...p, team: 'A' })),
      ..._paTeamBPlayers.map(p => ({ ...p, team: 'B' })),
    ];
  } else {
    const batIsA = matchState._batTeamName === cfg.team1;
    const aPlayers = batIsA ? matchState.battingTeamPlayers : matchState.bowlingTeamPlayers;
    const bPlayers = batIsA ? matchState.bowlingTeamPlayers : matchState.battingTeamPlayers;
    _paEditPlayers = [
      ...(aPlayers || []).map(p => ({ ...p, team: 'A' })),
      ...(bPlayers || []).map(p => ({ ...p, team: 'B' })),
    ];
  }

  _renderManualEditor();
  _paShowPage('paPageManual');
}

function _renderManualEditor() {
  const col = (players, side) => players.map(p =>
    `<button class="pa-player-chip" onclick="_paTogglePlayer('${p.id}')">${p.name} <span class="pa-chip-arr">${side === 'A' ? '→' : '←'}</span></button>`
  ).join('');

  const aPlayers = _paEditPlayers.filter(p => p.team === 'A');
  const bPlayers = _paEditPlayers.filter(p => p.team === 'B');
  document.getElementById('paManualContent').innerHTML = `
    <div class="pa-editor-cols">
      <div class="pa-col"><div class="pa-col-label">${cfg.team1}</div>${col(aPlayers, 'A')}</div>
      <div class="pa-col"><div class="pa-col-label">${cfg.team2}</div>${col(bPlayers, 'B')}</div>
    </div>`;
}

function _paTogglePlayer(id) {
  const p = _paEditPlayers.find(p => p.id === id);
  if (p) { p.team = p.team === 'A' ? 'B' : 'A'; _renderManualEditor(); }
}

function _paManualBack() { _paShowPage(_paManualPrevPage); }

function _paConfirmManual() {
  _paTeamAPlayers = _paEditPlayers.filter(p => p.team === 'A').map(({ team, ...p }) => p);
  _paTeamBPlayers = _paEditPlayers.filter(p => p.team === 'B').map(({ team, ...p }) => p);
  _paToss();
}

function _paToss() {
  document.getElementById('paTossSection').style.display = '';
  document.getElementById('paChooseSection').style.display = 'none';
  document.getElementById('paTossText').textContent = 'Who bats first?';
  document.getElementById('paCoin').textContent = '🪙';
  document.getElementById('paCoin').classList.remove('spinning');
  _paShowPage('paPageToss');
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
  const prevTeam1   = cfg.team1; // save before reassignment for player-array logic

  try {
    const sessionId = _urlParams.get('session') || null;
    const matchName = cfg.sessionName
      ? `${cfg.sessionName} - Match ${cfg.matchNum}`
      : `Match ${cfg.matchNum}`;

    // Team-linked: create match upfront (startMatch() in team-linked only patches rules, not creates)
    // Quick mode: don't create match here — let startMatch() create it normally
    if (isTeamLinked) {
      const rules = buildRulesObject();
      const match = await api('POST', '/matches', {
        session_id: sessionId,
        match_type: 'team',
        overs: cfg.overs,
        players_per_side: cfg.playersPerSide || 6,
        rules_preset: 'custom',
        rules,
        name: matchName,
      });
      matchState.matchId = match.id;
      _setWatchCode(match.watch_code);

      // Set player arrays for opening pair modal
      if (_paTeamAPlayers) {
        // New teams from random/manual — _paTeamAPlayers is for the original cfg.team1 (prevTeam1)
        if (battingTeam === prevTeam1) {
          matchState.battingTeamPlayers = _paTeamAPlayers;
          matchState.bowlingTeamPlayers = _paTeamBPlayers || [];
        } else {
          matchState.battingTeamPlayers = _paTeamBPlayers || [];
          matchState.bowlingTeamPlayers = _paTeamAPlayers;
        }
      } else {
        // Same teams — swap if batting order changed
        if (battingTeam !== matchState._batTeamName) {
          const temp = matchState.battingTeamPlayers;
          matchState.battingTeamPlayers = matchState.bowlingTeamPlayers;
          matchState.bowlingTeamPlayers = temp;
        }
      }
      matchState._batTeamName = battingTeam;
      matchState._pendingBat  = battingTeam;
      matchState._pendingBow  = bowlingTeam;

      // Keep team name inputs read-only (teams are fixed once session is linked)
      document.getElementById('team1Name').readOnly = true;
      document.getElementById('team2Name').readOnly = true;
      document.getElementById('team1Name').style.opacity = '.65';
      document.getElementById('team2Name').style.opacity = '.65';
    }

    // Reset common state
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

    cfg.team1 = battingTeam;
    cfg.team2 = bowlingTeam;

    setFreehitBanner(false);
    document.getElementById('statTargetWrap').style.display = 'none';
    document.getElementById('statRRRWrap').style.display = 'none';
    document.getElementById('chaseBar').classList.remove('show');
    const ps = document.getElementById('playerStrip');
    if (ps) ps.style.display = 'none';
    document.getElementById('bestPerformers').style.display = 'none';

    // Pre-fill setup form so user can review/adjust before starting
    document.getElementById('matchName').value = matchName;
    document.getElementById('oversInput').value = cfg.overs;
    document.getElementById('playersInput').value = cfg.playersPerSide || 6;
    document.getElementById('wicketsInput').value = cfg.maxWickets;
    document.getElementById('team1Name').value = battingTeam;
    document.getElementById('team2Name').value = bowlingTeam;

    switchScoreTab('live');
    showView('viewSetup');

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
  engine.reset();
  ballQueue.clear();
  cfg.matchNum = 1;
  const t1 = document.getElementById('team1Name');
  const t2 = document.getElementById('team2Name');
  t1.value = ''; t1.readOnly = false; t1.style.opacity = '';
  t2.value = ''; t2.readOnly = false; t2.style.opacity = '';
  document.getElementById('statTargetWrap').style.display = 'none';
  document.getElementById('statRRRWrap').style.display = 'none';
  document.getElementById('chaseBar').classList.remove('show');
  const ps = document.getElementById('playerStrip');
  if (ps) ps.style.display = 'none';
  setFreehitBanner(false);
  document.getElementById('bestPerformers').style.display = 'none';
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
      // Respect toss decision: battingFirst param tells us which team bats
      const battingFirst = _urlParams.get('battingFirst');
      const batName = (battingFirst && [teams.team_a_name, teams.team_b_name].includes(battingFirst))
        ? battingFirst
        : teams.team_a_name;
      const bowName = batName === teams.team_a_name ? teams.team_b_name : teams.team_a_name;

      cfg.team1 = batName;
      cfg.team2 = bowName;
      document.getElementById('team1Name').value = batName;
      document.getElementById('team2Name').value = bowName;
      document.getElementById('team1Name').readOnly = true;
      document.getElementById('team2Name').readOnly = true;
      document.getElementById('team1Name').style.opacity = '.65';
      document.getElementById('team2Name').style.opacity = '.65';

      matchState.battingTeamPlayers = teams.assignments
        .filter(a => a.team_name === batName)
        .map(a => ({ id: String(a.player_id), name: a.player_name, can_bowl: a.can_bowl, bowl_type: a.bowl_type || 'legal' }));
      matchState.bowlingTeamPlayers = teams.assignments
        .filter(a => a.team_name === bowName)
        .map(a => ({ id: String(a.player_id), name: a.player_name, can_bowl: a.can_bowl, bowl_type: a.bowl_type || 'legal' }));
      matchState._batTeamName = batName;
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

    // Hydrate engine from the freshly created innings + over assignment
    await hydrateEngine(matchState.matchId, inn.id);
  } catch(e) {
    toast(e.message, true);
  } finally {
    _openingPairSubmitting = false;
  }
}

// ── New Batter Modal ─────────────────────────────────────────

function _renderNewBatterPosition() {
  const posRow = document.getElementById('newBatterPositionRow');
  const posText = document.getElementById('newBatterPositionText');
  const otherEndEl = document.getElementById('newBatterOtherEnd');
  if (!posRow || !isTeamLinked) return;

  const isStriker = _newBatterPosition === 'striker';
  posRow.style.display = '';
  posText.textContent = isStriker ? '🏏 Striker end (faces next ball)' : '🤝 Non-striker end';

  // Show who is at the other end
  const otherId = isStriker ? matchState.currentNonStrikerId : matchState.currentStrikerId;
  const otherName = (otherId && engine._playerNames[String(otherId)]) || null;
  const otherLabel = isStriker ? 'Non-striker' : 'Striker';
  otherEndEl.textContent = otherName
    ? `${otherLabel}: ${otherName} stays at the other end`
    : `${otherLabel} end is also vacant`;
}

async function openNewBatterModal(position = 'striker') {
  _newBatterPosition = position;

  if (!isTeamLinked) return; // quick mode: no batter modal

  const batters = engine.getEligibleBatters(matchState.battingTeamPlayers);
  if (!batters.length) return; // innings ended / last man

  document.getElementById('newBatterTitle').textContent = position === 'non_striker' ? 'New Non-Striker In' : 'New Batter In';
  _renderNewBatterPosition();
  const sel = document.getElementById('newBatterSel');
  sel.innerHTML = '<option value="">Pick incoming batter...</option>' +
    batters.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  openModal('newBatterModal');
}

function swapNewBatterPosition() {
  _newBatterPosition = _newBatterPosition === 'striker' ? 'non_striker' : 'striker';
  document.getElementById('newBatterTitle').textContent =
    _newBatterPosition === 'non_striker' ? 'New Non-Striker In' : 'New Batter In';
  _renderNewBatterPosition();
}

function submitNewBatter() {
  const batterId = document.getElementById('newBatterSel').value;
  if (!batterId) { toast('Select a batter', true); return; }

  // Update engine crease state immediately (no server call needed)
  if (_newBatterPosition === 'non_striker') {
    // Non-striker run-out replacement piggybacks onto next ball metadata so
    // the server's _derive_batting_state can reproduce the swap.
    _pendingNonStrikerId = batterId;
    engine.seatBatter(batterId, 'non_striker');
    matchState.currentNonStrikerId = batterId;
  } else {
    matchState.pendingBatterId = batterId;
    engine.seatBatter(batterId, 'striker');
    matchState.currentStrikerId = batterId;
  }

  // Update the player strip so the user sees the incoming batter right away
  renderPlayerStrip(engine.getScorecard());
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

  // Quick mode has no player roster — skip the modal entirely
  if (!isTeamLinked) {
    openModal('newBowlerModal');
    return;
  }

  // Eligibility computed entirely client-side from the engine
  const eligible = engine.getEligibleBowlers(matchState.bowlingTeamPlayers);

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

  matchState._newBowlType = 'legal';
  document.getElementById('newBtLegal').classList.add('on');
  document.getElementById('newBtThrow').classList.remove('on');

  openModal('newBowlerModal');
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

  const bowlerId = matchState._selectedBowlerId;
  const bowlType = matchState._newBowlType || 'legal';
  const overNum  = matchState._forOver != null ? matchState._forOver : ((engine.legalBalls / 6) | 0);

  // Register in engine immediately so the next ball can use the bowler
  engine.addOverAssignment(overNum, bowlerId, bowlType);
  matchState.currentBowlerId = bowlerId;
  closeModal('newBowlerModal');

  // Re-render strip with new bowler in place
  renderPlayerStrip(engine.getScorecard());

  // Persist in background — failure shouldn't block scoring
  const matchId = matchState.matchId;
  const inningsId = matchState.inningsId;
  try {
    await api('POST', `/matches/${matchId}/innings/${inningsId}/overs`, {
      bowler_id: bowlerId,
      bowl_type: bowlType,
    });
  } catch(e) {
    toast('Bowler sync failed: ' + e.message, true);
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
