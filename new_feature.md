# Team-Linked Scorekeeping — Action Plan

> **Status:** Plan v1 — ready to build. Trigger from a fresh chat by referencing this file.
> **Created:** 2026-06-18

Comprehensive, self-contained plan based on four confirmed product decisions:

- **Both modes coexist** — `/score` standalone stays as-is for ad-hoc Quick Score; new rich mode is opened only via the Players → Teams → Toss → Score path.
- **Throw bowling = per-over choice** at bowler-pick time, counted toward a per-team cap.
- **Full standard cricket rules** for rotation, consecutive-over bowling, and bowler-overs cap (hard enforce).
- **Per-match rules** configured in Setup (no global defaults). User sets `max_overs_per_bowler` and `max_throw_overs_per_team` fresh each match.

---

## 1. Goals & scope

1. New entry point: **`/score?match_id=<id>`** with full team context (or new route `/play/<session_id>`).
2. Pre-play setup modal: pick opening **striker**, **non-striker**, **opening bowler** + **bowl type (legal | throw)** for over 1.
3. Live scoring with **per-ball batter/bowler attribution** stored on `ball_events`.
4. **Automatic striker rotation** (odd runs / end-of-over) — derived from the ball timeline + opening pair.
5. **Wicket → new-batter modal** that picks the incoming batter from remaining team members.
6. **Over-end → new-bowler modal** that picks bowler + bowl type, gated by:
   - cannot pick the bowler who just finished the previous over
   - cannot pick a bowler who has hit `max_overs_per_bowler`
   - cannot pick "throw" if team has hit `max_throw_overs_per_team`
7. **Per-match config** for the two new caps, plus per-player **default `bowl_type`** captured at team-generation time but overridable per over.
8. **Player-level stats** (runs/balls/4s/6s/SR for batters; overs/runs/wkts/economy for bowlers) computed from the timeline and shown on the live scorecard.

Out of scope for v1: substitutions/retired hurt, fielding stats (catches/run-outs), wagon wheels, partnership tracking.

---

## 2. UX flow (rich mode)

```
Step 1 Players ─┐
Step 2 Teams    │  unchanged
Step 3 Toss     │
                ↓
[Toss decision saved with elected_to=bat|field]
                ↓
"🏏 Score →" button on toss screen creates a Match
                ↓
NEW Step 4: Match Setup screen (lives in /score?match_id=<id>)
  - Read-only: team names (from teams), batting order (from toss winner)
  - Overs, players/side (locked to team size), max wickets
  - Rules toggles (wide/no-ball/free-hit) — unchanged
  - NEW: Max overs per bowler         [int input]
  - NEW: Max throw overs per team     [int input]
  - "Start Innings 1 →"
                ↓
NEW Opening Pair Modal:
  - Striker          [dropdown of batting team players]
  - Non-striker      [dropdown, excludes striker]
  - Opening Bowler   [dropdown of bowling team players who have can_bowl=true]
  - Bowl type        [Legal | Throw]
  - "Start Over 1"
                ↓
Scoring view (existing run-grid + event-grid) — additions:
  - Header: "Striker: NAME (R*/B) | Non-striker: NAME (R/B)"
  - Bowler line: "Bowler: NAME · Over 1.3 · This over: 2-0-4-0"
  - Each ball click → POST with batter_id=striker, bowler_id=current
  - Automatic striker swap on odd runs (1/3/5/byes/lb), end of over swap
                ↓
On wicket event → NEW New-Batter Modal:
  - Dropdown of remaining batters (team minus already-batted minus current non-striker)
  - "Continue"
                ↓
End of over (6 legal balls) → NEW New-Bowler Modal:
  - Eligible bowlers list (filters out previous-over bowler + capped bowlers)
  - Bowl type [Legal | Throw] (Throw disabled if team cap hit)
  - "Start Over N+1"
                ↓
Innings ends (all out / overs done) → existing innings-break screen
  (target computed) → Opening Pair Modal for innings 2 → loop
```

Standalone Quick Score (no `match_id` query param) stays exactly as it is today — no batter/bowler prompts, no caps, no rotation. The `score.js` file branches at boot on `URLSearchParams.has('match_id')`.

---

## 3. Data model changes

### 3a. New migration: `supabase_team_score_migration.sql`

```sql
-- 1. Opening pair on innings
ALTER TABLE innings
  ADD COLUMN opening_striker_id     uuid NULL REFERENCES players(id) ON DELETE SET NULL,
  ADD COLUMN opening_non_striker_id uuid NULL REFERENCES players(id) ON DELETE SET NULL;

-- 2. Per-over bowler + bowl type
CREATE TABLE innings_overs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  innings_id   uuid NOT NULL REFERENCES innings(id) ON DELETE CASCADE,
  over_number  integer NOT NULL,
  bowler_id    uuid NULL REFERENCES players(id) ON DELETE SET NULL,
  bowl_type    text NOT NULL DEFAULT 'legal'
               CHECK (bowl_type IN ('legal','throw')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (innings_id, over_number)
);
ALTER TABLE innings_overs DISABLE ROW LEVEL SECURITY;

-- 3. Players (default bowl type, used to pre-select in modal)
ALTER TABLE players
  ADD COLUMN bowl_type text NOT NULL DEFAULT 'legal'
             CHECK (bowl_type IN ('legal','throw'));
```

### 3b. `MatchRules` Pydantic schema additions (`app/models.py`)

```python
class MatchRules(BaseModel):
    # ... existing fields ...
    max_overs_per_bowler: int | None = None       # None = no cap
    max_throw_overs_per_team: int | None = None   # None = no cap (or 0 = no throws)
```

`max_overs_per_bowler` and `max_throw_overs_per_team` live inside `match_rules.rules_json` — no separate columns needed (the table already stores arbitrary rules as JSONB).

### 3c. New / extended Pydantic models

| Model | Direction | Fields |
|-------|-----------|--------|
| `PlayerCreate` / `PlayerUpdate` / `PlayerOut` | request/response | + `bowl_type: Literal['legal','throw'] = 'legal'` |
| `InningsCreate` | request | + `opening_striker_id`, `opening_non_striker_id` (both required when match.match_type == 'team') |
| `InningsOut` | response | + `opening_striker_id`, `opening_non_striker_id` |
| `OverAssignmentCreate` | request | `bowler_id`, `bowl_type` |
| `OverAssignmentOut` | response | `over_number, bowler_id, bowl_type` |
| `BatterStats` | response | `player_id, name, runs, balls, fours, sixes, strike_rate, status` (`'batting' \| 'out' \| 'not_out' \| 'yet_to_bat'`), `dismissal: str \| None` |
| `BowlerStats` | response | `player_id, name, overs, balls_legal, runs_conceded, wickets, economy, throw_overs, legal_overs` |
| `InningsScorecard` | response | + `batters: list[BatterStats]`, `bowlers: list[BowlerStats]`, `current_striker_id`, `current_non_striker_id`, `current_bowler_id`, `current_over_number` |

---

## 4. Backend changes

### 4a. New endpoints

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/matches/{id}/innings/{inn_id}/overs` | `OverAssignmentCreate` | Assign bowler + bowl_type to the next over. Validates: not the previous bowler, bowler not capped, throw_type allowed within team cap. Returns `OverAssignmentOut`. |
| `GET`  | `/api/matches/{id}/innings/{inn_id}/overs` | — | List all over assignments for that innings. |
| `GET`  | `/api/matches/{id}/innings/{inn_id}/eligible_bowlers?for_over=N` | — | Returns `{bowlers: [{id, name, overs_bowled, throw_overs_bowled, can_legal, can_throw, reason_blocked}]}`. Drives the over-change modal. |
| `GET`  | `/api/matches/{id}/innings/{inn_id}/eligible_batters` | — | Returns batters who haven't been dismissed and aren't already at the crease. Drives the new-batter modal. |

### 4b. Modified endpoints

- `POST /api/matches/{id}/innings` — when match is team-linked, requires the opening pair IDs in the body; persists them. For quick mode, fields are optional and may be null.
- `POST /api/matches/{id}/innings/{inn_id}/ball` —
  - validates `batter_id` matches the derived current striker
  - validates `bowler_id` matches the current over's assigned bowler
  - (these checks only fire when the match is team-linked; quick mode skips)
- `GET /api/matches/{id}/innings/{inn_id}/scorecard` — additionally computes:
  - current striker / non-striker / bowler IDs (from opening pair + ball event timeline + over assignments)
  - per-batter and per-bowler aggregates
- `POST /api/matches/{id}/innings/{inn_id}/undo` — already deletes the last ball; after the timeline change, the derived current state automatically rolls back. No extra work.

### 4c. Derivation logic (lives in `app/routers/matches.py`)

Pure function `derive_innings_state(innings, ball_events, over_assignments)`:

1. **Start**: striker = `opening_striker_id`, non_striker = `opening_non_striker_id`.
2. For each ball in order:
   - if `event_type` ∈ `('wide','no_ball')` and not paired with byes/runs → no rotation, ball doesn't count toward over.
   - if `event_type == 'wicket'` → striker becomes the new batter on the *next* ball (read from next ball's `batter_id`); if it's the last ball, leave striker null (innings ended).
   - if `runs` is odd → swap striker & non-striker.
   - if this ball completes 6 legal balls in the current over → swap striker & non-striker AND advance current_over_number, set current_bowler_id from `over_assignments[current_over_number]`.
3. Return `(current_striker_id, current_non_striker_id, current_bowler_id, current_over_number)`.

Per-batter aggregate: walk balls, group by `batter_id`.
Per-bowler aggregate: walk balls, group by `bowler_id`, also enrich from `over_assignments` for throw/legal counts.

### 4d. Cap-enforcement helpers

- `bowler_overs_count(innings_id, bowler_id) -> int`: count distinct over_numbers in `innings_overs` for that bowler in that innings.
- `team_throw_overs_count(innings_id) -> int`: count rows in `innings_overs` where `bowl_type='throw'`.
- Validation chain in `POST /overs`:
  1. `for_over` must equal `next expected over number` (overs % 6 == 0 of legal balls).
  2. Previous over's bowler_id ≠ new bowler_id.
  3. `bowler_overs_count + 1 ≤ max_overs_per_bowler` (if cap set).
  4. If `bowl_type='throw'`, `team_throw_overs_count + 1 ≤ max_throw_overs_per_team`.

---

## 5. Frontend changes

### 5a. New route handling in `score.js`

Boot sequence detects mode:

```js
const params = new URLSearchParams(location.search);
const matchId = params.get('match_id');         // already-created match
const sessionId = params.get('session');         // existing param
const isTeamLinked = !!matchId;                  // new flag
```

If `isTeamLinked`:
- Skip the existing Setup view (settings come from the existing match).
- Fetch `/api/matches/{matchId}`, `/api/matches/{matchId}/rules`, players/teams from the session.
- Show **Opening Pair Modal** before the scoring view loads.
- After opening pair submitted, POST innings + opening pair + over-1 assignment, then transition to scoring view.

### 5b. New UI components in `score.html`

1. **Opening Pair Modal** (`#openingPairModal`)
   - Striker `<select>` populated from batting team
   - Non-striker `<select>` (excludes striker via JS)
   - Bowler `<select>` populated from bowling team (only `can_bowl=true`)
   - Bowl type radio: Legal | Throw (Throw disabled if cap will be exceeded)
   - "Start Over 1"

2. **New-Batter Modal** (`#newBatterModal`)
   - Fired after a ball event whose `event_type === 'wicket'`
   - Dropdown built from `GET /eligible_batters`
   - "Continue" stores `pendingBatterId` on frontend state; the next ball POST carries it as `batter_id`

3. **New-Bowler Modal** (`#newBowlerModal`)
   - Fired when ball completes the 6th legal of an over AND match isn't over
   - Dropdown built from `GET /eligible_bowlers?for_over=N+1`
   - Each option shows: name + `Xov` + `🏏 legal` / `🔥 throw N/max`
   - Disabled options: previous bowler, capped bowlers
   - Bowl type radio with disabled-throw indicator
   - "Start Over N+1" → POST `/overs` then resume scoring

4. **Scoring view header changes** (`#viewScoring`)
   - Replace team-strip with: **Batting line** showing striker (with `*`) + non-striker (runs/balls)
   - Add **Bowler line** under it: `Bowler: NAME · ov 2.3 · this over: 1·2·W·`
   - Existing scoreboard/RR/target/freehit stays as-is

5. **Scorecard view** (`#viewScorecard`)
   - Add **Batting table**: Name · R · B · 4s · 6s · SR · Status
   - Add **Bowling table**: Name · O · M · R · W · Econ · (Throw/Legal split)
   - Existing ball-by-ball breakdown stays below

### 5c. Frontend state additions

```js
// Existing matchState gains:
matchState.battingTeamPlayers   // [{id, name, can_bowl, bowl_type}]
matchState.bowlingTeamPlayers
matchState.currentStrikerId
matchState.currentNonStrikerId
matchState.currentBowlerId
matchState.currentOverNumber
matchState.pendingBatterId      // set after wicket modal, consumed on next ball
matchState.openingPair          // set once, used to recompute after undo
```

After each successful `postBall`, the response (`InningsScorecard`) now includes the derived `current_*` IDs — frontend syncs from server, no local recomputation needed (server is the source of truth).

### 5d. Index → Score handoff

In `index.js → goToScore()`, when the user is on the toss step with teams generated, change the URL builder:

```js
// OLD:
window.location.href = '/score?' + params.toString();

// NEW:
// 1. POST /api/matches with session_id, match_type='team', overs (default 6 — can be changed in Setup), rules from defaults
// 2. Redirect to /score?match_id=<new_match.id>
```

The Setup view in `score.html` is still used for team-linked matches — but it pre-fills from the match record and locks team names; the user only adjusts overs/wickets/rules. After Setup submit, the Opening Pair Modal opens.

---

## 6. Implementation order (phased — each phase ships independently)

### Phase 1 — Schema & quiet plumbing (no UI change)
1. Write & apply `supabase_team_score_migration.sql`.
2. Add `bowl_type` to `PlayerCreate/Update/Out` and to Step-1 / Step-2 "Add Player" forms (small chip: 🏏 Legal | 🤾 Throw — defaults Legal).
3. Add `max_overs_per_bowler` and `max_throw_overs_per_team` to `MatchRules` model (optional, default None).
4. Add `opening_striker_id` / `opening_non_striker_id` to `InningsCreate` / `InningsOut` (optional for now).
5. Add `innings_overs` table CRUD plumbing (`POST` / `GET` endpoints), unused by the UI yet.
6. Update `CLAUDE.md` schema and Pydantic tables.

### Phase 2 — Derivation engine
1. Implement `derive_innings_state` + per-batter / per-bowler aggregators in `matches.py`.
2. Extend `GET /scorecard` to include the new fields. Existing quick-score frontend ignores them.
3. Implement eligible-bowlers / eligible-batters endpoints.
4. Add cap validation to `POST /overs`.

### Phase 3 — Team-linked frontend
1. Add the `isTeamLinked` branch in `score.js` boot.
2. Build the Opening Pair Modal + new-batter modal + new-bowler modal.
3. Wire `index.js → goToScore()` to create a match server-side and redirect with `?match_id=`.
4. Update Setup screen in `score.html` to lock team names + show the two new rule inputs (only when team-linked).
5. Add live striker/non-striker/bowler indicators to the scoring header.
6. Update `postBall` calls to send `batter_id` (current striker) and `bowler_id` (current bowler).

### Phase 4 — Scorecard polish
1. Add batter & bowler tables to `#viewScorecard`.
2. Update profile/history page to show batter / bowler stats per innings for team-linked matches.

### Phase 5 — Docs & SW bump
1. Update `CLAUDE.md`: new tables, new endpoints, new model fields, new UI sections.
2. Bump `sw.js` cache to `cricket-v3` (since `score.css` / `score.js` change shape).
3. Update README user-facing notes.

---

## 7. Open decisions to confirm at build start

These are intentionally **deferred** so the plan is not blocked. Lock them in at the start of the build chat.

1. **Throw-overs cap semantics**: is the cap a *subset of* a bowler's overs (e.g. bowler can bowl 3 ov, of which max 1 is throw — bowler-level cap), or *team total throw overs* only (no bowler-level throw cap)? Plan currently assumes **team total only**.
2. **Same bowler consecutive ban** — strict cricket forbids this. Plan enforces it. Want to allow override?
3. **End-of-innings stop conditions** — already handled (all out / overs done / target chased). Should "all out" use `players_per_side − 1` (last man standing) or the explicit `maxWickets` setting? Plan uses `maxWickets` from Setup, same as today.
4. **Player `bowl_type` default in Add Player UI**: pill (`Legal` / `Throw`) appears only if `can_bowl=true`. Confirm UX.
5. **Edit-on-the-fly**: should the scorer be able to *change* the current bowler mid-over (e.g. injury)? Plan says **no** — bowler is locked once an over starts. Override via Undo all balls of the over instead.
6. **Index `goToScore()` — overs default**: when creating the match server-side, what default `overs` value? Plan suggests 6 (same as today's query-param). User can change in Setup.
7. **Migration order in `CLAUDE.md`**: this is migration #7. Confirm naming `supabase_team_score_migration.sql`.

---

## 8. Files that will change

```
NEW   app/supabase_team_score_migration.sql
EDIT  app/models.py
EDIT  app/routers/players.py        (bowl_type field on Add/Update)
EDIT  app/routers/matches.py        (new endpoints, derivation engine, validators)
EDIT  app/templates/index.html      (Add Player bowl-type pill, late-add bowl-type pill)
EDIT  app/static/css/index.css      (new pill styles)
EDIT  app/static/js/index.js        (bowl_type state, goToScore creates match)
EDIT  app/templates/score.html      (3 new modals, new header, scorecard tables, 2 new rule inputs)
EDIT  app/static/css/score.css      (modal & header styles)
EDIT  app/static/js/score.js        (isTeamLinked branch, derivation sync, modals, rotation)
EDIT  app/templates/profile.html    (batter/bowler stats in history)
EDIT  app/static/css/profile.css
EDIT  app/static/js/profile.js
EDIT  app/static/sw.js              (bump cache to cricket-v3)
EDIT  CLAUDE.md                     (schema, endpoints, models, frontend sections, common issues)
```

---

This plan is fully self-contained — paste it into the build chat and reference it as "Team-Linked Scorekeeping Plan v1". When you trigger the build, start with **Phase 1** and answer the seven Open Decisions in §7 up-front so the build doesn't pause mid-phase.
