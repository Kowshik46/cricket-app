-- Cricket Team Maker — Features Migration
-- Run in Supabase SQL Editor after supabase_schema.sql (and supabase_auth_migration.sql if using auth)

-- 1. Add can_bowl flag to players (default false so existing rows are unaffected)
alter table players
  add column if not exists can_bowl boolean not null default false;

-- 2. Add team_a_name / team_b_name to team_assignments so we can reconstruct
--    which two names were used without re-querying elsewhere
alter table team_assignments
  add column if not exists team_a_name text;

alter table team_assignments
  add column if not exists team_b_name text;

-- 3. Expose can_bowl in the player-level team assignment view
--    (no schema change needed — we'll join players table in queries)
