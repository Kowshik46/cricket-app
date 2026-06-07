-- Cricket Team Maker — Profile Migration
-- Run in Supabase SQL Editor after all previous migrations.

create table if not exists user_profiles (
  id           uuid primary key,
  display_name text not null default '',
  updated_at   timestamptz not null default now()
);
