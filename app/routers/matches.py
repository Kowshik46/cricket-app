"""
Scorekeeping router.

All score computation is derived from the ball_events timeline — no mutable
score counters are stored. This makes undo trivially correct.
"""
import random
import string
from fastapi import APIRouter, HTTPException
from app.database import supabase_client
from app.models import (
    MatchCreate, MatchOut, MatchRules, RULES_PRESETS,
    InningsCreate, InningsOut, InningsScorecard, MatchScorecard,
    BallEventCreate, BallEventOut, UpdateMatchRulesRequest,
    OverAssignmentCreate, OverAssignmentOut,
    BatterStats, BowlerStats,
)

router = APIRouter()

_WATCH_CODE_CHARS = string.ascii_uppercase + string.digits


def _gen_watch_code() -> str:
    """Generate a unique 6-char alphanumeric watch code."""
    for _ in range(10):
        code = ''.join(random.choices(_WATCH_CODE_CHARS, k=6))
        existing = supabase_client.table("matches").select("id").eq("watch_code", code).execute()
        if not existing.data:
            return code
    return ''.join(random.choices(_WATCH_CODE_CHARS, k=8))  # fallback to 8 chars


# ── helpers ───────────────────────────────────────────────────────────────────

def _default_rules(preset: str) -> dict:
    return dict(RULES_PRESETS.get(preset, RULES_PRESETS["standard"]))


def _compute_scorecard(innings_row: dict, balls: list[dict], over_assignments: list[dict] | None = None) -> InningsScorecard:
    """Derive all scorecard stats from the ball timeline."""
    if over_assignments is None:
        over_assignments = _get_overs(str(innings_row["id"]))

    total_runs = sum(b["runs"] + b["extras"] for b in balls)
    total_wickets = sum(1 for b in balls if b["event_type"] == "wicket")
    legal_balls = sum(1 for b in balls if b["is_legal_ball"])
    overs_complete = legal_balls // 6
    balls_in_over = legal_balls % 6
    total_overs = round(overs_complete + balls_in_over / 10, 1)

    run_rate = round(total_runs / (legal_balls / 6), 2) if legal_balls > 0 else 0.0

    target = innings_row.get("target")
    rrr: float | None = None
    if target is not None:
        runs_needed = target - total_runs
        balls_remaining = (innings_row.get("_overs", 6) * 6) - legal_balls
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
        opening_striker_id=innings_row.get("opening_striker_id"),
        opening_non_striker_id=innings_row.get("opening_non_striker_id"),
    )

    # Batting state + player stats
    state = _derive_batting_state(innings_row, balls, over_assignments)
    player_ids = [str(b["batter_id"]) for b in balls if b.get("batter_id")] + \
                 [str(b["bowler_id"]) for b in balls if b.get("bowler_id")]
    player_names = _get_player_names(player_ids)
    batter_stats = _compute_batter_stats(balls, player_names)
    bowler_stats = _compute_bowler_stats(balls, over_assignments, player_names)

    return InningsScorecard(
        innings=innings_out,
        total_runs=total_runs,
        total_wickets=total_wickets,
        total_overs=total_overs,
        run_rate=run_rate,
        target=target,
        required_run_rate=rrr,
        balls=ball_outs,
        current_striker_id=state["current_striker_id"],
        current_non_striker_id=state["current_non_striker_id"],
        current_bowler_id=state["current_bowler_id"],
        current_over_number=state["current_over_number"],
        batters=batter_stats,
        bowlers=bowler_stats,
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


def _get_overs(innings_id: str) -> list[dict]:
    res = (
        supabase_client.table("innings_overs")
        .select("*")
        .eq("innings_id", innings_id)
        .order("over_number")
        .execute()
    )
    return res.data or []


def _get_player_names(player_ids: list[str]) -> dict[str, str]:
    unique = list({pid for pid in player_ids if pid})
    if not unique:
        return {}
    res = supabase_client.table("players").select("id, name").in_("id", unique).execute()
    return {r["id"]: r["name"] for r in (res.data or [])}


def _derive_batting_state(innings: dict, balls: list[dict], over_assignments: list[dict]) -> dict:
    """
    Walk the ball timeline to derive current striker, non-striker, bowler, and over number.
    Rotation rules:
      - Odd bat/bye/leg_bye runs → swap ends.
      - End of over (6 legal balls) → swap ends, advance bowler.
      - Wicket → incoming batter from next ball's batter_id (applied after all swaps).
    Wides do not cause end-rotation.
    """
    opening_striker = innings.get("opening_striker_id")
    opening_non_striker = innings.get("opening_non_striker_id")
    over_map: dict[int, str | None] = {o["over_number"]: o.get("bowler_id") for o in over_assignments}
    legal_balls = sum(1 for b in balls if b["is_legal_ball"])
    current_over = legal_balls // 6

    if not opening_striker:
        # Quick mode — no batting state tracking
        last_bowler = next((b["bowler_id"] for b in reversed(balls) if b.get("bowler_id")), None)
        return {
            "current_striker_id": None,
            "current_non_striker_id": None,
            "current_bowler_id": last_bowler or over_map.get(current_over),
            "current_over_number": current_over,
        }

    if not balls:
        return {
            "current_striker_id": opening_striker,
            "current_non_striker_id": opening_non_striker,
            "current_bowler_id": over_map.get(0),
            "current_over_number": 0,
        }

    striker: str | None = opening_striker
    non_striker: str | None = opening_non_striker
    legal_count = 0
    current_bowler: str | None = over_map.get(0)

    for i, ball in enumerate(balls):
        event = ball["event_type"]
        is_legal = ball["is_legal_ball"]
        runs = ball["runs"]
        extras = ball.get("extras", 0)
        ball_meta = ball.get("metadata") or {}
        if not isinstance(ball_meta, dict):
            ball_meta = {}

        # Apply new non-striker from metadata (piggybacked after non-striker run-out)
        new_ns = ball_meta.get("new_non_striker_id")
        if new_ns:
            non_striker = str(new_ns)

        # Mid-over bowler change: trust per-ball bowler_id
        if ball.get("bowler_id"):
            current_bowler = ball["bowler_id"]

        # Runs that cause end-rotation
        if event == "wide":
            rot = 0
        elif event in ("bye", "leg_bye"):
            rot = extras
        else:
            rot = runs

        if rot % 2 == 1:
            striker, non_striker = non_striker, striker

        # End of over (6 legal balls) → swap + advance bowler
        if is_legal:
            legal_count += 1
            if legal_count % 6 == 0:
                striker, non_striker = non_striker, striker
                nxt_over = legal_count // 6
                # Always update — None when next over has no assignment yet,
                # which lets the frontend detect it needs a new bowler pick.
                current_bowler = over_map.get(nxt_over)

        # Wicket: determine which end is vacated
        if event == "wicket":
            run_out_end = ball_meta.get("run_out_end")
            dismissed_id = str(ball["batter_id"]) if ball.get("batter_id") else None

            if i + 1 < len(balls):
                nxt = balls[i + 1].get("batter_id")
                if nxt:
                    if run_out_end == "non_striker":
                        # Non-striker was out; striker keeps facing; new non-striker
                        # comes in via next ball's metadata.new_non_striker_id
                        pass  # non_striker updated at top of next iteration
                    elif dismissed_id == str(striker) if striker else False:
                        striker = nxt
                    elif dismissed_id == str(non_striker) if non_striker else False:
                        non_striker = nxt
                    else:
                        striker = nxt  # fallback
            else:
                # Last ball — determine which end is vacated
                if run_out_end == "non_striker":
                    non_striker = None
                elif dismissed_id and non_striker and dismissed_id == str(non_striker):
                    non_striker = None
                else:
                    striker = None

    return {
        "current_striker_id": striker,
        "current_non_striker_id": non_striker,
        "current_bowler_id": current_bowler,
        "current_over_number": current_over,
    }


def _compute_batter_stats(balls: list[dict], player_names: dict[str, str]) -> list[BatterStats]:
    stats: dict[str, dict] = {}
    dismissed: dict[str, str] = {}

    for ball in balls:
        bid = ball.get("batter_id")
        if not bid:
            continue
        bid = str(bid)
        if bid not in stats:
            stats[bid] = {"runs": 0, "balls": 0, "fours": 0, "sixes": 0}

        event = ball["event_type"]
        if event not in ("wide", "bye", "leg_bye"):
            stats[bid]["runs"] += ball["runs"]
        if event != "wide":
            stats[bid]["balls"] += 1
        if ball.get("is_boundary"):
            bt = ball.get("boundary_type")
            if bt == "four":
                stats[bid]["fours"] += 1
            elif bt == "six":
                stats[bid]["sixes"] += 1
        if event == "wicket":
            dismissed[bid] = ball.get("wicket_type") or "out"

    result = []
    for pid, s in stats.items():
        b, r = s["balls"], s["runs"]
        result.append(BatterStats(
            player_id=pid,
            name=player_names.get(pid, "Unknown"),
            runs=r,
            balls=b,
            fours=s["fours"],
            sixes=s["sixes"],
            strike_rate=round(r / b * 100, 1) if b > 0 else 0.0,
            status="out" if pid in dismissed else "batting",
            dismissal=dismissed.get(pid),
        ))
    return result


def _compute_bowler_stats(balls: list[dict], over_assignments: list[dict], player_names: dict[str, str]) -> list[BowlerStats]:
    ball_stats: dict[str, dict] = {}

    for ball in balls:
        bid = ball.get("bowler_id")
        if not bid:
            continue
        bid = str(bid)
        if bid not in ball_stats:
            ball_stats[bid] = {"runs": 0, "legal": 0, "wickets": 0}
        ball_stats[bid]["runs"] += ball["runs"] + ball.get("extras", 0)
        if ball["is_legal_ball"]:
            ball_stats[bid]["legal"] += 1
        if ball["event_type"] == "wicket" and ball.get("wicket_type") != "run_out":
            ball_stats[bid]["wickets"] += 1

    legal_ovs: dict[str, int] = {}
    throw_ovs: dict[str, int] = {}
    for ov in over_assignments:
        bid = ov.get("bowler_id")
        if not bid:
            continue
        bid = str(bid)
        if ov["bowl_type"] == "throw":
            throw_ovs[bid] = throw_ovs.get(bid, 0) + 1
        else:
            legal_ovs[bid] = legal_ovs.get(bid, 0) + 1

    all_ids = set(ball_stats) | set(legal_ovs) | set(throw_ovs)
    result = []
    for pid in all_ids:
        s = ball_stats.get(pid, {"runs": 0, "legal": 0, "wickets": 0})
        legal = s["legal"]
        overs_done = legal // 6
        balls_cur = legal % 6
        runs = s["runs"]
        econ = round(runs / (legal / 6), 2) if legal > 0 else 0.0
        l_ovs = legal_ovs.get(pid, 0)
        t_ovs = throw_ovs.get(pid, 0)
        result.append(BowlerStats(
            player_id=pid,
            name=player_names.get(pid, "Unknown"),
            overs=overs_done,
            balls_legal=balls_cur,
            runs_conceded=runs,
            wickets=s["wickets"],
            economy=econ,
            bowl_type="throw" if t_ovs > l_ovs else "legal",
            legal_overs=l_ovs,
            throw_overs=t_ovs,
        ))
    return result


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
        "watch_code": _gen_watch_code(),
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

    row_data: dict = {
        "match_id": match_id,
        "innings_number": innings_number,
        "batting_team": body.batting_team,
        "bowling_team": body.bowling_team,
        "status": "live",
    }
    if body.opening_striker_id:
        row_data["opening_striker_id"] = body.opening_striker_id
    if body.opening_non_striker_id:
        row_data["opening_non_striker_id"] = body.opening_non_striker_id

    res = supabase_client.table("innings").insert(row_data).execute()

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
        watch_code=match.get("watch_code"),
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


# ── Over assignments ─────────────────────────────────────────────────────────

@router.post("/{match_id}/innings/{innings_id}/overs", response_model=OverAssignmentOut, status_code=201)
async def assign_over(match_id: str, innings_id: str, body: OverAssignmentCreate):
    """Assign a bowler + bowl type to the next over. Validates consecutive-over ban and caps."""
    _get_match_or_404(match_id)
    innings = _get_innings_or_404(innings_id)

    if innings["status"] == "completed":
        raise HTTPException(400, "This innings is already completed")

    rules = _get_rules(match_id)
    balls = _get_balls(innings_id)
    legal_balls = sum(1 for b in balls if b["is_legal_ball"])
    next_over = legal_balls // 6

    existing_overs = (
        supabase_client.table("innings_overs")
        .select("*")
        .eq("innings_id", innings_id)
        .order("over_number")
        .execute()
    ).data or []

    if any(o["over_number"] == next_over for o in existing_overs):
        raise HTTPException(400, f"Over {next_over} already assigned")

    # Consecutive-over ban (strict — no override)
    if next_over > 0:
        prev = next((o for o in reversed(existing_overs) if o["over_number"] == next_over - 1), None)
        if prev and prev.get("bowler_id") == body.bowler_id:
            raise HTTPException(400, "Cannot bowl consecutive overs")

    # Max overs per bowler cap
    max_overs = rules.get("max_overs_per_bowler")
    if max_overs is not None:
        bowled = sum(1 for o in existing_overs if o.get("bowler_id") == body.bowler_id)
        if bowled + 1 > max_overs:
            raise HTTPException(400, f"Bowler has reached the cap of {max_overs} overs")

    # Max throw overs per team cap
    if body.bowl_type == "throw":
        max_throw = rules.get("max_throw_overs_per_team")
        if max_throw is not None:
            team_throws = sum(1 for o in existing_overs if o.get("bowl_type") == "throw")
            if team_throws + 1 > max_throw:
                raise HTTPException(400, f"Team has reached the cap of {max_throw} throw overs")

    res = supabase_client.table("innings_overs").insert({
        "innings_id": innings_id,
        "over_number": next_over,
        "bowler_id": body.bowler_id,
        "bowl_type": body.bowl_type,
    }).execute()

    if not res.data:
        raise HTTPException(500, "Failed to assign over")
    return res.data[0]


@router.get("/{match_id}/innings/{innings_id}/overs", response_model=list[OverAssignmentOut])
async def list_overs(match_id: str, innings_id: str):
    """List all over assignments for an innings."""
    _get_match_or_404(match_id)
    _get_innings_or_404(innings_id)
    res = (
        supabase_client.table("innings_overs")
        .select("*")
        .eq("innings_id", innings_id)
        .order("over_number")
        .execute()
    )
    return res.data or []


# ── Eligible helpers (for over-change and new-batter modals) ─────────────────

@router.get("/{match_id}/innings/{innings_id}/eligible_bowlers")
async def eligible_bowlers(match_id: str, innings_id: str):
    """
    Returns bowling-team players eligible for the next over.
    Each entry includes overs bowled, throw split, and why they may be blocked.
    """
    match = _get_match_or_404(match_id)
    innings = _get_innings_or_404(innings_id)
    rules = _get_rules(match_id)
    session_id = match.get("session_id")

    if not session_id:
        return {"bowlers": []}

    balls = _get_balls(innings_id)
    overs = _get_overs(innings_id)

    legal_balls = sum(1 for b in balls if b["is_legal_ball"])
    current_over = legal_balls // 6

    # Previous over's bowler (for consecutive ban)
    prev_bowler_id: str | None = None
    if current_over > 0:
        prev = next((o for o in reversed(overs) if o["over_number"] == current_over - 1), None)
        if prev:
            prev_bowler_id = str(prev["bowler_id"]) if prev.get("bowler_id") else None

    # All bowling team players are eligible to bowl regardless of can_bowl flag
    assignments = (
        supabase_client.table("team_assignments")
        .select("players(id, name, can_bowl, bowl_type)")
        .eq("session_id", session_id)
        .eq("team_name", innings["bowling_team"])
        .execute()
    ).data or []
    bowlers = [a["players"] for a in assignments if a.get("players")]

    # Per-bowler overs from innings_overs
    overs_per: dict[str, int] = {}
    throw_per: dict[str, int] = {}
    for ov in overs:
        bid = str(ov["bowler_id"]) if ov.get("bowler_id") else None
        if not bid:
            continue
        overs_per[bid] = overs_per.get(bid, 0) + 1
        if ov["bowl_type"] == "throw":
            throw_per[bid] = throw_per.get(bid, 0) + 1

    team_throw_total = sum(1 for o in overs if o.get("bowl_type") == "throw")
    max_overs = rules.get("max_overs_per_bowler")
    max_throw = rules.get("max_throw_overs_per_team")

    result = []
    for p in bowlers:
        pid = str(p["id"])
        bowled = overs_per.get(pid, 0)
        throws = throw_per.get(pid, 0)

        reason_blocked: str | None = None
        if pid == prev_bowler_id:
            reason_blocked = "consecutive"
        elif max_overs is not None and bowled >= max_overs:
            reason_blocked = "overs_cap"

        can_throw = (
            reason_blocked is None
            and not (max_throw is not None and team_throw_total >= max_throw)
        )

        result.append({
            "id": pid,
            "name": p["name"],
            "overs_bowled": bowled,
            "throw_overs_bowled": throws,
            "bowl_type": p.get("bowl_type", "legal"),
            "can_legal": reason_blocked is None,
            "can_throw": can_throw,
            "reason_blocked": reason_blocked,
        })

    return {"bowlers": result}


@router.get("/{match_id}/innings/{innings_id}/eligible_batters")
async def eligible_batters(match_id: str, innings_id: str):
    """
    Returns batting-team players who haven't been dismissed and aren't currently at the crease.
    Drives the new-batter modal shown after a wicket.
    """
    match = _get_match_or_404(match_id)
    innings = _get_innings_or_404(innings_id)
    session_id = match.get("session_id")

    if not session_id:
        return {"batters": []}

    assignments = (
        supabase_client.table("team_assignments")
        .select("players(id, name)")
        .eq("session_id", session_id)
        .eq("team_name", innings["batting_team"])
        .execute()
    ).data or []
    all_batters = {str(a["players"]["id"]): a["players"]["name"] for a in assignments if a.get("players")}

    balls = _get_balls(innings_id)
    overs = _get_overs(innings_id)
    state = _derive_batting_state(innings, balls, overs)

    dismissed = {
        str(b["batter_id"])
        for b in balls
        if b["event_type"] == "wicket" and b.get("batter_id")
    }
    # If the last ball is a wicket with no batter_id, infer dismissed from previous state
    if balls and balls[-1]["event_type"] == "wicket" and not balls[-1].get("batter_id"):
        prev = _derive_batting_state(innings, balls[:-1], over_assignments)
        if state["current_striker_id"] is None and prev.get("current_striker_id"):
            dismissed.add(str(prev["current_striker_id"]))
        if state["current_non_striker_id"] is None and prev.get("current_non_striker_id"):
            dismissed.add(str(prev["current_non_striker_id"]))
    at_crease = {
        str(state["current_striker_id"]) if state["current_striker_id"] else None,
        str(state["current_non_striker_id"]) if state["current_non_striker_id"] else None,
    } - {None}

    eligible = [
        {"id": pid, "name": name}
        for pid, name in all_batters.items()
        if pid not in dismissed and pid not in at_crease
    ]

    return {"batters": eligible}


@router.delete("/{match_id}", status_code=204)
async def delete_match(match_id: str):
    supabase_client.table("matches").delete().eq("id", match_id).execute()
