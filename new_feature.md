# Cricket Team Maker – Scorekeeping & Match Management Feature

## Overview

The application is evolving from a Cricket Team Generator into a complete Cricket Match Manager.

The existing functionality must remain fully intact.

The new feature introduces a comprehensive Scorekeeping system that supports:

1. Team Generation only
2. Scorekeeping only
3. Team Generation + Toss + Scorekeeping
4. Gully Cricket
5. Box Cricket
6. Corporate Cricket
7. Standard Cricket

The system must be designed so that scorekeeping is NOT dependent on team generation.

---

# Existing Flow

Current application flow:

Create Session
→ Add Players
→ Generate Teams
→ Toss

This flow should continue working exactly as it does today.

---

# New Match Flows

## Flow A – Existing Team Generator + Scorekeeping

Create Session
→ Add Players
→ Generate Teams
→ Toss
→ Scorekeeping

---

## Flow B – Quick Scorekeeping

Create Session
→ Start Scorekeeping

No players required.

No team generation required.

No toss required.

This is intended for quick tracking of local matches where users only care about runs, wickets, and overs.

---

# Core Design Principle

Scorekeeping must be a first-class feature.

The application should support:

* Team Generator only
* Scorekeeper only
* Team Generator + Scorekeeper

without requiring separate applications.

---

# Match Setup

When the user starts scoring, create a Match Setup screen.

---

## Match Name

Default:

Session Name

Editable.

---

## Match Type

Options:

* Team Match
* Quick Match

Definitions:

### Team Match

Uses generated teams.

Tracks:

* Batters
* Bowlers
* Player statistics

### Quick Match

No player tracking.

Tracks:

* Score
* Wickets
* Overs
* Ball events

only.

---

# Match Format

Allow configuration of:

* 4 Overs
* 5 Overs
* 6 Overs
* 8 Overs
* 10 Overs
* 12 Overs
* 15 Overs
* 20 Overs
* Custom Overs

---

## Players Per Side

Options:

* 5
* 6
* 7
* 8
* 10
* 11
* Custom

---

# Rules Engine

IMPORTANT:

No scoring logic should contain hardcoded cricket rules.

Everything must be driven by configuration.

Bad:

```python
if event == "wide":
    score += 1
    reball = True
```

Good:

```python
score += rules.wide_runs
reball = rules.wide_reball
```

---

# Rules Presets

Provide presets.

## Standard Cricket

Wide:
+1 run
Re-ball

No Ball:
+1 run
Re-ball
Free Hit

---

## Box Cricket

Wide:
+1 run
Counts as ball

No Ball:
+1 run
Counts as ball

Free Hit:
Disabled

---

## Gully Cricket

Venue-dependent.

All settings editable.

---

## Custom

Everything configurable.

---

# Wide Ball Rules

Configurable:

wide_runs

Options:

0
1
2
Custom

---

wide_counts_as_ball

true
false

---

wide_reball

true
false

---

# No Ball Rules

Configurable:

no_ball_runs

0
1
2
Custom

---

no_ball_counts_as_ball

true
false

---

no_ball_reball

true
false

---

free_hit_enabled

true
false

---

# Free Hit Rules

Configurable.

Options:

Enabled
Disabled

Dismissal Rules:

* No dismissal
* Run out only
* Run out + Stumping
* All dismissals

---

# Wicket Rules

Allow enabling/disabling:

* Bowled
* Caught
* Run Out
* LBW
* Stumping
* Hit Wicket

---

# Last Man Standing

Common in gully cricket.

Configurable:

Enabled
Disabled

If enabled:

Last batter continues batting alone.

---

# Retirement Rules

Configurable.

Examples:

Retire at:

* 25
* 30
* 50
* Custom
* Disabled

---

# Bonus Rules

Support:

* Bonus runs
* Milestone bonuses
* Venue bonuses

Future-proof schema required.

---

# Boundary Rules

Configurable.

Examples:

Boundary = 4

Boundary = 6

Custom values

---

# Ball Event Types

System must support:

Dot

1

2

3

4

5

6

Wide

No Ball

Bye

Leg Bye

Wicket

Dead Ball

Penalty Runs

Undo Last Ball

---

# Quick Scorekeeping Mode

Tracks:

* Runs
* Wickets
* Overs
* Run Rate

No players.

No batting card.

No bowling card.

Example:

Score:
67/3

Overs:
7.2

Run Rate:
9.13

Recent Balls:
1 4 0 W 2 1

---

# Team Scorekeeping Mode

Uses generated teams.

Additional setup:

Select:

* Batting Team
* Bowling Team
* Striker
* Non-Striker
* Bowler

---

# Batter Statistics

Track:

Runs

Balls

4s

6s

Strike Rate

Status

Not Out / Out

Dismissal Type

---

# Bowler Statistics

Track:

Overs

Maidens

Runs

Wickets

Economy

---

# Match Dashboard

Display:

Current Score

Current Overs

Run Rate

Target (if applicable)

Required Run Rate

Current Partnership

Recent Balls

---

# Innings Management

Support:

Single Innings

Two Innings

Practice Mode

Target Chase

---

# Ball Timeline

Every delivery must create an event.

Examples:

Over 1

1
0
4
W
WD
2

Stored permanently.

Used for:

* Undo
* Scorecard
* Analytics

---

# Undo System

Required.

User can undo:

Last Ball

System recalculates:

* Score
* Overs
* Batter stats
* Bowler stats
* Run rate

from timeline.

No manual adjustments.

---

# Database Design

Create new migrations.

Suggested tables:

matches

* id
* session_id
* match_type
* status
* rules_profile
* created_at

---

match_rules

* id
* match_id
* rules_json

---

innings

* id
* match_id
* innings_number
* batting_team
* bowling_team
* score
* wickets
* overs

---

ball_events

* id
* innings_id
* over_number
* ball_number
* event_type
* runs
* extras
* batter_id nullable
* bowler_id nullable
* metadata_json
* created_at

---

player_match_stats

* id
* match_id
* player_id
* batting_stats_json
* bowling_stats_json

---

# API Requirements

Create endpoints for:

POST /api/matches

GET /api/matches/{id}

POST /api/matches/{id}/start

POST /api/matches/{id}/ball

POST /api/matches/{id}/undo

GET /api/matches/{id}/scorecard

GET /api/matches/{id}/timeline

PATCH /api/matches/{id}/rules

POST /api/matches/{id}/innings

---

# Frontend Requirements

Add a new navigation step.

Current:

Players
→ Teams
→ Toss

New:

Players
→ Teams
→ Toss
→ Score

Quick Mode:

Players
→ Score

---

# Mobile First

Scoring UI must be optimized for one-handed usage.

Large buttons:

0
1
2
3
4
6
W

Wide

No Ball

Bye

Leg Bye

Undo

Most actions should be possible in a single tap.

---

# Future Features

Design schema so these can be added later:

* Wagon wheel
* Partnerships
* Match sharing
* Live scoring
* Spectator view
* Tournament mode
* Points table
* Player rankings
* MVP calculation
* Scorecard export
* PDF generation

---

# Implementation Requirements

1. Existing functionality must remain unchanged.
2. Existing sessions must continue working.
3. Existing database migrations must remain untouched.
4. Create new migration files only.
5. Follow existing FastAPI + Supabase architecture.
6. Follow existing CLAUDE.md maintenance rules.
7. Update:

   * CLAUDE.md
   * README.md
   * Database Schema section
   * API Reference section
   * Pydantic Models section

after implementation.

---

# Deliverables

Claude should provide:

1. Database migration plan
2. Updated schema
3. Backend implementation
4. API endpoints
5. Frontend scorekeeping UI
6. Rules engine implementation
7. Undo functionality
8. Documentation updates
9. Backward compatibility verification
10. Testing checklist

Goal: Transform Cricket Team Maker into a complete Cricket Match Manager while preserving all existing functionality.
