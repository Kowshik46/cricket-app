-- Migration #8: watch code for live spectator feature
-- Run after supabase_team_score_migration.sql

ALTER TABLE matches ADD COLUMN IF NOT EXISTS watch_code text UNIQUE;
CREATE UNIQUE INDEX IF NOT EXISTS matches_watch_code_idx ON matches(watch_code);
