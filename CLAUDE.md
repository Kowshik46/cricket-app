# Cricket Team Maker — Claude Code Guide

> **Self-maintenance rule:** Whenever a core component changes, update this file in the same
> commit/edit. Core components are: routers, models, database schema, environment variables,
> frontend SPA structure, auth flow, and dependency versions. If you add a table, add it to
> [Database Schema](#database-schema). If you add an endpoint, add it to [API Reference](#api-reference).
> If you add an env var, add it to [Environment Variables](#environment-variables). No exceptions.

---

## Project Overview

A **FastAPI + Supabase PWA** that fairly splits cricket players into two skill-balanced and
bowling-balanced teams. Originally a single-file HTML tool, now a full-stack web app with:

- Persistent match sessions with cross-device sync (optional auth)
- Skill-level + bowling-ability balanced team generation
- Inline player editing (name, skill, can_bowl) after addition
- Match session renaming
- Late-player addition directly from the Teams view
- Teams preserved across navigation — no accidental regeneration
- Coin toss with history
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
│   │   ├── toss.py                 ← coin toss + history
│   │   ├── auth.py                 ← JWT verify, /me, /claim
│   │   └── profile.py              ← history, stats, display name, delete account
│   ├── templates/
│   │   ├── index.html              ← main SPA (HTML + CSS + JS, no build step)
│   │   └── profile.html            ← profile page (account mgmt, history, stats)
│   ├── static/
│   │   ├── manifest.json           ← PWA manifest
│   │   ├── sw.js                   ← service worker
│   │   └── icons/                  ← icon-192.png, icon-512.png (add manually)
│   ├── supabase_schema.sql         ← initial table creation (run first)
│   ├── supabase_auth_migration.sql ← adds owner_id + RLS policies (run second)
│   ├── supabase_features_migration.sql ← adds can_bowl, team name columns (run third)
│   ├── supabase_profile_migration.sql  ← creates user_profiles table (run fourth)
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
| `POST` | `/api/sessions` | `{name}` | Create session |
| `GET` | `/api/sessions` | — | List sessions (latest 50) |
| `GET` | `/api/sessions/{id}` | — | Get single session |
| `PATCH` | `/api/sessions/{id}` | `{name}` | Rename session |
| `DELETE` | `/api/sessions/{id}` | — | Delete + cascade all children |

### Players — `/api/sessions/{id}/players`
| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `…/players` | `{name, skill, can_bowl}` | Add player; rejects duplicate names (case-insensitive) |
| `GET` | `…/players` | — | List players ordered by `created_at` |
| `PATCH` | `…/players/{player_id}` | `{name?, skill?, can_bowl?}` | Update player fields; rejects duplicate name (excludes self) |
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
| `POST` | `…/toss` | — | Flip coin, store result, return toss number |
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

> **Forgot password** is handled browser-side via `supaAuth.auth.resetPasswordForEmail()` with `redirectTo: window.location.origin + '/'`. The `PASSWORD_RECOVERY` event in `onAuthStateChange` opens the set-new-password modal.

---

## Pydantic Models (`app/models.py`)

> **Rule:** Any new model or field change must be reflected here.

| Model | Direction | Fields |
|-------|-----------|--------|
| `SessionCreate` | request | `name` |
| `SessionRename` | request | `name` (required, min 1) |
| `SessionOut` | response | `id, name, created_at` |
| `PlayerCreate` | request | `name, skill, can_bowl=False` |
| `PlayerUpdate` | request | `name?, skill?, can_bowl?` (all optional, at least one required) |
| `PlayerOut` | response | `id, session_id, name, skill, can_bowl, created_at` |
| `TeamGenerateRequest` | request | `team_a_name="Team A", team_b_name="Team B"` |
| `TeamAssignmentOut` | response | `player_id, player_name, skill, can_bowl, team_name, is_captain` |
| `TeamsOut` | response | `team_a_name, team_b_name, assignments[]` |
| `AddToTeamRequest` | request | `name, skill, can_bowl=False, team_name` |
| `TossResult` | response | `result, toss_number, session_id` |
| `TossHistoryItem` | response | `id, result, tossed_at` |
| `UserOut` | response | `id, email` |
| `ClaimRequest` | request | `session_ids[]` |
| `TossHistorySummary` | response | `result, tossed_at` |
| `MatchPlayerItem` | response | `name, skill, can_bowl, team_name, is_captain` |
| `MatchHistoryItem` | response | `id, name, created_at, team_a_name, team_b_name, players[], toss_history[]` |
| `PlayerStatsItem` | response | `name, games, as_captain, as_bowler` |
| `UpdateDisplayNameRequest` | request | `display_name` (min 1, max 40) |

---

## Team Generation Algorithm

Located in `app/routers/teams.py → _split_balanced()`.

1. Separate players into **bowlers** (`can_bowl=True`) and **non-bowlers**
2. Sort each group by skill weight descending (`expert=3, intermediate=2, beginner=1`)
3. Snake-draft bowlers into Team A / Team B (alternating) — ensures even bowling split
4. Snake-draft non-bowlers into Team A / Team B
5. Within each team, shuffle players within the same skill tier (`_tier_shuffle`)
6. Pick one random captain per team
7. Store `team_a_name` and `team_b_name` on every assignment row (for DB reconstruction)
8. Delete all previous assignments for the session, insert new batch

**Adding a late player** (`/teams/add_player`): creates the player in `players`, inserts one
`team_assignments` row with `is_captain=False`, returns the full updated teams via `get_teams`.
No reshuffling occurs.

---

## Frontend SPA (`app/templates/index.html`)

Single file — HTML + CSS + JS. No build step. All styles are inline `<style>`, all JS is
inline `<script>`. To add a feature: edit this file directly.

### UI Structure
| Section | ID | Description |
|---------|----|-------------|
| Header | `header` | App title, animated bat, auth chip (top-right) |
| Session bar | `.session-bar` | Dropdown select, new (+) button, rename (✎) button, delete (🗑) button |
| Stepper | `.steps` | Steps 1→2→3 with done/active/pending states |
| Step 1 | `#sec1` | Add players: name input, skill pills, can_bowl toggle, player list with inline edit |
| Step 2 | `#sec2` | Team cards, action row, collapsible late-player add panel |
| Step 3 | `#sec3` | Coin toss with animation and history |

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

### Key localStorage
| Key | Value |
|-----|-------|
| `cricket_last_session` | UUID of the last active session (restored on load) |

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
- Cache name: `cricket-v1`
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
[ ] 9. Set SUPABASE_ANON_KEY in .env (if using auth)
[ ]10. Add icon-192.png and icon-512.png to app/static/icons/
[ ]11. Run server: uvicorn app.main:app --reload --port 8000
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

---

## Development Conventions

- **New router**: create `app/routers/<name>.py` → `include_router` in `main.py` → document in API Reference above
- **New DB column**: write a new `supabase_*_migration.sql` file → update Database Schema section above → update affected Pydantic model → update Pydantic Models table above
- **New env var**: add to `.env.example` → add to Environment Variables table above
- **New frontend state**: add to Key State Variables table above
- **No ORM**: all DB calls go through `supabase_client` in `database.py`
- **No build step**: JS/CSS stays inside `index.html`
- **Cascade deletes**: deleting a session auto-removes players, assignments, toss history
- **Skill constraint**: enforced in both Pydantic (`Literal`) and Postgres (`CHECK`)
- **Bowling split is best-effort**: odd number of bowlers gives one team one extra — not rejected
- **Email/password changes**: always browser-side via Supabase JS SDK — never add backend endpoints for these
- **Admin API calls**: only httpx DELETE for account deletion; all other auth admin ops are browser-side

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
