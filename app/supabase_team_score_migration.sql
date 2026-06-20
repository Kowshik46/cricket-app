-- Migration #7: team-linked scorekeeping schema additions
-- Run after supabase_toss_decision_migration.sql

-- 1. bowl_type on players (all existing rows get 'legal' via DEFAULT)
ALTER TABLE players
  ADD COLUMN bowl_type text NOT NULL DEFAULT 'legal'
             CHECK (bowl_type IN ('legal','throw'));

-- 2. Opening pair on innings
ALTER TABLE innings
  ADD COLUMN opening_striker_id     uuid NULL REFERENCES players(id) ON DELETE SET NULL,
  ADD COLUMN opening_non_striker_id uuid NULL REFERENCES players(id) ON DELETE SET NULL;

-- 3. Per-over bowler + bowl type
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
