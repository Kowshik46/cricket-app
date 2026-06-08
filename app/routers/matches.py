"""
Scorekeeping router.

All score computation is derived from the ball_events timeline — no mutable
score counters are stored. This makes undo trivially correct.
"""
from fastapi import APIRouter, HTTPException
from app.database import supabase_client
from app.models import (
    MatchCreate, MatchOut, MatchRules, RULES_PRESETS,
    InningsCreate, InningsOut, InningsScorecard, MatchScorecard,
    BallEventCreate, BallEventOut, UpdateMatchRulesRequest,
)

router = APIRouter()


# ── helpers ───────────────────────────────────────────────────────────────────

def _default_rules(preset: str) -> dict:
    return dict(RULES_PRESETS.get(preset, RULES_PRESETS["standard"]))


def _compute_scorecard(innings_row: dict, balls: list[dict]) -> InningsScorecard:
    """Derive all scorecard stats from the ball timeline."""
    total_runs = sum(b["runs"] + b["extras"] for b in balls)
    total_wickets = sum(1 for b in balls if b["event_type"] == "wicket")
    legal_balls = sum(1 for b in balls if b["is_legal_ball"])
    overs_complete = legal_balls // 6
    balls_in_over = legal_balls % 6
    total_overs = round(overs_complete + balls_in_over / 10, 1)

    total_legal_balls = legal_balls
    run_rate = round(total_runs / (total_legal_balls / 6), 2) if total_legal_balls > 0 else 0.0

    target = innings_row.get("target")
    rrr: float | None = None
    if target is not None:
        runs_needed = target - total_runs
        balls_remaining = (innings_row.get("_overs", 6) * 6) - total_legal_balls
        if balls_remaining > 0 and runs_needed > 0:
            rrr = round(runs_needed / (balls_remaining / 6), 2)
        else:
            rrr = 0.0

    ball_outs = [_ball_to_out(b) for b in balls]

    innings_out = InningsOut(
        id=innings_row["id"],
        match_id=innings_row["match_id"],
        innings_number=innings_row["innings_number"],
        batting_team=innings_row["batting_team"],
        bowling_team=innings_row["bowling_team"],
        target=target,
        status=innings_row["status"],
        created_at=innings_row["created_at"],
    )

    return InningsScorecard(
        innings=innings_out,
        total_runs=total_runs,
        total_wickets=total_wickets,
        total_overs=total_overs,
        run_rate=run_rate,
        target=target,
        required_run_rate=rrr,
        balls=ball_outs,
    )


def _ball_to_out(b: dict) -> BallEventOut:
    return BallEventOut(
        id=b["id"],
        innings_id=b["innings_id"],
        over_number=b["over_number"],
        ball_number=b["ball_number"],
        event_type=b["event_type"],
        runs=b["runs"],
        extras=b["extras"],
        extra_type=b.get("extra_type"),
        is_legal_ball=b["is_legal_ball"],
        is_boundary=b.get("is_boundary", False),
        boundary_type=b.get("boundary_type"),
        wicket_type=b.get("wicket_type"),
        batter_id=b.get("batter_id"),
        bowler_id=b.get("bowler_id"),
        metadata=b.get("metadata") or {},
        created_at=b["created_at"],
    )


def _next_ball_position(balls: list[dict], rules: dict) -> tuple[int, int]:
    """Return (over_number, ball_number) for the next delivery.

    Illegal balls (wide/no-ball) share the same over_number as the over
    they are bowled in. over_number advances only when a legal ball is
    the 6th in its over (i.e. legal_count crosses a multiple of 6).
    ball_number is the 0-indexed position within the over for legal balls;
    for illegal balls it matches the *current* ball-in-over slot so they
    visually sit inside the correct over in the breakdown.
    """
    legal_count = sum(1 for b in balls if b["is_legal_ball"])
    over_num = legal_count // 6
    ball_num = legal_count % 6
    return over_num, ball_num


def _is_legal(event_type: str, rules: dict) -> bool:
    if event_type == "wide":
        return bool(rules.get("wide_counts_as_ball", False))
    if event_type == "no_ball":
        return bool(rules.get("no_ball_counts_as_ball", False))
    if event_type == "dead_ball":
        return False
    return True


def _extras_for(event_type: str, runs: int, rules: dict) -> int:
    """Return the extras value for this event (credited to total but not batter)."""
    if event_type == "wide":
        return rules.get("wide_runs", 1)
    if event_type == "no_ball":
        return rules.get("no_ball_runs", 1)
    if event_type in ("bye", "leg_bye"):
        return runs  # all runs are extras
    return 0


def _runs_for(event_type: str, runs: int) -> int:
    """Return the runs credited to the batting score (separate from extras)."""
    if event_type in ("wide", "bye", "leg_bye"):
        return 0
    return runs


def _get_rules(match_id: str) -> dict:
    res = supabase_client.table("match_rules").select("rules_json").eq("match_id", match_id).execute()
    if res.data:
        return res.data[0]["rules_json"]
    return _default_rules("standard")


def _get_match_or_404(match_id: str) -> dict:
    res = supabase_client.table("matches").select("*").eq("id", match_id).execute()
    if not res.data:
        raise HTTPException(404, "Match not found")
    return res.data[0]


def _get_innings_or_404(innings_id: str) -> dict:
    res = supabase_client.table("innings").select("*").eq("id", innings_id).execute()
    if not res.data:
        raise HTTPException(404, "Innings not found")
    return res.data[0]


def _get_balls(innings_id: str) -> list[dict]:
    res = (
        supabase_client.table("ball_events")
        .select("*")
        .eq("innings_id", innings_id)
        .order("created_at", desc=False)
        .execute()
    )
    return res.data or []


# ── Match CRUD ────────────────────────────────────────────────────────────────

@router.post("", response_model=MatchOut, status_code=201)
async def create_match(body: MatchCreate):
    preset = body.rules_preset if body.rules_preset != "custom" else "standard"
    rules = _default_rules(preset)
    if body.rules:
        rules.update(body.rules.model_dump(exclude_none=True))

    row = {
        "match_type": body.match_type,
        "status": "setup",
        "overs": body.overs,
        "players_per_side": body.players_per_side,
        "rules_preset": body.rules_preset,
    }
    if body.session_id:
        row["session_id"] = body.session_id

    res = supabase_client.table("matches").insert(row).execute()
    if not res.data:
        raise HTTPException(500, "Failed to create match")
    match = res.data[0]

    supabase_client.table("match_rules").insert({
        "match_id": match["id"],
        "rules_json": rules,
    }).execute()

    return match


@router.get("", response_model=list[MatchOut])
async def list_matches(session_id: str | None = None):
    q = supabase_client.table("matches").select("*").order("created_at", desc=True).limit(50)
    if session_id:
        q = q.eq("session_id", session_id)
    return q.execute().data or []


@router.get("/{match_id}", response_model=MatchOut)
async def get_match(match_id: str):
    return _get_match_or_404(match_id)


@router.patch("/{match_id}/rules", response_model=dict)
async def update_rules(match_id: str, body: UpdateMatchRulesRequest):
    _get_match_or_404(match_id)
    rules = body.rules.model_dump()
    supabase_client.table("match_rules").upsert({
        "match_id": match_id,
        "rules_json": rules,
        "updated_at": "now()",
    }, on_conflict="match_id").execute()
    return {"ok": True, "rules": rules}


@router.get("/{match_id}/rules", response_model=dict)
async def get_rules(match_id: str):
    _get_match_or_404(match_id)
    return _get_rules(match_id)


# ── Innings ───────────────────────────────────────────────────────────────────

@router.post("/{match_id}/innings", response_model=InningsOut, status_code=201)
async def create_innings(match_id: str, body: InningsCreate):
    match = _get_match_or_404(match_id)

    existing = (
        supabase_client.table("innings")
        .select("innings_number")
        .eq("match_id", match_id)
        .execute()
    )
    existing_numbers = [r["innings_number"] for r in (existing.data or [])]

    if 1 not in existing_numbers:
        innings_number = 1
    elif 2 not in existing_numbers:
        innings_number = 2
    else:
        raise HTTPException(400, "Both innings already created for this match")

    # Update match status to live when first innings starts
    if match["status"] == "setup":
        supabase_client.table("matches").update({"status": "live"}).eq("id", match_id).execute()

    res = supabase_client.table("innings").insert({
        "match_id": match_id,
        "innings_number": innings_number,
        "batting_team": body.batting_team,
        "bowling_team": body.bowling_team,
        "status": "live",
    }).execute()

    if not res.data:
        raise HTTPException(500, "Failed to create innings")
    return res.data[0]


@router.get("/{match_id}/innings", response_model=list[InningsOut])
async def list_innings(match_id: str):
    _get_match_or_404(match_id)
    res = (
        supabase_client.table("innings")
        .select("*")
        .eq("match_id", match_id)
        .order("innings_number")
        .execute()
    )
    return res.data or []


@router.post("/{match_id}/innings/{innings_id}/complete", response_model=InningsOut)
async def complete_innings(match_id: str, innings_id: str):
    """Mark innings as completed. For 2-innings matches, sets the target on innings 2."""
    _get_match_or_404(match_id)
    innings = _get_innings_or_404(innings_id)

    if innings["innings_number"] == 1:
        balls = _get_balls(innings_id)
        sc = _compute_scorecard(innings, balls)
        target = sc.total_runs + 1

        # Update innings 2 target if it exists
        inn2 = (
            supabase_client.table("innings")
            .select("id")
            .eq("match_id", match_id)
            .eq("innings_number", 2)
            .execute()
        )
        if inn2.data:
            supabase_client.table("innings").update({"target": target}).eq("id", inn2.data[0]["id"]).execute()

        supabase_client.table("matches").update({"status": "innings_break"}).eq("id", match_id).execute()

    res = (
        supabase_client.table("innings")
        .update({"status": "completed"})
        .eq("id", innings_id)
        .execute()
    )
    return res.data[0]


# ── Ball events ───────────────────────────────────────────────────────────────

@router.post("/{match_id}/innings/{innings_id}/ball", response_model=InningsScorecard)
async def record_ball(match_id: str, innings_id: str, body: BallEventCreate):
    _get_match_or_404(match_id)
    innings = _get_innings_or_404(innings_id)

    if innings["status"] == "completed":
        raise HTTPException(400, "This innings is already completed")

    rules = _get_rules(match_id)
    balls = _get_balls(innings_id)

    over_num, ball_num = _next_ball_position(balls, rules)
    is_legal = _is_legal(body.event_type, rules)
    extras = _extras_for(body.event_type, body.runs, rules)
    scored_runs = _runs_for(body.event_type, body.runs)

    row = {
        "innings_id": innings_id,
        "over_number": over_num,
        "ball_number": ball_num,
        "event_type": body.event_type,
        "runs": scored_runs,
        "extras": extras,
        "extra_type": body.extra_type,
        "is_legal_ball": is_legal,
        "is_boundary": body.is_boundary,
        "boundary_type": body.boundary_type,
        "wicket_type": body.wicket_type,
        "metadata": body.metadata,
    }
    if body.batter_id:
        row["batter_id"] = body.batter_id
    if body.bowler_id:
        row["bowler_id"] = body.bowler_id

    supabase_client.table("ball_events").insert(row).execute()

    # Re-fetch for up-to-date scorecard
    updated_balls = _get_balls(innings_id)
    innings["_overs"] = _get_match_or_404(match_id)["overs"]
    return _compute_scorecard(innings, updated_balls)


@router.post("/{match_id}/innings/{innings_id}/undo", response_model=InningsScorecard)
async def undo_last_ball(match_id: str, innings_id: str):
    """Delete the most recent ball event and return the updated scorecard."""
    _get_match_or_404(match_id)
    innings = _get_innings_or_404(innings_id)

    balls = _get_balls(innings_id)
    if not balls:
        raise HTTPException(400, "No balls to undo")

    last_ball_id = balls[-1]["id"]
    supabase_client.table("ball_events").delete().eq("id", last_ball_id).execute()

    updated_balls = _get_balls(innings_id)
    innings["_overs"] = _get_match_or_404(match_id)["overs"]
    return _compute_scorecard(innings, updated_balls)


# ── Scorecard ─────────────────────────────────────────────────────────────────

@router.get("/{match_id}/scorecard", response_model=MatchScorecard)
async def get_scorecard(match_id: str):
    match = _get_match_or_404(match_id)
    rules = _get_rules(match_id)

    innings_rows = (
        supabase_client.table("innings")
        .select("*")
        .eq("match_id", match_id)
        .order("innings_number")
        .execute()
    ).data or []

    innings_scorecards = []
    for inn in innings_rows:
        inn["_overs"] = match["overs"]
        balls = _get_balls(inn["id"])
        innings_scorecards.append(_compute_scorecard(inn, balls))

    match_out = MatchOut(
        id=match["id"],
        session_id=match.get("session_id"),
        match_type=match["match_type"],
        status=match["status"],
        overs=match["overs"],
        players_per_side=match["players_per_side"],
        rules_preset=match["rules_preset"],
        created_at=match["created_at"],
    )

    return MatchScorecard(match=match_out, rules=rules, innings_list=innings_scorecards)


@router.get("/{match_id}/innings/{innings_id}/scorecard", response_model=InningsScorecard)
async def get_innings_scorecard(match_id: str, innings_id: str):
    match = _get_match_or_404(match_id)
    innings = _get_innings_or_404(innings_id)
    innings["_overs"] = match["overs"]
    balls = _get_balls(innings_id)
    return _compute_scorecard(innings, balls)


@router.get("/{match_id}/innings/{innings_id}/timeline", response_model=list[BallEventOut])
async def get_timeline(match_id: str, innings_id: str):
    _get_match_or_404(match_id)
    _get_innings_or_404(innings_id)
    balls = _get_balls(innings_id)
    return [_ball_to_out(b) for b in balls]


@router.delete("/{match_id}", status_code=204)
async def delete_match(match_id: str):
    supabase_client.table("matches").delete().eq("id", match_id).execute()
