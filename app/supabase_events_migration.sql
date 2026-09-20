-- Migration #10: day events (all-day codes), grounds, visitor log
-- Run after supabase_match_name_migration.sql
--
-- NOTE: unlike the scorekeeping tables, these tables have RLS ENABLED with NO policies.
-- The anon key ships to every browser, so leaving RLS off would let anyone read event
-- codes and visitor data straight from Supabase's REST API. The backend uses the
-- service_role key, which bypasses RLS, so nothing else is needed.

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
