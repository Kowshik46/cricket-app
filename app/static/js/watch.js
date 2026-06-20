// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let watchCode  = null;
let pollTimer  = null;
let lastData   = null;
let nameMap    = {};          // id -> player name (global across all innings)
let innOpenMap = {};          // inningsId -> boolean (scorecard collapse state)

// ═══════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════

(function init() {
  const params = new URLSearchParams(location.search);
  const code = (params.get('code') || '').trim().toUpperCase();
  if (code) {
    watchCode = code;
    showLoading();
    fetchAndRender();
  } else {
    showEntry();
  }
})();

// ═══════════════════════════════════════════════════════════════
// ENTRY / NAVIGATION
// ═══════════════════════════════════════════════════════════════

function showEntry() {
  clearPoll();
  setVis('entryCard', true); setVis('errorCard', false);
  setVis('loadingCard', false); setVis('matchContent', false);
}

function showLoading() {
  setVis('entryCard', false); setVis('errorCard', false);
  setVis('loadingCard', true); setVis('matchContent', false);
}

function showError(title, msg) {
  clearPoll();
  document.getElementById('errorTitle').textContent = title;
  document.getElementById('errorMsg').textContent   = msg;
  setVis('entryCard', false); setVis('errorCard', true);
  setVis('loadingCard', false); setVis('matchContent', false);
}

function showMatch() {
  setVis('entryCard', false); setVis('errorCard', false);
  setVis('loadingCard', false); setVis('matchContent', true);
}

function goWatch() {
  const code = document.getElementById('codeInput').value.trim().toUpperCase();
  if (code.length < 4) { toast('Enter the match code', true); return; }
  watchCode = code;
  history.replaceState(null, '', '/watch?code=' + code);
  showLoading();
  fetchAndRender();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('entryCard').style.display !== 'none') goWatch();
});

// ═══════════════════════════════════════════════════════════════
// FETCH + POLL
// ═══════════════════════════════════════════════════════════════

async function fetchAndRender() {
  try {
    const res = await fetch('/api/watch/' + watchCode);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showError('Match not found', err.detail || 'Check the code and try again.');
      return;
    }
    lastData = await res.json();
    buildNameMap(lastData);
    renderAll(lastData);
    showMatch();
    schedulePoll(lastData.scorecard.match.status);
  } catch(e) {
    showError('Connection error', 'Could not reach the server. Try refreshing.');
  }
}

function schedulePoll(status) {
  clearPoll();
  if (status === 'completed') return;
  pollTimer = setTimeout(() => fetchAndRender(), status === 'setup' ? 8000 : 5000);
}

function clearPoll() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

// ═══════════════════════════════════════════════════════════════
// NAME MAP — covers at-crease players not yet in ball events
// ═══════════════════════════════════════════════════════════════

function buildNameMap(data) {
  nameMap = { ...(data.player_names || {}) };
  for (const inn of (data.scorecard?.innings_list || [])) {
    for (const b of (inn.batters  || [])) nameMap[String(b.player_id)] = b.name;
    for (const b of (inn.bowlers  || [])) nameMap[String(b.player_id)] = b.name;
  }
}

function pname(id) {
  return id ? (nameMap[String(id)] || '—') : '—';
}

// ═══════════════════════════════════════════════════════════════
// RENDER — top level
// ═══════════════════════════════════════════════════════════════

function renderAll(data) {
  const { match_name, watch_code, scorecard } = data;
  const match   = scorecard.match;
  const innings = scorecard.innings_list || [];

  document.getElementById('wMatchName').textContent = match_name;
  document.getElementById('wCodeBadge').textContent = watch_code || '';

  renderStatusPill(match.status);

  // Find the active (live) innings to show in the scoreboard
  const activeInn = innings.find(i => i.innings.status === 'live') || innings[innings.length - 1];
  if (activeInn) {
    renderScoreboard(activeInn, match);
    renderPlayerStrip(activeInn);
  }

  renderFeed(innings, match);
  renderScorecard(innings, match);

  document.getElementById('lastUpdated').textContent =
    '🔄 Updated ' + new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
}

// ═══════════════════════════════════════════════════════════════
// STATUS PILL
// ═══════════════════════════════════════════════════════════════

function renderStatusPill(status) {
  const el = document.getElementById('statusPill');
  const map = {
    setup:         ['setup', '⏳ Waiting to start'],
    live:          ['live',  'LIVE'],
    innings_break: ['break', '🏏 Innings Break'],
    completed:     ['done',  '✅ Match Complete'],
  };
  const [cls, txt] = map[status] || ['setup', status];
  el.className = 'status-pill ' + cls;
  el.textContent = txt;
}

// ═══════════════════════════════════════════════════════════════
// SCOREBOARD
// ═══════════════════════════════════════════════════════════════

function renderScoreboard(inn, match) {
  const i = inn.innings;
  document.getElementById('wBatTeam').textContent  = i.batting_team || '—';
  document.getElementById('wInnBadge').textContent = i.innings_number === 1 ? '1st Inn' : '2nd Inn';
  document.getElementById('wRuns').textContent     = inn.total_runs;
  document.getElementById('wWickets').textContent  = inn.total_wickets;
  document.getElementById('wOvers').textContent    = `${fmt(inn.total_overs)} / ${match.overs} overs`;
  document.getElementById('wRR').textContent       = inn.run_rate?.toFixed(2) ?? '0.00';

  const extrasEl = document.getElementById('wExtras');
  if (inn.target != null) {
    const need = inn.target - inn.total_runs;
    if (inn.required_run_rate != null && inn.required_run_rate > 0) {
      extrasEl.textContent = `Target ${inn.target} · Need ${need > 0 ? need : 0} · RRR ${inn.required_run_rate.toFixed(2)}`;
      extrasEl.style.display = '';
    } else {
      extrasEl.textContent = `Target ${inn.target}`;
      extrasEl.style.display = '';
    }
  } else {
    extrasEl.style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════════════
// PLAYER STRIP
// ═══════════════════════════════════════════════════════════════

function renderPlayerStrip(inn) {
  const strip = document.getElementById('playerStrip');
  const strikerId  = inn.current_striker_id;
  const nstrikerId = inn.current_non_striker_id;
  const bowlerId   = inn.current_bowler_id;

  if (!strikerId && !nstrikerId && !bowlerId) {
    strip.style.display = 'none'; return;
  }

  // Striker
  const hasStriker = !!strikerId;
  setVis('psStriker', hasStriker);
  setVis('psDiv1',    hasStriker && (!!nstrikerId || !!bowlerId));
  if (hasStriker) {
    document.getElementById('psStrikerName').textContent = pname(strikerId);
    const bs = inn.batters?.find(b => String(b.player_id) === String(strikerId));
    document.getElementById('psStrikerStat').textContent = bs ? `${bs.runs} (${bs.balls})` : '';
  }

  // Non-striker
  const hasNS = !!nstrikerId;
  setVis('psNonStriker', hasNS);
  setVis('psDiv2',       hasNS && !!bowlerId);
  if (hasNS) {
    document.getElementById('psNonStrikerName').textContent = pname(nstrikerId);
    const nb = inn.batters?.find(b => String(b.player_id) === String(nstrikerId));
    document.getElementById('psNonStrikerStat').textContent = nb ? `${nb.runs} (${nb.balls})` : '';
  }

  // Bowler
  const hasBowler = !!bowlerId;
  setVis('psBowler', hasBowler);
  if (hasBowler) {
    document.getElementById('psBowlerName').textContent = pname(bowlerId);
    const bw = inn.bowlers?.find(b => String(b.player_id) === String(bowlerId));
    document.getElementById('psBowlerStat').textContent = bw ? `${bw.overs}.${bw.balls_legal} ov ${bw.runs_conceded}R ${bw.wickets}W` : '';
  }

  strip.style.display = 'flex';
}

// ═══════════════════════════════════════════════════════════════
// LIVE FEED (ball-by-ball, most recent first)
// ═══════════════════════════════════════════════════════════════

function renderFeed(innings, match) {
  const el = document.getElementById('feedContent');
  const allInnings = innings.filter(i => (i.balls || []).length > 0);

  if (!allInnings.length) {
    el.innerHTML = '<p class="empty-feed">Waiting for first ball…</p>'; return;
  }

  let html = '';

  // Show innings from most recent first
  for (let ii = allInnings.length - 1; ii >= 0; ii--) {
    const inn = allInnings[ii];
    const balls = inn.balls || [];
    if (!balls.length) continue;

    const isActive = inn.innings.status === 'live';

    // When showing multiple innings, add a divider
    if (allInnings.length > 1) {
      html += `<div style="font-family:'DM Mono',monospace;font-size:.6rem;color:var(--muted);
        letter-spacing:1.5px;text-transform:uppercase;padding:10px 0 4px;
        border-top:${ii < allInnings.length - 1 ? '1px solid var(--border)' : 'none'}">
        ${inn.innings.batting_team} · ${inn.innings.innings_number === 1 ? '1st' : '2nd'} Innings
      </div>`;
    }

    // Group balls by over_number
    const overMap = {};
    for (const ball of balls) {
      const k = ball.over_number;
      if (!overMap[k]) overMap[k] = [];
      overMap[k].push(ball);
    }

    const overNums = Object.keys(overMap).map(Number).sort((a,b) => b - a); // most recent first

    for (const ovNum of overNums) {
      const ovBalls = overMap[ovNum];
      const isCurrentOver = isActive && ovNum === inn.current_over_number;
      const legalBalls = ovBalls.filter(b => b.is_legal_ball).length;
      const ovRuns = ovBalls.reduce((s,b) => s + b.runs + b.extras, 0);
      const ovWkts = ovBalls.filter(b => b.event_type === 'wicket').length;

      const tallyParts = [`${ovRuns} run${ovRuns !== 1 ? 's' : ''}`];
      if (ovWkts) tallyParts.push(`${ovWkts} wkt${ovWkts > 1 ? 's' : ''}`);
      if (isCurrentOver) tallyParts.push(`${legalBalls}/6 balls`);

      html += `<div class="over-group">
        <div class="over-hdr">
          <span class="over-hdr-num${isCurrentOver ? ' current' : ''}">OVER ${ovNum + 1}${isCurrentOver ? ' (current)' : ''}</span>
          <span class="over-hdr-line"></span>
          <span class="over-hdr-tally">${tallyParts.join(' · ')}</span>
        </div>`;

      // Balls within over — most recent first
      const sortedBalls = [...ovBalls].sort((a,b) => b.ball_number - a.ball_number);

      for (const ball of sortedBalls) {
        const { ballNum, chipCls, chipTxt, mainTxt, subTxt } = describeBall(ball, ovNum);
        html += `<div class="ball-row">
          <span class="ball-num">${ballNum}</span>
          <div class="ball-chip ${chipCls}">${chipTxt}</div>
          <div class="ball-desc">
            <span class="bd-main">${mainTxt}</span>
            ${subTxt ? `<span class="bd-sub">${subTxt}</span>` : ''}
          </div>
        </div>`;
      }

      html += `</div>`;
    }
  }

  el.innerHTML = html;
}

function describeBall(ball, ovNum) {
  const legalPos = ball.ball_number + 1;
  const ballNum  = ball.is_legal_ball ? `${ovNum + 1}.${legalPos}` : `${ovNum + 1}.*`;
  const striker  = pname(ball.batter_id);
  const bowler   = pname(ball.bowler_id);
  const hasBowler = ball.bowler_id && pname(ball.bowler_id) !== '—';

  let chipCls = 'chip-dot', chipTxt = '·', mainTxt = '', subTxt = '';

  switch (ball.event_type) {
    case 'wicket': {
      chipCls = 'chip-wicket'; chipTxt = 'W';
      const wt = (ball.wicket_type || 'out').replace(/_/g, ' ');
      mainTxt = `<span class="bd-wkt">${striker !== '—' ? striker : 'Batter'} — ${wt}</span>`;
      subTxt  = hasBowler && ball.wicket_type !== 'run_out' ? `b ${bowler}` : (hasBowler ? `(${bowler})` : '');
      break;
    }
    case 'wide': {
      chipCls = 'chip-wide'; chipTxt = 'Wd';
      mainTxt = `Wide${ball.extras > 1 ? ` +${ball.extras}` : ''}`;
      subTxt  = hasBowler ? `${bowler}` : '';
      break;
    }
    case 'no_ball': {
      chipCls = 'chip-noball'; chipTxt = 'NB';
      mainTxt = `No Ball${ball.runs > 0 ? ` · ${striker !== '—' ? striker : 'Batter'} scored ${ball.runs}` : ''}`;
      subTxt  = hasBowler ? `${bowler}` : '';
      break;
    }
    case 'bye': {
      chipCls = 'chip-runs'; chipTxt = ball.extras || '·';
      mainTxt = `${ball.extras} Bye${ball.extras > 1 ? 's' : ''}`;
      subTxt  = hasBowler ? `${bowler}` : '';
      break;
    }
    case 'leg_bye': {
      chipCls = 'chip-runs'; chipTxt = ball.extras || '·';
      mainTxt = `${ball.extras} Leg Bye${ball.extras > 1 ? 's' : ''}`;
      subTxt  = hasBowler ? `${bowler}` : '';
      break;
    }
    default: {
      if (ball.is_boundary && ball.boundary_type === 'six') {
        chipCls = 'chip-six';  chipTxt = '6';
        mainTxt = `<span class="bd-six">${striker !== '—' ? striker : 'Batter'} hits SIX!</span>`;
        subTxt  = hasBowler ? `off ${bowler}` : '';
      } else if (ball.is_boundary && ball.boundary_type === 'four') {
        chipCls = 'chip-four'; chipTxt = '4';
        mainTxt = `<span class="bd-four">${striker !== '—' ? striker : 'Batter'} hits FOUR</span>`;
        subTxt  = hasBowler ? `off ${bowler}` : '';
      } else if (ball.runs > 0) {
        chipCls = 'chip-runs'; chipTxt = ball.runs;
        mainTxt = `${striker !== '—' ? striker : 'Batter'} scores ${ball.runs}`;
        subTxt  = hasBowler ? `off ${bowler}` : '';
      } else {
        chipCls = 'chip-dot'; chipTxt = '·';
        mainTxt = `Dot ball${striker !== '—' ? ` — ${striker}` : ''}`;
        subTxt  = hasBowler ? `off ${bowler}` : '';
      }
    }
  }

  return { ballNum, chipCls, chipTxt, mainTxt, subTxt };
}

// ═══════════════════════════════════════════════════════════════
// SCORECARD (collapsible innings cards)
// ═══════════════════════════════════════════════════════════════

function renderScorecard(innings, match) {
  const el = document.getElementById('scorecardContent');
  if (!innings.length) {
    el.innerHTML = '<p class="empty-feed">Match hasn\'t started yet.</p>'; return;
  }

  let html = '';
  for (const inn of innings) {
    html += buildInnCard(inn, match);
  }
  el.innerHTML = html;

  // Auto-open the active (live) innings
  for (const inn of innings) {
    if (inn.innings.status === 'live') {
      const id = inn.innings.id;
      const card = document.getElementById('inn-' + id);
      if (card) { card.classList.add('open'); innOpenMap[id] = true; }
    }
  }
}

function buildInnCard(inn, match) {
  const i      = inn.innings;
  const id     = i.id;
  const innNum = i.innings_number === 1 ? '1st' : '2nd';
  const scoreStr = `${inn.total_runs}/${inn.total_wickets} (${fmt(inn.total_overs)})`;
  const isLive = i.status === 'live';

  let batHtml = '', bowlHtml = '';

  // Batting table
  if ((inn.batters || []).length) {
    const rows = inn.batters.map(b => {
      const isOut = b.status === 'out';
      const dis = isOut ? (b.dismissal || 'out').replace(/_/g,' ') : 'batting *';
      return `<tr>
        <td>
          <span class="sc-name ${isOut ? '' : 'sc-not-out'}">${esc(b.name)}</span>
          <span class="sc-sub">${dis}</span>
        </td>
        <td class="sc-bold">${b.runs}</td>
        <td>${b.balls}</td>
        <td>${b.fours}</td>
        <td>${b.sixes}</td>
        <td>${b.strike_rate?.toFixed(0) ?? '0'}</td>
      </tr>`;
    }).join('');
    batHtml = `
      <div class="sc-section-lbl">Batting</div>
      <table class="sc-tbl">
        <thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // Bowling table
  if ((inn.bowlers || []).length) {
    const rows = inn.bowlers.map(b => {
      const oStr = `${b.overs}${b.balls_legal > 0 ? '.' + b.balls_legal : ''}`;
      const throwTag = b.throw_overs > 0 ? ` <span class="sc-throw">(T)</span>` : '';
      return `<tr>
        <td><span class="sc-name">${esc(b.name)}${throwTag}</span></td>
        <td>${oStr}</td>
        <td>${b.runs_conceded}</td>
        <td class="sc-bold">${b.wickets}</td>
        <td>${b.economy?.toFixed(1) ?? '—'}</td>
      </tr>`;
    }).join('');
    bowlHtml = `
      <div class="sc-section-lbl">Bowling</div>
      <table class="sc-tbl">
        <thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>Econ</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  const liveDot = isLive ? `<span style="display:inline-block;width:6px;height:6px;background:var(--live);border-radius:50%;margin-right:6px;animation:pulse 1.2s ease-in-out infinite"></span>` : '';

  return `
    <div class="inn-collapse" id="inn-${id}">
      <div class="inn-collapse-hdr" onclick="toggleInn('${id}')">
        <div class="inn-col-left">
          <div class="inn-col-team">${liveDot}${esc(i.batting_team)} · ${innNum} Inn</div>
          <div class="inn-col-sub">${isLive ? 'live · ' : ''}bowling: ${esc(i.bowling_team)}</div>
        </div>
        <div class="inn-col-score">${scoreStr}</div>
        <div class="inn-col-chev">▼</div>
      </div>
      <div class="inn-collapse-body">
        ${batHtml || '<p class="empty-feed" style="padding:8px 0 4px">No balls yet</p>'}
        ${bowlHtml}
      </div>
    </div>`;
}

function toggleInn(id) {
  const el = document.getElementById('inn-' + id);
  if (!el) return;
  el.classList.toggle('open');
  innOpenMap[id] = el.classList.contains('open');
}

// ═══════════════════════════════════════════════════════════════
// TAB SWITCHING
// ═══════════════════════════════════════════════════════════════

function switchMain(which) {
  document.getElementById('mtabFeed').classList.toggle('on', which === 'feed');
  document.getElementById('mtabCard').classList.toggle('on', which === 'card');
  document.getElementById('panelFeed').style.display = which === 'feed' ? '' : 'none';
  document.getElementById('panelCard').style.display = which === 'card' ? '' : 'none';
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function setVis(id, show) { document.getElementById(id).style.display = show ? '' : 'none'; }

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fmt(v) {
  if (v == null) return '0.0';
  const n = Math.floor(v);
  const b = Math.round((v - n) * 10);
  return `${n}.${b}`;
}

function toast(msg, isErr = false) {
  const el = document.getElementById('toastEl');
  el.textContent = msg;
  el.className = 'toast' + (isErr ? ' error' : '');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}
