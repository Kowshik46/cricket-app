# Cricket Team Maker — Claude Code Guide

> **Self-maintenance rule:** Whenever a core component changes, update this file in the same
> commit/edit. Core components are: routers, models, database schema, environment variables,
> frontend SPA structure, auth flow, and dependency versions. If you add a table, add it to
> [Database Schema](#database-schema). If you add an endpoint, add it to [API Reference](#api-reference).
> If you add an env var, add it to [Environment Variables](#environment-variables). No exceptions.

---

## Project Overview

A **FastAPI + Supabase PWA** that fairly splits cricket players into two skill-balanced and
bowling-balanced teams, and now includes a full **ball-by-ball scorekeeping** system. Originally a single-file HTML tool, now a full-stack web app with:

- Persistent match sessions with cross-device sync (optional auth)
- Skill-level + bowling-ability balanced team generation
- Inline player editing (name, skill, can_bowl, bowl_type) after addition
- Match session renaming
- Late-player addition directly from the Teams view
- Teams preserved across navigation — no accidental regeneration
- Coin toss with history and decision recording (winner team + bat/field election saved to DB)
  - 3D coin has H (heads) and T (tails) faces; animation ends on the correct face matching the API result
  - **Quick Toss** button in Step 1 jumps straight to the toss — auto-creates a session silently if none exists
- **Ball-by-ball scorekeeping** — two modes, same UI:
  - **Quick Match** (no player tracking): standalone `/score` with no `match_id` param
  - **Team-linked Match**: `/score?match_id=<id>&session=<sid>` — full player attribution
    - Opening Pair modal (striker, non-striker, opening bowler + bowl type)
    - Per-ball batter/bowler attribution; automatic striker rotation derived server-side
    - New-Batter modal after wicket (eligible batters from server; dismissed batters excluded)
    - New-Bowler modal auto-triggers after each over completes — fires even when over ends on wicket
    - Run-out dismissal prompts who was run out (Striker / Non-striker) and who is entering; non-striker run-out handled via `metadata.new_non_striker_id` piggybacked on next ball
    - Live striker/non-striker/bowler strip below scoreboard
    - Bowling caps: max overs per bowler, max throw overs per team (configurable in Setup)
    - All bowling-team players eligible to bowl regardless of `can_bowl` flag (`can_bowl` is for team balancing only, not field enforcement)
    - Classic scorecard view: batting table (R/B/4s/6s/SR + dismissal), bowling table (O/R/W/Econ + throw-over tag)
    - Entry from Toss step via "🏏 Score →" → `goToTeamScore()` creates match + redirects
  - Always two innings; innings break screen shows target
  - Configurable: overs, players/side, max wickets
  - Rule toggles: Wide +1 extra, No Ball +1 extra, No Ball → Free Hit
  - Free Hit 🔥 banner + gold ring marker; only Run Out on free hit
  - Undo last ball (recomputes state from timeline)
  - Win detection mid-innings when chasing team passes target
  - Mobile-first one-handed scoring UI at `/score`
- **Live spectator mode** — sharable watch code + QR code so anyone can follow the score in real time
  - Every match gets a unique 6-char alphanumeric `watch_code` (e.g. `X7K3M2`) stored in the DB
  - "📤 Share" button in the score page header opens a modal with the code, a copyable link, and a QR code
  - "👁 Follow a Live Match" button on the home page → enter code → `/watch?code=XXXXXX`
  - `/watch` page (`watch.html`) polls `GET /api/watch/{code}` every 5s while live; stops on completion
  - Spectator view: live score, current over balls, player-at-crease strip, batting/bowling scorecard tabs
  - QR code generated client-side via `qrcode.js` (cdnjs CDN); no extra backend dependency
- Profile page — display name, email/password management, match history, player stats
- Forgot password flow via Supabase email reset
- Offline-capable PWA (installable on mobile)

---

## Deployment

- **Production URL:** https://cricket.kowshik.co.in
- **Render service URL:** https://cricket-app-rl4s.onrender.com
- **GitHub repo:** https://github.com/Kowshik46/cricket-app
- **Platform:** Render (free tier) — app may have ~30s cold start after inactivity
- **Deploy trigger:** any push to `main` branch auto-deploys via Render's GitHub integration

### Files
| File | Purpose |
|------|---------|
| `Dockerfile` | Builds the image; `WORKDIR /project`, copies `app/`, runs uvicorn |
| `render.yaml` | Render service config — runtime, health check path, env var declarations |

### Environment variables (set in Render dashboard, never committed)
Same three vars as local `.env` — `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_ANON_KEY`.

### DNS
`cricket.kowshik.co.in` is a CNAME record pointing to the Render-provided domain.
Managed at the domain registrar (not Cloudflare). SSL cert provisioned by Render via Let's Encrypt.

### Redeploy manually
Push any commit to `main`, or go to Render dashboard → **Manual Deploy → Deploy latest commit**.

---

## Architecture

```
Cricket team genrator/              ← project root — ALWAYS run uvicorn from here
├── CLAUDE.md                       ← this file (keep in sync with code)
├── README.md                       ← user-facing docs
├── Dockerfile                      ← production image (used by Render)
├── render.yaml                     ← Render service config
├── .env                            ← local secrets (gitignored, never commit)
├── app/
│   ├── main.py                     ← FastAPI app, router registration, template context
│   ├── database.py                 ← Supabase client (service_role key, bypasses RLS)
│   ├── models.py                   ← ALL Pydantic schemas live here
│   ├── routers/
│   │   ├── sessions.py             ← CRUD: match sessions (incl. rename)
│   │   ├── players.py              ← CRUD: players per session (incl. can_bowl, edit)
│   │   ├── teams.py                ← team generation, team persistence, add-to-team
│   │   ├── toss.py                 ← coin toss, history, winner + election recording (PATCH)
│   │   ├── auth.py                 ← JWT verify, /me, /claim
│   │   ├── profile.py              ← history, stats, display name, delete account
│   │   ├── matches.py              ← scorekeeping: matches, innings, ball events, undo, scorecard
│   │   └── watch.py                ← public read-only spectator API (no auth required)
│   ├── templates/
│   │   ├── index.html              ← main SPA structure (HTML only — styles & JS in /static)
│   │   ├── profile.html            ← profile page structure (HTML only — styles & JS in /static)
│   │   ├── score.html              ← ball-by-ball scoring UI structure (HTML only — styles & JS in /static)
│   │   └── watch.html              ← live spectator view (polls /api/watch/{code} every 5s)
│   ├── static/
│   │   ├── manifest.json           ← PWA manifest
│   │   ├── sw.js                   ← service worker (cache version `cricket-v2`)
│   │   ├── css/                    ← extracted page styles (one file per template)
│   │   │   ├── index.css
│   │   │   ├── profile.css
│   │   │   ├── score.css
│   │   │   └── watch.css
│   │   ├── js/                     ← extracted page scripts (one file per template, no build step)
│   │   │   ├── index.js            ← reads window.SUPA_URL/window.SUPA_ANON injected by index.html
│   │   │   ├── profile.js          ← reads window.SUPA_URL/window.SUPA_ANON injected by profile.html
│   │   │   ├── score.js
│   │   │   └── watch.js            ← no Jinja/Supabase injection needed (public page)
│   │   └── icons/                  ← icon-192.png, icon-512.png (add manually)
│   ├── supabase_schema.sql         ← initial table creation (run first)
│   ├── supabase_auth_migration.sql ← adds owner_id + RLS policies (run second)
│   ├── supabase_features_migration.sql ← adds can_bowl, team name columns (run third)
│   ├── supabase_profile_migration.sql  ← creates user_profiles table (run fourth)
│   ├── supabase_scoring_migration.sql  ← scorekeeping tables (run fifth)
│   ├── supabase_toss_decision_migration.sql ← winner_team + elected_to columns (run sixth)
│   ├── cricket-teams.html          ← legacy standalone HTML tool (not served by FastAPI)
│   ├── requirements.txt
│   ├── .gitignore
│   └── .env.example
└── app/cricket/                    ← Python venv (activate before running)
```

---

## Tech Stack

| Layer      | Technology                   | Notes |
|------------|------------------------------|-------|
| Backend    | FastAPI 0.111 + Uvicorn 0.29 | Async, Jinja2 templates, StaticFiles |
| Database   | Supabase (Postgres)          | `supabase-py 2.4.6` — requires legacy JWT keys |
| Auth       | Supabase Auth                | Optional; browser-side JS SDK + backend JWT verify |
| Frontend   | Vanilla JS SPA               | Single `index.html`, no build step, no framework |
| PWA        | Web App Manifest + SW        | Installable, offline shell, network-first for `/api/` |
| Python env | venv at `app/cricket/`       | Activate before running server |

---

## Environment Variables

> **Rule:** Any new env var must be added here AND to `app/.env.example`.

| Variable | Required | Where used | Description |
|----------|----------|------------|-------------|
| `SUPABASE_URL` | Yes | `database.py`, `main.py`, `profile.py` | Project URL (`https://<id>.supabase.co`) |
| `SUPABASE_SECRET_KEY` | Yes | `database.py`, `profile.py` | Legacy service_role JWT (`eyJ...`) — server only, bypasses RLS |
| `SUPABASE_ANON_KEY` | Auth only | `main.py` → template | Anon/publishable key — injected into HTML for browser Supabase JS SDK |

> **CRITICAL — key format:** `supabase-py 2.4.6` only accepts JWT-format keys (`eyJ...`).
> New `sb_secret_...` / `sb_publishable_...` format is **not supported**.
> Get legacy keys: Supabase Dashboard → Project Settings → API Keys → **"Legacy"** tab.

---

## Database Schema

> **Rule:** Any schema change needs a new migration `.sql` file in `app/` AND an update to
> this section. Never modify the initial `supabase_schema.sql` after it has been run in prod.

### Migration order

1. `supabase_schema.sql` — base tables
2. `supabase_auth_migration.sql` — auth: `owner_id` column + RLS policies
3. `supabase_features_migration.sql` — features: `can_bowl`, `team_a_name`, `team_b_name`
4. `supabase_profile_migration.sql` — profile: `user_profiles` table
5. `supabase_scoring_migration.sql` — scorekeeping: `matches`, `match_rules`, `innings`, `ball_events`, `player_match_stats`
6. `supabase_toss_decision_migration.sql` — adds `winner_team` + `elected_to` columns to `toss_history`
7. `supabase_team_score_migration.sql` — adds `bowl_type` to `players`, opening pair columns to `innings`, creates `innings_overs` table
8. `supabase_watch_migration.sql` — adds `watch_code` unique column to `matches`

### Tables

#### `sessions`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `name` | `text` | max 60 chars, renameable via PATCH |
| `owner_id` | `uuid` nullable | FK → `auth.users(id)` — null = anonymous |
| `created_at` | `timestamptz` | server default |

#### `players`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `session_id` | `uuid` FK | → `sessions(id)` ON DELETE CASCADE |
| `name` | `text` | max 30 chars, editable via PATCH |
| `skill` | `text` | CHECK in `('beginner','intermediate','expert')`, editable via PATCH |
| `can_bowl` | `boolean` | default `false` — used in bowling-balanced split, editable via PATCH |
| `bowl_type` | `text` | CHECK in `('legal','throw')`, default `'legal'` — editable via PATCH |
| `created_at` | `timestamptz` | |

#### `team_assignments`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `session_id` | `uuid` FK | → `sessions(id)` ON DELETE CASCADE |
| `player_id` | `uuid` FK | → `players(id)` ON DELETE CASCADE |
| `team_name` | `text` | which team this player is on |
| `team_a_name` | `text` | stored for reconstruction without re-query |
| `team_b_name` | `text` | stored for reconstruction without re-query |
| `is_captain` | `boolean` | |
| `created_at` | `timestamptz` | |

#### `toss_history`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `session_id` | `uuid` FK | → `sessions(id)` ON DELETE CASCADE |
| `result` | `text` | CHECK in `('heads','tails')` |
| `winner_team` | `text` nullable | Team name that won the toss — set via PATCH after user picks |
| `elected_to` | `text` nullable | CHECK in `('bat','field')` — what the winner chose |
| `tossed_at` | `timestamptz` | |

#### `user_profiles`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | matches `auth.users.id` — no FK (avoids view conflict) |
| `display_name` | `text` | max 40 chars, default `''` |
| `updated_at` | `timestamptz` | default `now()` |

> **IMPORTANT:** RLS must be **disabled** on `user_profiles` (or a permissive policy added).
> The backend uses the service_role key which bypasses RLS, but Supabase still enforces it
> for regular tables unless explicitly disabled. Run:
> ```sql
> alter table user_profiles disable row level security;
> ```

#### `matches`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `session_id` | `uuid` nullable FK | → `sessions(id)` ON DELETE SET NULL |
| `match_type` | `text` | `'quick'` or `'team'` |
| `status` | `text` | `'setup'`, `'live'`, `'innings_break'`, `'completed'` |
| `overs` | `integer` | total overs per innings |
| `players_per_side` | `integer` | |
| `rules_preset` | `text` | `'standard'`, `'box'`, `'gully'`, `'custom'` |
| `watch_code` | `text` nullable UNIQUE | 6-char alphanumeric; generated on `POST /api/matches`; used by `/api/watch/{code}` |
| `created_at` | `timestamptz` | |

#### `match_rules`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `match_id` | `uuid` FK | → `matches(id)` ON DELETE CASCADE, unique |
| `rules_json` | `jsonb` | full `MatchRules` dict |
| `updated_at` | `timestamptz` | |

#### `innings`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `match_id` | `uuid` FK | → `matches(id)` ON DELETE CASCADE |
| `innings_number` | `integer` | 1 or 2 |
| `batting_team` | `text` | |
| `bowling_team` | `text` | |
| `target` | `integer` nullable | set after innings 1 completes |
| `status` | `text` | `'live'` or `'completed'` |
| `opening_striker_id` | `uuid` nullable FK | → `players(id)` ON DELETE SET NULL |
| `opening_non_striker_id` | `uuid` nullable FK | → `players(id)` ON DELETE SET NULL |
| `created_at` | `timestamptz` | |

#### `innings_overs`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `innings_id` | `uuid` FK | → `innings(id)` ON DELETE CASCADE |
| `over_number` | `integer` | 0-indexed |
| `bowler_id` | `uuid` nullable FK | → `players(id)` ON DELETE SET NULL |
| `bowl_type` | `text` | CHECK in `('legal','throw')`, default `'legal'` |
| `created_at` | `timestamptz` | |
| — | UNIQUE | `(innings_id, over_number)` |

#### `ball_events`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `innings_id` | `uuid` FK | → `innings(id)` ON DELETE CASCADE |
| `over_number` | `integer` | 0-indexed |
| `ball_number` | `integer` | 0-indexed within over (legal balls) |
| `event_type` | `text` | dot/runs/wide/no_ball/bye/leg_bye/wicket/dead_ball/penalty |
| `runs` | `integer` | runs scored off bat (not extras) |
| `extras` | `integer` | extras awarded (wide/no_ball penalty + bye/leg_bye runs) |
| `extra_type` | `text` nullable | wide/no_ball/bye/leg_bye |
| `is_legal_ball` | `boolean` | false for wide/no_ball (doesn't consume over slot) |
| `is_boundary` | `boolean` | |
| `boundary_type` | `text` nullable | four/six |
| `wicket_type` | `text` nullable | bowled/caught/run_out/lbw/stumped/hit_wicket |
| `batter_id` | `uuid` nullable FK | → `players(id)` ON DELETE SET NULL |
| `bowler_id` | `uuid` nullable FK | → `players(id)` ON DELETE SET NULL |
| `metadata` | `jsonb` | Known keys: `run_out_end` (`'striker'`\|`'non_striker'`) — which end dismissed; `new_non_striker_id` (uuid) — replacement non-striker after non-striker run-out; `free_hit` (bool) — marks delivery as free hit |
| `created_at` | `timestamptz` | |

#### `player_match_stats`
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | |
| `match_id` | `uuid` FK | → `matches(id)` ON DELETE CASCADE |
| `player_id` | `uuid` nullable FK | → `players(id)` ON DELETE SET NULL |
| `player_name` | `text` | denormalized for stats display |
| `batting_stats` | `jsonb` | runs/balls/fours/sixes/strike_rate/status/dismissal |
| `bowling_stats` | `jsonb` | overs/maidens/runs/wickets/economy |

> **RLS on scorekeeping tables:** All five new tables have RLS **disabled**. The backend
> uses the `service_role` key which bypasses RLS anyway.

### Row Level Security

RLS is **enabled on all tables except `user_profiles`**. Policy matrix:

| Role | sessions | players / team_assignments / toss_history |
|------|----------|------------------------------------------|
| Anonymous | Read/insert/delete where `owner_id IS NULL` | Gated on parent session ownership |
| Authenticated | Full access where `owner_id = auth.uid()` | Gated on parent session ownership |
| `service_role` (backend) | Bypasses RLS entirely | Bypasses RLS entirely |

Direct browser access to Supabase is blocked by default (no open anon policies).

---

## API Reference

> **Rule:** Any new or changed endpoint must be added/updated here.

Base path for all session-scoped endpoints: `/api/sessions/{session_id}`

### Sessions — `/api/sessions`
| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/sessions` | `{name}` | Create session; reads `Authorization` header and stamps `owner_id` if user is authenticated |
| `GET` | `/api/sessions` | — | List sessions — auth: filter by `owner_id`; guest: filter by `?ids=` (comma-sep UUIDs stored in `localStorage`) |
| `GET` | `/api/sessions/{id}` | — | Get single session |
| `PATCH` | `/api/sessions/{id}` | `{name}` | Rename session |
| `DELETE` | `/api/sessions/{id}` | — | Delete + cascade all children |

### Players — `/api/sessions/{id}/players`
| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `…/players` | `{name, skill, can_bowl}` | Add player; rejects duplicate names (case-insensitive) |
| `GET` | `…/players` | — | List players ordered by `created_at` |
| `PATCH` | `…/players/{player_id}` | `{name?, skill?, can_bowl?, bowl_type?}` | Update player fields; rejects duplicate name (excludes self) |
| `DELETE` | `…/players/{player_id}` | — | Remove player |

### Teams — `/api/sessions/{id}/teams`
| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `…/teams/generate` | `{team_a_name, team_b_name}` | Generate balanced teams (clears previous) |
| `GET` | `…/teams` | — | Fetch last generated teams (persisted in DB) |
| `POST` | `…/teams/add_player` | `{name, skill, can_bowl, team_name}` | Add a late player to a specific team without reshuffle |

### Toss — `/api/sessions/{id}/toss`
| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `…/toss` | — | Flip coin, store result, return toss id + number |
| `PATCH` | `…/toss/{toss_id}` | `{winner_team, elected_to}` | Record which team won and whether they bat/field |
| `GET` | `…/toss/history` | — | Last 20 tosses for session |

### Auth — `/api/auth`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/auth/me` | Bearer JWT | Returns `{id, email}` |
| `POST` | `/api/auth/claim` | Bearer JWT | Assigns anonymous session UUIDs to the logged-in user |

### Profile — `/api/profile`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/profile/history` | Bearer JWT | All sessions with players, team assignments, toss history |
| `GET` | `/api/profile/stats` | Bearer JWT | Per-player cross-session stats (games, captain count, bowl count) |
| `GET` | `/api/profile/display_name` | Bearer JWT | Get display name from `user_profiles` |
| `PATCH` | `/api/profile/display_name` | Bearer JWT | Set display name in `user_profiles` table |
| `DELETE` | `/api/profile` | Bearer JWT | Delete all owned sessions + Supabase auth account via admin REST API |

> **Email and password changes** are handled entirely browser-side via `supaAuth.auth.updateUser()` — no backend endpoint. Password change re-authenticates with the current password first via `supaAuth.auth.signInWithPassword()` before calling `updateUser`.

### Matches (Scorekeeping) — `/api/matches`
| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/matches` | `MatchCreate` | Create a new match with rules |
| `GET` | `/api/matches` | `?session_id=` | List matches (latest 50, optional filter by session) |
| `GET` | `/api/matches/{id}` | — | Get match |
| `DELETE` | `/api/matches/{id}` | — | Delete match + all innings/balls |
| `GET` | `/api/matches/{id}/rules` | — | Get current rules JSON |
| `PATCH` | `/api/matches/{id}/rules` | `UpdateMatchRulesRequest` | Update rules |
| `POST` | `/api/matches/{id}/innings` | `InningsCreate` | Create innings 1 or 2 |
| `GET` | `/api/matches/{id}/innings` | — | List all innings for match |
| `POST` | `/api/matches/{id}/innings/{inn_id}/complete` | — | Mark innings complete; sets target for 2nd innings |
| `POST` | `/api/matches/{id}/innings/{inn_id}/ball` | `BallEventCreate` | Record a delivery; returns updated `InningsScorecard` |
| `POST` | `/api/matches/{id}/innings/{inn_id}/undo` | — | Delete last ball; returns updated `InningsScorecard` |
| `GET` | `/api/matches/{id}/innings/{inn_id}/scorecard` | — | Live scorecard for one innings |
| `GET` | `/api/matches/{id}/innings/{inn_id}/timeline` | — | All ball events for one innings |
| `GET` | `/api/matches/{id}/scorecard` | — | Full match scorecard (all innings) |
| `POST` | `/api/matches/{id}/innings/{inn_id}/overs` | `OverAssignmentCreate` | Assign bowler + bowl_type to next over; validates consecutive ban and caps |
| `GET` | `/api/matches/{id}/innings/{inn_id}/overs` | — | List all over assignments for innings |
| `GET` | `/api/matches/{id}/innings/{inn_id}/eligible_bowlers` | — | Returns **all** bowling-team players eligible for next over with cap/block flags — `can_bowl` is NOT a filter here |
| `GET` | `/api/matches/{id}/innings/{inn_id}/eligible_batters` | — | Returns batting-team players not yet dismissed and not currently at the crease; handles both striker and non-striker vacancy after run-outs |

> **Score page** — `/score` (GET) renders `score.html`. Accepts query params `session`, `name`, `teamA`, `teamB`, `overs` to pre-populate setup form.

### Watch (Spectator) — `/api/watch`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/watch/{code}` | None | Public — returns `{ watch_code, match_name, scorecard: MatchScorecard }` for the given 6-char code |

> **Watch page** — `/watch` (GET) renders `watch.html`. Accepts `?code=XXXXXX` query param; shows entry form if omitted. Polls `GET /api/watch/{code}` every 5s while live, stops when `status === 'completed'`. No auth or Supabase keys injected (fully public).

> **Forgot password** is handled browser-side via `supaAuth.auth.resetPasswordForEmail()` with `redirectTo: window.location.origin + '/'`. The `PASSWORD_RECOVERY` event in `onAuthStateChange` opens the set-new-password modal.

---

## Pydantic Models (`app/models.py`)

> **Rule:** Any new model or field change must be reflected here.

| Model | Direction | Fields |
|-------|-----------|--------|
| `SessionCreate` | request | `name` |
| `SessionRename` | request | `name` (required, min 1) |
| `SessionOut` | response | `id, name, created_at` |
| `PlayerCreate` | request | `name, skill, can_bowl=False, bowl_type='legal'` |
| `PlayerUpdate` | request | `name?, skill?, can_bowl?, bowl_type?` (all optional, at least one required) |
| `PlayerOut` | response | `id, session_id, name, skill, can_bowl, bowl_type, created_at` |
| `TeamGenerateRequest` | request | `team_a_name="Team A", team_b_name="Team B"` |
| `TeamAssignmentOut` | response | `player_id, player_name, skill, can_bowl, bowl_type, team_name, is_captain` |
| `TeamsOut` | response | `team_a_name, team_b_name, assignments[]` |
| `AddToTeamRequest` | request | `name, skill, can_bowl=False, bowl_type='legal', team_name` |
| `TossResult` | response | `id, result, toss_number, session_id, winner_team?, elected_to?` |
| `TossDecisionUpdate` | request | `winner_team, elected_to` |
| `TossHistoryItem` | response | `id, result, tossed_at, winner_team?, elected_to?` |
| `UserOut` | response | `id, email` |
| `ClaimRequest` | request | `session_ids[]` |
| `TossHistorySummary` | response | `result, tossed_at, winner_team?, elected_to?` |
| `MatchPlayerItem` | response | `name, skill, can_bowl, team_name, is_captain` |
| `MatchHistoryItem` | response | `id, name, created_at, team_a_name, team_b_name, players[], toss_history[]` |
| `PlayerStatsItem` | response | `name, games, as_captain, as_bowler` |
| `UpdateDisplayNameRequest` | request | `display_name` (min 1, max 40) |
| `UpdateEmailRequest` | request (unused — email change is browser-side) | `email` (min 3, max 120) |
| `UpdatePasswordRequest` | request (unused — password change is browser-side) | `password` (min 6) |
| `MatchRules` | config | `wide_runs, wide_counts_as_ball, wide_reball, no_ball_runs, no_ball_counts_as_ball, no_ball_reball, free_hit_enabled, free_hit_dismissals, wicket_types[], last_man_standing, retirement_runs, boundary_four, boundary_six, max_overs_per_bowler?, max_throw_overs_per_team?` |
| `MatchCreate` | request | `session_id?, match_type, overs, players_per_side, rules_preset, rules?` |
| `MatchOut` | response | `id, session_id, match_type, status, overs, players_per_side, rules_preset, watch_code?, created_at` |
| `InningsCreate` | request | `batting_team, bowling_team, opening_striker_id?, opening_non_striker_id?` |
| `InningsOut` | response | `id, match_id, innings_number, batting_team, bowling_team, target, status, created_at, opening_striker_id?, opening_non_striker_id?` |
| `OverAssignmentCreate` | request | `bowler_id, bowl_type='legal'` |
| `OverAssignmentOut` | response | `id, innings_id, over_number, bowler_id?, bowl_type, created_at` |
| `BallEventCreate` | request | `event_type, runs, extra_type?, is_boundary, boundary_type?, wicket_type?, batter_id?, bowler_id?, metadata` |
| `BallEventOut` | response | `id, innings_id, over_number, ball_number, event_type, runs, extras, extra_type, is_legal_ball, is_boundary, boundary_type, wicket_type, batter_id, bowler_id, metadata, created_at` |
| `InningsScorecard` | response | `innings, total_runs, total_wickets, total_overs, run_rate, target, required_run_rate, balls[]` |
| `BatterStats` | response | `player_id, name, runs, balls, fours, sixes, strike_rate, status, dismissal?` |
| `BowlerStats` | response | `player_id, name, overs, balls_legal, runs_conceded, wickets, economy, bowl_type, legal_overs, throw_overs` |
| `InningsScorecard` | response (extended) | + `current_striker_id?, current_non_striker_id?, current_bowler_id?, current_over_number, batters[], bowlers[]` |
| `MatchScorecard` | response | `match, rules, innings_list[]` |
| `UpdateMatchRulesRequest` | request | `rules: MatchRules` |

---

## Team Generation Algorithm

Located in `app/routers/teams.py → _split_balanced()`.

1. Separate players into **bowlers** (`can_bowl=True`) and **non-bowlers**
2. Sort each group by skill weight descending (`expert=3, intermediate=2, beginner=1`)
3. Snake-draft bowlers into Team A / Team B using pattern A, B, B, A, A, B, B, A… — ensures even bowling split
4. Snake-draft non-bowlers **continuing the same pick index** (`idx`) from where the bowler draft ended — prevents the best non-bowler always landing on the same team as the best bowler
5. Within each team, shuffle players within the same skill tier (`_tier_shuffle`)
6. Pick one random captain per team
7. Store `team_a_name` and `team_b_name` on every assignment row (for DB reconstruction)
8. Delete all previous assignments for the session, insert new batch

> **Previous bug:** two separate `enumerate()` loops both reset `i=0`, so the best non-bowler always went to Team A. Fixed by using a single shared `idx` across both loops.

**Adding a late player** (`/teams/add_player`): creates the player in `players`, inserts one
`team_assignments` row with `is_captain=False`, returns the full updated teams via `get_teams`.
No reshuffling occurs.

---

## Frontend SPA (`app/templates/index.html`)

HTML + CSS + JS — **no build step, no framework**. As of the static-asset refactor, styles and
scripts now live in dedicated files under `app/static/`:

- `app/templates/index.html` — markup only; links `<link rel="stylesheet" href="/static/css/index.css">` and `<script src="/static/js/index.js" defer>`.
- `app/static/css/index.css` — all styles for the SPA.
- `app/static/js/index.js` — all logic for the SPA.

The same split applies to `profile.html` ↔ `profile.css`/`profile.js` and `score.html` ↔ `score.css`/`score.js`.

**Jinja2 → JS handoff:** `index.html` and `profile.html` still need the server-rendered Supabase
keys. Each template assigns them to globals in a tiny inline `<script>` block (`window.SUPA_URL` /
`window.SUPA_ANON`) **before** loading the external JS. The external JS reads those globals at
boot — do not move the Jinja vars into the static `.js` files (Jinja isn't applied to static assets).

To add a feature: edit the matching `.html` + `.css` + `.js` files. The PWA service worker
(`app/static/sw.js`) pre-caches all six static files at install — bump `CACHE` (currently
`cricket-v2`) whenever you add a new top-level static asset.

### UI Structure
| Section | ID | Description |
|---------|----|-------------|
| Header | `header` | App title, animated bat, auth chip (top-right) |
| Session bar | `.session-bar` | Dropdown select, new (+) button, rename (✎) button, delete (🗑) button |
| Stepper | `.steps` | Steps 1→2→3 with done/active/pending states |
| Step 1 | `#sec1` | Add players: name input, skill pills, can_bowl toggle, player list with inline edit; **🏏 Quick Score** and **🪙 Quick Toss** gold shortcut buttons below Generate |
| Step 2 | `#sec2` | Team cards, action row, collapsible late-player add panel |
| Step 3 | `#sec3` | Coin toss with animation, history, decision panel (winner + bat/field); **🏏 Score →** button calls `goToTeamScore()` |

### Key State Variables
| Variable | Type | Description |
|----------|------|-------------|
| `currentSessionId` | string\|null | Active session UUID |
| `players` | array | Cached player list for active session |
| `teamsData` | object\|null | Last-loaded `TeamsOut` — persisted across navigation |
| `currentUser` | object\|null | Supabase Auth user (null = guest) |
| `currentDisplayName` | string | Display name fetched from backend; shown in auth chip |
| `canBowl` | boolean | State of the can_bowl toggle on step 1 |
| `lateCanBowl` | boolean | State of the can_bowl toggle on step 2 add-panel |
| `lateTeamPick` | `'a'`\|`'b'` | Which team the late player will join |
| `_editingPlayerId` | string\|null | ID of the player row currently open for inline editing |
| `_loadingSessionsLock` | boolean | Mutex preventing concurrent `loadSessions()` calls |
| `lastTossId` | string\|null | UUID of the most recent toss — used by the decision panel to PATCH the result |
| `tossWinner` | `'a'`\|`'b'`\|null | Which side the user selected as the toss winner; cleared on each new toss |
| `bowlType` | `'legal'`\|`'throw'` | Bowl type for the player being added in step 1 |
| `lateBowlType` | `'legal'`\|`'throw'` | Bowl type for the late-player add panel in step 2 |

**score.js `cfg` additions (scoring page):**

| Field | Type | Description |
|-------|------|-------------|
| `cfg.playersPerSide` | integer | Set in `startMatch()` / `loadTeamLinkedSetup()`; used by "Play Again" to recreate the match |
| `cfg.matchNum` | integer | Tracks match series number (starts at 1, increments on each "Play Again", reset on "New Match") |

**score.js specific (team-linked mode — set inside `matchState`):**

| Field | Type | Description |
|-------|------|-------------|
| `matchState.battingTeamPlayers` | array | `[{id, name, can_bowl, bowl_type}]` for the current batting team |
| `matchState.bowlingTeamPlayers` | array | Bowling team players |
| `matchState.currentStrikerId` | string\|null | UUID of striker; synced from server after each ball |
| `matchState.currentNonStrikerId` | string\|null | UUID of non-striker |
| `matchState.currentBowlerId` | string\|null | UUID of current bowler |
| `matchState.currentOverNumber` | integer | 0-indexed current over |
| `matchState.pendingBatterId` | string\|null | Set after striker wicket modal; sent as `batter_id` on next ball |
| `isTeamLinked` | boolean | `!!URLSearchParams.get('match_id')` — drives all team-linked branches |
| `_runOutTarget` | `'striker'`\|`'non_striker'` | Which end was dismissed in a run-out; drives `submitWicket()` logic |
| `_newBatterPosition` | `'striker'`\|`'non_striker'` | Which crease position the incoming batter fills after a wicket |
| `_pendingNonStrikerId` | string\|null | Replacement non-striker UUID after a non-striker run-out; piggybacked as `metadata.new_non_striker_id` on the very next ball |
| `_openingPairSubmitting` | boolean | Guard flag preventing double-tap from submitting the Opening Pair modal twice (creates duplicate innings) |
| `matchState._batTeamName` | string\|null | Name of team currently mapped to `battingTeamPlayers`; used by "Play Again" to decide whether to swap player arrays when changing which team bats first |

### Key localStorage
| Key | Value |
|-----|-------|
| `cricket_last_session` | UUID of the last active session (restored on load) |
| `cricket_sessions` | JSON array of all session UUIDs this browser has created — used to filter guest `GET /api/sessions` requests |

### Navigation rules
- `goTo(n)` switches between steps 1/2/3 — **does not reload data**
- `teamsData` is loaded from the DB on `selectSession()` — teams survive back-navigation
- "Generate Teams" button is only shown when `teamsData` is null OR as a reset action
- "View Teams →" button appears next to Generate once teams exist

### Player inline editing
- Each player row shows ✎ (edit) and ✕ (delete) buttons
- Clicking ✎ expands the row into edit mode: name input, skill pill buttons, bowl toggle
- Enter saves, Escape cancels; only changed fields are sent to the API
- Role badge shows **"Bat & Bowl"** when `can_bowl=true`, **"Bat"** otherwise

### Auth flow (frontend)
1. Page load → `initAuth()` → `getSession()` checks existing Supabase session
2. If session exists: `fetchDisplayName()` called immediately to populate auth chip
3. `onAuthStateChange` fires on fresh sign-in (`SIGNED_IN` when `initSession` was null) → `fetchDisplayName()` → `claimAnonymousSessions()` → `loadSessions()`
4. `onAuthStateChange` fires `PASSWORD_RECOVERY` when user clicks a reset link → opens set-new-password modal
5. `_loadingSessionsLock` mutex prevents concurrent `loadSessions()` calls (Supabase fires `SIGNED_IN` on token refresh)
6. Every `api()` call attaches `Authorization: Bearer <token>` if a session exists
7. Auth chip: shows display name (or email prefix as fallback); click → user dropdown (signed-in) or auth modal (guest)
8. Sign-up form includes optional display name field; saved immediately if Supabase auto-confirms the account
9. Duplicate email on sign-up detected via empty `identities` array in sign-up response

### Forgot password flow
1. "Forgot password?" link in sign-in tab → opens forgot-password modal
2. `supaAuth.auth.resetPasswordForEmail(email, { redirectTo: origin + '/' })` → Supabase emails reset link
3. User clicks link → lands on `/` with recovery token → Supabase JS fires `PASSWORD_RECOVERY`
4. Handler opens set-new-password modal (new + confirm fields)
5. `supaAuth.auth.updateUser({ password })` sets the new password; user is signed in automatically

### Service Worker
- Cache name: `cricket-v2`
- Shell cached on install: `/`, Google Fonts URL
- Strategy: cache-first for shell/static, **network-first for `/api/`**

---

## Profile Page (`app/templates/profile.html`)

Separate route at `/profile`. Three tabs: Account, History, Stats.

### Account tab
| Section | Behaviour |
|---------|-----------|
| Display Name | Editable text field; saved via `PATCH /api/profile/display_name`; updates avatar initial |
| Email Address | `supaAuth.auth.updateUser({ email })` — browser-only, Supabase sends confirmation to new address |
| Password | "Change Password" button → modal with current password + new + confirm; re-authenticates via `signInWithPassword` before calling `updateUser` |
| Danger Zone | "Delete Account" button → confirm modal → `DELETE /api/profile` (deletes sessions + auth user) |

### History tab
- Calls `GET /api/profile/history` with Bearer JWT
- Shows each session: name, date, team names, full player roster (skill + role badges + captain crown), toss results

### Stats tab
- Calls `GET /api/profile/stats` with Bearer JWT
- Shows per-player aggregates across all sessions: games played, times as captain, times as bowler

### Boot sequence
Uses `supaAuth.auth.getSession()` directly (not `onAuthStateChange`) to reliably get the current session on page load. Guest users see a sign-in gate.

---

## Authentication (Optional)

Auth is opt-in. App works fully without it — all sessions are anonymous (no `owner_id`).

### Enable auth
1. Set `SUPABASE_ANON_KEY` in `.env`
2. Run `supabase_auth_migration.sql` in Supabase SQL Editor
3. Enable Email provider: Supabase Dashboard → Authentication → Providers → Email

### Claim flow
When a guest signs in, the frontend collects all session UUIDs from `localStorage` and the
session dropdown, then calls `POST /api/auth/claim`. The backend updates `owner_id` on any
sessions where it is currently `NULL`, atomically assigning them to the new user.

---

## Setup Checklist

```
[ ] 1. Activate venv:  app\cricket\Scripts\activate
[ ] 2. Install deps:   pip install -r app/requirements.txt
[ ] 3. Create .env at project root with SUPABASE_URL + SUPABASE_SECRET_KEY
[ ] 4. Run supabase_schema.sql in Supabase SQL Editor
[ ] 5. Run supabase_auth_migration.sql (if using auth)
[ ] 6. Run supabase_features_migration.sql (can_bowl + team name columns)
[ ] 7. Run supabase_profile_migration.sql (user_profiles table)
[ ] 8. Run: ALTER TABLE user_profiles DISABLE ROW LEVEL SECURITY;
[ ] 9. Run supabase_scoring_migration.sql (scorekeeping tables)
[ ]10. Run supabase_toss_decision_migration.sql (winner_team + elected_to on toss_history)
[ ]11. Run supabase_team_score_migration.sql (bowl_type on players, opening pair on innings, innings_overs table)
[ ]12. Run supabase_watch_migration.sql (watch_code column on matches)
[ ]12. Set SUPABASE_ANON_KEY in .env (if using auth)
[ ]12. Add icon-192.png and icon-512.png to app/static/icons/
[ ]13. Run server: uvicorn app.main:app --reload --port 8000
[ ]14. Visit /score to verify scorekeeping UI loads
```

---

## Running the Server

**Must run from project root.** The `app.main:app` module path requires `app/` to be a
direct child of the working directory.

```powershell
# Development
uvicorn app.main:app --reload --port 8000

# Production
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- App: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`

---

## Common Issues

| Problem | Cause | Fix |
|---------|-------|-----|
| `ModuleNotFoundError: No module named 'app'` | Running uvicorn from inside `app/` | Run from project root |
| `SupabaseException: Invalid API key` | New `sb_secret_...` key format used | Use legacy JWT from "Legacy" tab |
| `KeyError: SUPABASE_URL` | `.env` in wrong place or missing | `.env` must be at project root |
| Teams 404 on load | `supabase_schema.sql` not run | Run schema in Supabase SQL Editor |
| `can_bowl` column missing | `supabase_features_migration.sql` not run | Run features migration |
| Auth chip not showing | `SUPABASE_ANON_KEY` missing/placeholder | Set real anon key in `.env` |
| 401 on sign-in | `supabase_auth_migration.sql` not run | Run auth migration |
| Sessions missing after login | RLS blocking (migration not run) | Run auth migration |
| PWA install prompt missing | No icons at `app/static/icons/` | Add `icon-192.png`, `icon-512.png` |
| Display name save: RLS violation | `user_profiles` table has RLS enabled | Run `ALTER TABLE user_profiles DISABLE ROW LEVEL SECURITY;` |
| Display name save: "cannot insert into view" | Old `user_profiles` view artifact exists | Run `DROP VIEW IF EXISTS user_profiles CASCADE; DROP TABLE IF EXISTS user_profiles CASCADE;` then recreate |
| Delete account 403 | Supabase admin API blocked | Check service_role key is the legacy JWT format |
| Over counter advances on wide/no-ball | `_is_legal()` in `matches.py` was inverted — `not rules.get("wide_counts_as_ball", False)` returned `True` for wides | Fixed: use `bool(rules.get(...))`. Existing DB rows are unaffected; start a new match to get correct `is_legal_ball` values |
| Green pill artifact above bottom bar | `backdrop-filter:blur` on `.bottom-bar` let the last toggle row bleed through the semi-transparent background | Fixed: `.bottom-bar` now uses solid `#080f14` background, no backdrop-filter |
| Multiple bottom bars stack on top of each other | `position:fixed` children escape their parent's `display:none`, so all view bottom-bars were visible simultaneously | Fixed: all `.bottom-bar` divs moved outside `.view` containers; `showView()` hides all bars then shows `#bar-{viewId}` |
| Toss decision PATCH returns 404 | `supabase_toss_decision_migration.sql` not run — `winner_team`/`elected_to` columns missing | Run `supabase_toss_decision_migration.sql` in Supabase SQL Editor |
| Decision panel doesn't show team names | No teams generated yet (`teamsData` is null) | Generate teams (Step 2) before going to toss — team names populate the winner buttons |
| Sessions disappear immediately after creation when logged in | `POST /sessions` didn't read the JWT so `owner_id` was always `NULL`; `GET /sessions` for auth users filters by `owner_id` so the session was invisible | Fixed: `create_session` now reads `Authorization` header and stamps `owner_id` |
| All experts/bowlers end up in one team | Two separate `enumerate()` loops both reset `i=0` so the best non-bowler always went to Team A alongside the best bowler | Fixed: single shared `idx` across both loops with true snake draft |
| Expert skill pill not visibly highlighted | Used dark forest green `rgba(45,106,79)` for border/background — nearly invisible on dark UI | Fixed: updated to bright green `rgba(116,212,148)` matching the pill text color |
| Select dropdown options invisible (Windows) | Native OS dropdown popup renders with light background but option text was cream-colored | Fixed: `option{background:#0e1c28;color:var(--cream)}` + `color-scheme:dark` on `select.finput` |
| Bowler dropdown empty in opening pair / new bowler modal | `can_bowl=true` filter applied to bowling-team players — most players have `can_bowl=false` | Fixed: removed `can_bowl` filter in `openOpeningPairModal()` (JS) and `eligible_bowlers` endpoint (Python); all bowling-team players are eligible |
| "Both innings already created for this match" error on 2nd innings | Double-tap on "Start Innings" button submitted the opening pair POST twice, creating two innings | Fixed: `_openingPairSubmitting` flag in `submitOpeningPair()` — cleared in `finally` block |
| New bowler modal never triggers after over completes | `_derive_batting_state` used `if nxt_over in over_map: current_bowler = over_map[nxt_over]` — branch skipped when next over unassigned, so previous bowler retained | Fixed: `current_bowler = over_map.get(nxt_over)` returns `None` for unassigned overs, correctly making `sc.current_bowler_id === null` |
| New bowler modal not triggered when over ends on a wicket | `else if (overJustDone...)` condition skipped when the preceding `if (wasWicket...)` also fired | Fixed: changed to two separate `if` blocks so both new-batter and new-bowler modals can fire on the same ball |
| Non-striker incorrectly cleared on striker's wicket | `_derive_batting_state` always set `striker = None` on any wicket; didn't check `run_out_end` metadata | Fixed: reads `ball.metadata.run_out_end` and compares `dismissed_id` to determine which end to clear |

---

## Development Conventions

- **New router**: create `app/routers/<name>.py` → `include_router` in `main.py` → document in API Reference above
- **New DB column**: write a new `supabase_*_migration.sql` file → update Database Schema section above → update affected Pydantic model → update Pydantic Models table above
- **New env var**: add to `.env.example` → add to Environment Variables table above
- **New frontend state**: add to Key State Variables table above
- **No ORM**: all DB calls go through `supabase_client` in `database.py`
- **No build step**: JS/CSS stays inside `index.html` or `score.html`; no framework
- **Cascade deletes**: deleting a session auto-removes players, assignments, toss history
- **Skill constraint**: enforced in both Pydantic (`Literal`) and Postgres (`CHECK`)
- **Bowling split is best-effort**: odd number of bowlers gives one team one extra — not rejected
- **`can_bowl` is a balancing hint, not a field rule**: it only affects team generation; during a match ALL players in the bowling team are eligible to bowl
- **Email/password changes**: always browser-side via Supabase JS SDK — never add backend endpoints for these
- **Admin API calls**: only httpx DELETE for account deletion; all other auth admin ops are browser-side
- **Scorekeeping is stateless**: score is always derived from `ball_events` timeline — never store a mutable score counter
- **`_derive_batting_state()`** walks the ball timeline to compute current striker, non-striker, bowler, and over number; reads `metadata.run_out_end` to decide which end is vacated on a run-out, and `metadata.new_non_striker_id` to seat the replacement non-striker
- **Rules are config-driven**: all scoring behaviour (wide runs, free hit, etc.) comes from `match_rules.rules_json`, never hardcoded in `matches.py`
- **Score page is standalone**: `/score` works without a session (Quick Match); `session_id` is optional
- **RULES_PRESETS** is defined in both `models.py` (backend) and `score.html` (frontend JS) — keep them in sync

---

## Dependency Versions (pinned)

```
fastapi==0.111.0
uvicorn[standard]==0.29.0
supabase==2.4.6
python-dotenv==1.0.1
jinja2==3.1.4
aiofiles==23.2.1
httpx>=0.27.0
```

> Do not upgrade `supabase` beyond `2.4.6` without confirming new-format key (`sb_secret_...`) support.
