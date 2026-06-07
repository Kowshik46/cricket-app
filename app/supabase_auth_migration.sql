-- Cricket Team Maker — Auth Migration
-- Run this in Supabase SQL Editor AFTER the initial supabase_schema.sql

-- 1. Add nullable owner_id to sessions
alter table sessions
  add column if not exists owner_id uuid references auth.users(id) on delete set null;

create index if not exists sessions_owner_id_idx on sessions(owner_id);

-- 2. Drop existing blanket RLS block (if any permissive policies exist) — safe to run even if none exist
drop policy if exists "anon_all_sessions"  on sessions;
drop policy if exists "anon_all_players"   on players;
drop policy if exists "anon_all_teams"     on team_assignments;
drop policy if exists "anon_all_toss"      on toss_history;

-- ─── sessions ───────────────────────────────────────────────────────────────
-- Anon can read/write sessions that have no owner (anonymous sessions)
create policy "anon_read_ownerless_sessions" on sessions
  for select using (owner_id is null);

create policy "anon_insert_sessions" on sessions
  for insert with check (owner_id is null);

create policy "anon_delete_ownerless_sessions" on sessions
  for delete using (owner_id is null);

-- Authenticated users can read/write/delete their own sessions
create policy "auth_read_own_sessions" on sessions
  for select using (auth.uid() = owner_id);

create policy "auth_insert_own_sessions" on sessions
  for insert with check (auth.uid() = owner_id);

create policy "auth_update_own_sessions" on sessions
  for update using (auth.uid() = owner_id);

create policy "auth_delete_own_sessions" on sessions
  for delete using (auth.uid() = owner_id);

-- Allow the backend service_role to claim sessions (update owner_id from null → user id)
-- service_role bypasses RLS entirely, so no extra policy needed.

-- ─── players ────────────────────────────────────────────────────────────────
-- Players are accessible if the parent session is accessible
create policy "read_players_by_session" on players
  for select using (
    exists (
      select 1 from sessions s where s.id = players.session_id
        and (s.owner_id is null or s.owner_id = auth.uid())
    )
  );

create policy "insert_players_by_session" on players
  for insert with check (
    exists (
      select 1 from sessions s where s.id = players.session_id
        and (s.owner_id is null or s.owner_id = auth.uid())
    )
  );

create policy "delete_players_by_session" on players
  for delete using (
    exists (
      select 1 from sessions s where s.id = players.session_id
        and (s.owner_id is null or s.owner_id = auth.uid())
    )
  );

-- ─── team_assignments ───────────────────────────────────────────────────────
create policy "read_teams_by_session" on team_assignments
  for select using (
    exists (
      select 1 from sessions s where s.id = team_assignments.session_id
        and (s.owner_id is null or s.owner_id = auth.uid())
    )
  );

create policy "insert_teams_by_session" on team_assignments
  for insert with check (
    exists (
      select 1 from sessions s where s.id = team_assignments.session_id
        and (s.owner_id is null or s.owner_id = auth.uid())
    )
  );

create policy "delete_teams_by_session" on team_assignments
  for delete using (
    exists (
      select 1 from sessions s where s.id = team_assignments.session_id
        and (s.owner_id is null or s.owner_id = auth.uid())
    )
  );

-- ─── toss_history ───────────────────────────────────────────────────────────
create policy "read_toss_by_session" on toss_history
  for select using (
    exists (
      select 1 from sessions s where s.id = toss_history.session_id
        and (s.owner_id is null or s.owner_id = auth.uid())
    )
  );

create policy "insert_toss_by_session" on toss_history
  for insert with check (
    exists (
      select 1 from sessions s where s.id = toss_history.session_id
        and (s.owner_id is null or s.owner_id = auth.uid())
    )
  );
