-- ============================================================
-- Cricket Team Maker — Master Setup Script
-- Run this once on a fresh Supabase project.
-- Combines all migrations in order; safe to re-run (IF NOT EXISTS).
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. CORE TABLES
-- ────────────────────────────────────────────────────────────

create table if not exists sessions (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null default 'Match',
  owner_id   uuid        references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists sessions_owner_id_idx on sessions(owner_id);

create table if not exists players (
  id         uuid        primary key default gen_random_uuid(),
  session_id uuid        not null references sessions(id) on delete cascade,
  name       text        not null,
  skill      text        not null check (skill in ('beginner','intermediate','expert')),
  can_bowl   boolean     not null default false,
  bowl_type  text        not null default 'legal' check (bowl_type in ('legal','throw')),
  created_at timestamptz not null default now()
);

create table if not exists team_assignments (
  id          uuid        primary key default gen_random_uuid(),
  session_id  uuid        not null references sessions(id) on delete cascade,
  player_id   uuid        not null references players(id) on delete cascade,
  team_name   text        not null,
  team_a_name text,
  team_b_name text,
  is_captain  boolean     not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists toss_history (
  id          uuid        primary key default gen_random_uuid(),
  session_id  uuid        not null references sessions(id) on delete cascade,
  result      text        not null check (result in ('heads','tails')),
  winner_team text,
  elected_to  text        check (elected_to in ('bat','field')),
  tossed_at   timestamptz not null default now()
);

create table if not exists user_profiles (
  id           uuid        primary key,  -- matches auth.users.id
  display_name text        not null default '',
  updated_at   timestamptz not null default now()
);


-- ────────────────────────────────────────────────────────────
-- 2. SCOREKEEPING TABLES
-- ────────────────────────────────────────────────────────────

create table if not exists matches (
  id               uuid        primary key default gen_random_uuid(),
  session_id       uuid        references sessions(id) on delete set null,
  match_type       text        not null default 'quick' check (match_type in ('quick','team')),
  status           text        not null default 'setup' check (status in ('setup','live','innings_break','completed')),
  overs            integer     not null default 6,
  players_per_side integer     not null default 6,
  rules_preset     text        not null default 'standard',
  watch_code       text        unique,
  name             text,
  created_at       timestamptz not null default now()
);

create unique index if not exists matches_watch_code_idx on matches(watch_code);

create table if not exists match_rules (
  id         uuid        primary key default gen_random_uuid(),
  match_id   uuid        not null references matches(id) on delete cascade,
  rules_json jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (match_id)
);

create table if not exists innings (
  id                     uuid        primary key default gen_random_uuid(),
  match_id               uuid        not null references matches(id) on delete cascade,
  innings_number         integer     not null check (innings_number in (1,2)),
  batting_team           text        not null,
  bowling_team           text        not null,
  target                 integer,
  status                 text        not null default 'live' check (status in ('live','completed')),
  opening_striker_id     uuid        references players(id) on delete set null,
  opening_non_striker_id uuid        references players(id) on delete set null,
  created_at             timestamptz not null default now(),
  unique (match_id, innings_number)
);

create table if not exists innings_overs (
  id          uuid        primary key default gen_random_uuid(),
  innings_id  uuid        not null references innings(id) on delete cascade,
  over_number integer     not null,
  bowler_id   uuid        references players(id) on delete set null,
  bowl_type   text        not null default 'legal' check (bowl_type in ('legal','throw')),
  created_at  timestamptz not null default now(),
  unique (innings_id, over_number)
);

create table if not exists ball_events (
  id            uuid        primary key default gen_random_uuid(),
  innings_id    uuid        not null references innings(id) on delete cascade,
  over_number   integer     not null,
  ball_number   integer     not null,
  event_type    text        not null check (event_type in (
                  'dot','runs','wide','no_ball','bye','leg_bye','wicket','dead_ball','penalty'
                )),
  runs          integer     not null default 0,
  extras        integer     not null default 0,
  extra_type    text        check (extra_type in ('wide','no_ball','bye','leg_bye') or extra_type is null),
  is_legal_ball boolean     not null default true,
  is_boundary   boolean     not null default false,
  boundary_type text        check (boundary_type in ('four','six') or boundary_type is null),
  wicket_type   text        check (wicket_type in ('bowled','caught','run_out','lbw','stumped','hit_wicket') or wicket_type is null),
  batter_id     uuid        references players(id) on delete set null,
  bowler_id     uuid        references players(id) on delete set null,
  metadata      jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create table if not exists player_match_stats (
  id            uuid  primary key default gen_random_uuid(),
  match_id      uuid  not null references matches(id) on delete cascade,
  player_id     uuid  references players(id) on delete set null,
  player_name   text  not null,
  batting_stats jsonb not null default '{}'::jsonb,
  bowling_stats jsonb not null default '{}'::jsonb,
  unique (match_id, player_id)
);


-- ────────────────────────────────────────────────────────────
-- 3. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────

-- Session-scoped tables: RLS ON (backend service_role bypasses; policies below cover browser SDK)
alter table sessions         enable row level security;
alter table players          enable row level security;
alter table team_assignments enable row level security;
alter table toss_history     enable row level security;

-- user_profiles: RLS OFF (backend service_role only; no direct browser access needed)
alter table user_profiles disable row level security;

-- Scorekeeping tables: RLS OFF (backend service_role only)
alter table matches           disable row level security;
alter table match_rules       disable row level security;
alter table innings           disable row level security;
alter table innings_overs     disable row level security;
alter table ball_events       disable row level security;
alter table player_match_stats disable row level security;


-- ────────────────────────────────────────────────────────────
-- 4. RLS POLICIES  (sessions / players / team_assignments / toss_history)
-- ────────────────────────────────────────────────────────────

-- Drop any stale policies before recreating (safe on first run — IF EXISTS)
drop policy if exists "anon_read_ownerless_sessions"   on sessions;
drop policy if exists "anon_insert_sessions"           on sessions;
drop policy if exists "anon_delete_ownerless_sessions" on sessions;
drop policy if exists "auth_read_own_sessions"         on sessions;
drop policy if exists "auth_insert_own_sessions"       on sessions;
drop policy if exists "auth_update_own_sessions"       on sessions;
drop policy if exists "auth_delete_own_sessions"       on sessions;
drop policy if exists "read_players_by_session"        on players;
drop policy if exists "insert_players_by_session"      on players;
drop policy if exists "update_players_by_session"      on players;
drop policy if exists "delete_players_by_session"      on players;
drop policy if exists "read_teams_by_session"          on team_assignments;
drop policy if exists "insert_teams_by_session"        on team_assignments;
drop policy if exists "delete_teams_by_session"        on team_assignments;
drop policy if exists "read_toss_by_session"           on toss_history;
drop policy if exists "insert_toss_by_session"         on toss_history;

-- sessions
create policy "anon_read_ownerless_sessions" on sessions
  for select using (owner_id is null);

create policy "anon_insert_sessions" on sessions
  for insert with check (owner_id is null);

create policy "anon_delete_ownerless_sessions" on sessions
  for delete using (owner_id is null);

create policy "auth_read_own_sessions" on sessions
  for select using (auth.uid() = owner_id);

create policy "auth_insert_own_sessions" on sessions
  for insert with check (auth.uid() = owner_id);

create policy "auth_update_own_sessions" on sessions
  for update using (auth.uid() = owner_id);

create policy "auth_delete_own_sessions" on sessions
  for delete using (auth.uid() = owner_id);

-- players
create policy "read_players_by_session" on players
  for select using (
    exists (select 1 from sessions s where s.id = players.session_id
            and (s.owner_id is null or s.owner_id = auth.uid()))
  );

create policy "insert_players_by_session" on players
  for insert with check (
    exists (select 1 from sessions s where s.id = players.session_id
            and (s.owner_id is null or s.owner_id = auth.uid()))
  );

create policy "update_players_by_session" on players
  for update using (
    exists (select 1 from sessions s where s.id = players.session_id
            and (s.owner_id is null or s.owner_id = auth.uid()))
  );

create policy "delete_players_by_session" on players
  for delete using (
    exists (select 1 from sessions s where s.id = players.session_id
            and (s.owner_id is null or s.owner_id = auth.uid()))
  );

-- team_assignments
create policy "read_teams_by_session" on team_assignments
  for select using (
    exists (select 1 from sessions s where s.id = team_assignments.session_id
            and (s.owner_id is null or s.owner_id = auth.uid()))
  );

create policy "insert_teams_by_session" on team_assignments
  for insert with check (
    exists (select 1 from sessions s where s.id = team_assignments.session_id
            and (s.owner_id is null or s.owner_id = auth.uid()))
  );

create policy "delete_teams_by_session" on team_assignments
  for delete using (
    exists (select 1 from sessions s where s.id = team_assignments.session_id
            and (s.owner_id is null or s.owner_id = auth.uid()))
  );

-- toss_history
create policy "read_toss_by_session" on toss_history
  for select using (
    exists (select 1 from sessions s where s.id = toss_history.session_id
            and (s.owner_id is null or s.owner_id = auth.uid()))
  );

create policy "insert_toss_by_session" on toss_history
  for insert with check (
    exists (select 1 from sessions s where s.id = toss_history.session_id
            and (s.owner_id is null or s.owner_id = auth.uid()))
  );


-- ────────────────────────────────────────────────────────────
-- 5. DAY EVENTS, GROUNDS, VISITOR LOG  (supabase_events_migration.sql)
-- ────────────────────────────────────────────────────────────

-- ── Grounds (saved venues, reused across matches) ─────────────────────────────
CREATE TABLE IF NOT EXISTS grounds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  latitude    double precision,
  longitude   double precision,
  address     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grounds_lat_chk CHECK (latitude  IS NULL OR latitude  BETWEEN  -90 AND  90),
  CONSTRAINT grounds_lng_chk CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);
CREATE UNIQUE INDEX IF NOT EXISTS grounds_name_lower_idx ON grounds (lower(name));
ALTER TABLE grounds ENABLE ROW LEVEL SECURITY;

-- ── Events (an organiser's day: one code, a shared player pool, several games) ─
CREATE TABLE IF NOT EXISTS events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  organisation  text,
  code          text NOT NULL UNIQUE,
  ground_id     uuid REFERENCES grounds(id) ON DELETE SET NULL,
  event_date    date NOT NULL DEFAULT current_date,
  expires_at    timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Shared player pool for the day; copied into a game's `players` when picked
CREATE TABLE IF NOT EXISTS event_players (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name        text NOT NULL,
  skill       text NOT NULL CHECK (skill IN ('beginner','intermediate','expert')),
  can_bowl    boolean NOT NULL DEFAULT false,
  bowl_type   text NOT NULL DEFAULT 'legal' CHECK (bowl_type IN ('legal','throw')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS event_players_name_idx ON event_players (event_id, lower(name));
ALTER TABLE event_players ENABLE ROW LEVEL SECURITY;

-- A "game" is an existing session; link it to an event and (optionally) a ground
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS event_id  uuid REFERENCES events(id)  ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ground_id uuid REFERENCES grounds(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sessions_event_idx ON sessions (event_id);

-- Matches remember where they were played
ALTER TABLE matches ADD COLUMN IF NOT EXISTS ground_id uuid REFERENCES grounds(id) ON DELETE SET NULL;

-- ── Visitor log (one row per page view; IP is stored only as a salted hash) ───
CREATE TABLE IF NOT EXISTS visits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash      text,
  user_agent   text,
  device_type  text,
  browser      text,
  os           text,
  language     text,
  country      text,
  path         text NOT NULL,
  referrer     text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS visits_created_at_idx ON visits (created_at DESC);
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
