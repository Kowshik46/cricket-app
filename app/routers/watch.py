"""
Public read-only spectator API — no auth required.
Spectators fetch /api/watch/{code} to follow a live match.
"""
from fastapi import APIRouter, HTTPException
from app.database import supabase_client
from app.models import MatchOut, MatchScorecard
from app.routers.matches import (
    _get_rules,
    _get_balls,
    _get_overs,
    _compute_scorecard,
    _get_player_names,
)

router = APIRouter()


def _get_match_by_code(code: str) -> dict:
    res = (
        supabase_client.table("matches")
        .select("*")
        .eq("watch_code", code.upper())
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Match not found — check the code and try again")
    return res.data[0]


@router.get("/{code}")
async def watch_match(code: str):
    """Return the full live scorecard for a match identified by its watch code."""
    match = _get_match_by_code(code)
    match_id = str(match["id"])
    rules = _get_rules(match_id)

    match_name = None
    if match.get("session_id"):
        sess = (
            supabase_client.table("sessions")
            .select("name")
            .eq("id", match["session_id"])
            .execute()
        )
        if sess.data:
            match_name = sess.data[0]["name"]

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
        overs = _get_overs(inn["id"])
        innings_scorecards.append(_compute_scorecard(inn, balls, overs))

    # Fetch names for at-crease players who may not have faced a ball yet
    # (e.g. opening non-striker before their first delivery)
    extra_ids = []
    for sc in innings_scorecards:
        for pid in [sc.current_striker_id, sc.current_non_striker_id, sc.current_bowler_id]:
            if pid:
                extra_ids.append(str(pid))
    player_names = _get_player_names(extra_ids) if extra_ids else {}

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

    return {
        "watch_code": match.get("watch_code"),
        "match_name": match_name or f"{match['overs']}-over match",
        "player_names": player_names,
        "scorecard": MatchScorecard(match=match_out, rules=rules, innings_list=innings_scorecards),
    }
