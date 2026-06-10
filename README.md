# 🏏 Cricket Team Maker

A mobile-first PWA for splitting a group of cricketers into two fair, balanced teams.
Built with FastAPI + Supabase. Works offline, installable on your phone, and optionally
syncs your match history across devices when you sign in.

---

## Features

### Team Generation
- **Skill-balanced split** — players rated Beginner / Intermediate / Expert are distributed
  evenly between teams using a snake-draft algorithm
- **Bowling-balanced split** — mark players as bowlers; the split ensures each team gets an
  equal number (or as close as possible)
- **Custom team names** — name your teams before generating
- **Random captain selection** — one captain picked per team automatically
- **Reshuffle** — regenerate with the same team names any time

### Match Sessions
- Create named match sessions (e.g. "Sunday Park Game")
- **Rename** any session directly from the session bar (✎ button)
- Switch between multiple sessions from the session bar
- Sessions and teams persist — coming back to Step 1 never wipes your teams
- Delete sessions (cascades to all players, teams, and toss history)

### Players
- Add players with name, skill level, and bowling ability
- **Inline editing** — click ✎ on any player to edit name, skill, and bowl status in place; Enter saves, Escape cancels
- **Role badge** — shows "Bat & Bowl" for bowlers, "Bat" for non-bowlers
- Duplicate name check (case-insensitive) per session, including when editing
- Remove individual players

### Late Player Addition
- On the Teams page, expand **"+ Add Late Player"**
- Choose name, skill, bowling ability, and which team they join
- Defaults to the smaller team automatically (switchable)
- Teams update instantly — no reshuffle

### Coin Toss
- Animated 3D coin flip — coin has **H** (heads) and **T** (tails) faces; the animation ends on the correct face matching the result
- **Quick Toss** button in Step 1 — jump straight to the toss without going through players or teams; a session is created silently in the background if one doesn't exist yet
- Results stored per session with a toss counter
- After the flip, an inline **decision panel** appears — tap the winning team, then choose whether they **Bat** or **Field**
- Decision (winner + election) is saved to the database immediately and shown in the toss history row
- Full toss history shown inline; each entry shows the coin result plus the recorded decision

### Ball-by-Ball Scorekeeping
- **Quick Match mode** at `/score` — no player roster needed, just team names and overs
- Records dot balls, runs (0–6), wide, no ball, bye, leg bye, and wickets
- **Two-innings match** — both teams bat; innings break screen shows target, second innings chases
- **Win detection** — result shown the moment the chasing team passes the target or loses all wickets
- **Undo** — delete the last ball and recompute everything from the timeline
- **Free Hit** — no-ball triggers a 🔥 free-hit banner; only Run Out allowed on that delivery; gold ring marker in over breakdown
- **Over breakdown** — every over listed with ball-by-ball detail and over total
- Configurable: overs, players/side, max wickets (supports single-batter format), and three rule toggles:
  - Wide gives +1 extra run
  - No Ball gives +1 extra run
  - No Ball triggers Free Hit
- Launch from the "🏏 Score →" button on Step 3 (Toss), or "Quick Score" from Step 1

### Share
- Format both teams as plaintext (with skill + bowl labels)
- One-tap copy to clipboard

### PWA / Offline
- Installable on Android and iOS ("Add to Home Screen")
- Offline shell — the app UI loads without a network connection
- API calls always go to the network; static assets served from cache

### Account & Profile
- **Sign up / sign in** with email and password
- **Display name** — set a name shown in the app header and profile; updates immediately in the auth chip
- **Forgot password** — receive a reset link by email; clicking it opens a set-new-password prompt directly in the app
- **Change email** — update your email address (Supabase sends a confirmation to the new address)
- **Change password** — requires your current password before setting a new one
- After signing in, any sessions you created as a guest are automatically claimed to your account
- **Delete account** — permanently removes all match sessions and your auth account

### Match History & Stats
- **History tab** — view all past matches with full rosters (skill, role, captain), team names, and toss results
- **Stats tab** — per-player career stats across all sessions: games played, times as captain, times as bowler

---

## Quick Start

### Prerequisites
- Python 3.11+
- A [Supabase](https://supabase.com) project (free tier works)

### 1. Clone and set up the environment

```powershell
# Activate the virtual environment (Windows)
app\cricket\Scripts\activate

# Install dependencies
pip install -r app/requirements.txt
```

### 2. Configure environment variables

Create `.env` in the project root:

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SECRET_KEY=eyJ...   # Legacy service_role JWT key

# Optional — enables sign in / sign up / profile page
SUPABASE_ANON_KEY=eyJ...     # Legacy anon JWT key
```

> **Where to get the keys:**
> Supabase Dashboard → Project Settings → API Keys → **"Legacy anon, service_role API keys"** tab
> - `SUPABASE_SECRET_KEY` = the **service_role** row
> - `SUPABASE_ANON_KEY` = the **anon** row

### 3. Set up the database

In Supabase Dashboard → SQL Editor, run the following files **in order**:

| File | Purpose |
|------|---------|
| `app/supabase_schema.sql` | Creates all base tables |
| `app/supabase_auth_migration.sql` | Adds `owner_id` + RLS policies (needed for auth) |
| `app/supabase_features_migration.sql` | Adds `can_bowl` and team name columns |
| `app/supabase_profile_migration.sql` | Creates `user_profiles` table for display names |
| `app/supabase_scoring_migration.sql` | Creates scorekeeping tables (`matches`, `innings`, `ball_events`, etc.) |
| `app/supabase_toss_decision_migration.sql` | Adds `winner_team` and `elected_to` columns to `toss_history` |

After running `supabase_profile_migration.sql`, also run this one-liner to disable RLS on that table:

```sql
alter table user_profiles disable row level security;
```

### 4. Add PWA icons (optional)

Place icon files at:
```
app/static/icons/icon-192.png
app/static/icons/icon-512.png
```

### 5. Run the server

```powershell
# From the project root
uvicorn app.main:app --reload --port 8000
```

Open [http://localhost:8000](http://localhost:8000)

---

## How to Use

### Step 1 — Add Players
1. Create or select a match session from the bar at the top
2. Type a player name, pick their skill level, and toggle **Can Bowl** if they bowl
3. Tap **+ ADD PLAYER** (or press Enter)
4. Repeat for all players
5. To edit a player after adding, tap the ✎ icon — change name, skill, or bowl status inline
6. Tap **⚡ Generate Teams** when ready
7. Or use the shortcut buttons to skip ahead:
   - **🏏 Quick Score** — go straight to the scoring page without generating teams
   - **🪙 Quick Toss** — go straight to the coin toss (creates a session automatically if needed)

### Step 2 — Teams
- Teams are displayed with skill and role badges on each player
- The 👑 badge shows the randomly selected captain
- Use **🔀 Reshuffle** to regenerate with different assignments
- Use **📋 Share** to copy teams as text
- Tap **← Players** to go back — your teams are saved and won't regenerate
- Expand **+ Add Late Player** to add a new player directly to a team

### Step 3 — Toss
- Tap the coin (or **🪙 Toss Again**) to flip
- Results are saved with a toss number
- After the coin lands, a **decision panel** slides in:
  1. Tap the team that **won** the toss (buttons show your actual team names)
  2. Tap **🏏 Bat** or **🧤 Field** — this choice is saved to the database
  3. The history row updates to show the team name and their election
- Tap **🔄 New Match** to clear the toss and go back to players (teams stay)

### Profile Page
- Click your name/avatar in the top-right corner → **👤 My Profile**
- **Account tab** — update display name, email, or password; delete your account
- **History tab** — browse all your past matches with full rosters
- **Stats tab** — see career stats per player across all sessions

---

## Project Structure

```
Cricket team genrator/
├── app/
│   ├── main.py                          ← FastAPI entry point + page routes
│   ├── database.py                      ← Supabase client (service_role)
│   ├── models.py                        ← Pydantic schemas
│   ├── routers/
│   │   ├── sessions.py                  ← create, list, get, rename, delete sessions
│   │   ├── players.py                   ← add, list, edit, delete players
│   │   ├── teams.py                     ← generate teams, fetch teams, add late player
│   │   ├── toss.py                      ← coin toss + history
│   │   ├── auth.py                      ← JWT verify, /me, /claim
│   │   ├── profile.py                   ← history, stats, display name, delete account
│   │   └── matches.py                   ← scorekeeping: matches, innings, ball events, undo
│   ├── templates/
│   │   ├── index.html                   ← main SPA (no build step)
│   │   ├── profile.html                 ← profile page
│   │   └── score.html                   ← ball-by-ball scoring UI (/score)
│   ├── static/
│   │   ├── manifest.json
│   │   ├── sw.js
│   │   └── icons/
│   ├── supabase_schema.sql
│   ├── supabase_auth_migration.sql
│   ├── supabase_features_migration.sql
│   ├── supabase_profile_migration.sql
│   ├── supabase_scoring_migration.sql
│   ├── supabase_toss_decision_migration.sql
│   └── requirements.txt
├── .env                                 ← secrets (gitignored)
├── .env.example                         ← template
├── CLAUDE.md                            ← developer guide (Claude Code)
└── README.md                            ← this file
```

---

## API Overview

Interactive docs available at `http://localhost:8000/docs` when the server is running.

| Group | Endpoints |
|-------|-----------|
| Sessions | `POST /api/sessions` · `GET /api/sessions` · `GET /api/sessions/{id}` · `PATCH /api/sessions/{id}` · `DELETE /api/sessions/{id}` |
| Players | `POST …/players` · `GET …/players` · `PATCH …/players/{pid}` · `DELETE …/players/{pid}` |
| Teams | `POST …/teams/generate` · `GET …/teams` · `POST …/teams/add_player` |
| Toss | `POST …/toss` · `PATCH …/toss/{id}` · `GET …/toss/history` |
| Auth | `GET /api/auth/me` · `POST /api/auth/claim` |
| Profile | `GET /api/profile/history` · `GET /api/profile/stats` · `GET /api/profile/display_name` · `PATCH /api/profile/display_name` · `DELETE /api/profile` |
| Matches | `POST /api/matches` · `GET /api/matches/{id}/scorecard` · `POST …/innings` · `POST …/innings/{id}/ball` · `POST …/innings/{id}/undo` · and more |

---

## Tech Stack

| | |
|-|-|
| Backend | [FastAPI](https://fastapi.tiangolo.com) + [Uvicorn](https://www.uvicorn.org) |
| Database | [Supabase](https://supabase.com) (Postgres) |
| Auth | Supabase Auth (email/password, forgot password via email) |
| Frontend | Vanilla JS — no framework, no build step |
| PWA | Web App Manifest + Service Worker |

---

## Team Balancing Logic

Players are split using a two-pass snake draft:

1. **Bowlers first** — sorted by skill weight (Expert → Intermediate → Beginner), then
   alternated into Team A and Team B. This ensures bowling is evenly distributed.
2. **Non-bowlers** — same sort and alternation, filling the remaining spots.
3. **Tier shuffle** — within each team, players of the same skill level are randomly
   shuffled so the batting order has variety.
4. **Captain** — one player per team is randomly selected as captain.

If the number of bowlers is odd, one team gets one extra bowler (best-effort, not rejected).

---

## Common Issues

| Problem | Fix |
|---------|-----|
| App won't start — `ModuleNotFoundError` | Run `uvicorn` from the **project root**, not inside `app/` |
| `SupabaseException: Invalid API key` | Use the **legacy JWT key** (`eyJ...`) from the "Legacy" tab in Supabase Dashboard |
| Teams gone after navigating back | Run `supabase_features_migration.sql` — adds the team name columns needed for DB restoration |
| `can_bowl` column not found | Run `supabase_features_migration.sql` |
| Sign-in not working | Run `supabase_auth_migration.sql` and enable Email provider in Supabase Dashboard |
| Display name save fails (RLS error) | Run `ALTER TABLE user_profiles DISABLE ROW LEVEL SECURITY;` in Supabase SQL Editor |
| PWA install prompt not appearing | Add `icon-192.png` and `icon-512.png` to `app/static/icons/` |
| `/score` page 500 error | Run `supabase_scoring_migration.sql` — creates the scorekeeping tables |
| Over counter advances on wide/no ball | Fixed in `matches.py` — `_is_legal()` logic was inverted; start a new match to get correct data |
| Toss decision panel shows "Team A / Team B" instead of real names | Teams haven't been generated yet — generate teams in Step 2 before going to Step 3 |
| Toss decision doesn't save (network error) | Run `supabase_toss_decision_migration.sql` — the `winner_team` and `elected_to` columns must exist first |
