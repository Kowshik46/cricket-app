-- Cricket Team Maker — Supabase Schema
-- Run this in your Supabase SQL editor (Dashboard → SQL Editor → New query)

-- Sessions: each "match setup" is a session
create table if not exists sessions (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'Match',
  created_at timestamptz not null default now()
);

-- Players within a session
create table if not exists players (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  name       text not null,
  skill      text not null check (skill in ('beginner','intermediate','expert')),
  created_at timestamptz not null default now()
);

-- Generated team assignments
create table if not exists team_assignments (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  team_name  text not null,
  is_captain boolean not null default false,
  created_at timestamptz not null default now()
);

-- Toss history
create table if not exists toss_history (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  result     text not null check (result in ('heads','tails')),
  tossed_at  timestamptz not null default now()
);

-- Enable Row Level Security.
-- The backend uses the Secret key which bypasses RLS entirely,
-- so no permissive policies are needed. Direct browser/anon access is blocked.
alter table sessions         enable row level security;
alter table players          enable row level security;
alter table team_assignments enable row level security;
alter table toss_history     enable row level security;
