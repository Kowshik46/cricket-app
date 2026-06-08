-- Migration 5: Scorekeeping tables
-- Run this in Supabase SQL Editor after supabase_profile_migration.sql

-- matches: one match per session (or standalone)
create table if not exists matches (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid references sessions(id) on delete set null,
  match_type    text not null check (match_type in ('quick', 'team')) default 'quick',
  status        text not null check (status in ('setup', 'live', 'innings_break', 'completed')) default 'setup',
  overs         integer not null default 6,
  players_per_side integer not null default 6,
  rules_preset  text not null default 'standard',
  created_at    timestamptz not null default now()
);

-- match_rules: one row per match, stores the full rules config as JSON
create table if not exists match_rules (
  id           uuid primary key default gen_random_uuid(),
  match_id     uuid not null references matches(id) on delete cascade,
  rules_json   jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  unique (match_id)
);

-- innings: up to 2 innings per match
create table if not exists innings (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references matches(id) on delete cascade,
  innings_number  integer not null check (innings_number in (1, 2)),
  batting_team    text not null,
  bowling_team    text not null,
  target          integer,             -- set after innings 1 completes
  status          text not null check (status in ('live', 'completed')) default 'live',
  created_at      timestamptz not null default now(),
  unique (match_id, innings_number)
);

-- ball_events: every delivery, computed score is derived from timeline
create table if not exists ball_events (
  id            uuid primary key default gen_random_uuid(),
  innings_id    uuid not null references innings(id) on delete cascade,
  over_number   integer not null,   -- 0-indexed
  ball_number   integer not null,   -- 0-indexed within the over (legal balls only for over count)
  event_type    text not null check (event_type in (
                  'dot','runs','wide','no_ball','bye','leg_bye',
                  'wicket','dead_ball','penalty'
                )),
  runs          integer not null default 0,  -- runs credited to score (not extras)
  extras        integer not null default 0,  -- extras credited to total (wide/no_ball/bye/leg_bye)
  extra_type    text check (extra_type in ('wide','no_ball','bye','leg_bye') or extra_type is null),
  is_legal_ball boolean not null default true,  -- false = wide/no-ball (doesn't consume a ball slot)
  is_boundary   boolean not null default false,
  boundary_type text check (boundary_type in ('four','six') or boundary_type is null),
  wicket_type   text check (wicket_type in ('bowled','caught','run_out','lbw','stumped','hit_wicket') or wicket_type is null),
  batter_id     uuid references players(id) on delete set null,
  bowler_id     uuid references players(id) on delete set null,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- player_match_stats: per-player per-match batting & bowling
create table if not exists player_match_stats (
  id                  uuid primary key default gen_random_uuid(),
  match_id            uuid not null references matches(id) on delete cascade,
  player_id           uuid references players(id) on delete set null,
  player_name         text not null,  -- denormalized for quick stats
  batting_stats       jsonb not null default '{}'::jsonb,
  bowling_stats       jsonb not null default '{}'::jsonb,
  unique (match_id, player_id)
);

-- Disable RLS on new tables (backend uses service_role key which bypasses anyway,
-- but explicit disabling keeps behaviour predictable)
alter table matches disable row level security;
alter table match_rules disable row level security;
alter table innings disable row level security;
alter table ball_events disable row level security;
alter table player_match_stats disable row level security;
