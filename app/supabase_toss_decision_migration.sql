-- Migration: add winner_team + elected_to to toss_history
-- Run this in the Supabase SQL Editor after the previous migrations.

alter table toss_history
  add column if not exists winner_team text,
  add column if not exists elected_to  text check (elected_to in ('bat', 'field'));
