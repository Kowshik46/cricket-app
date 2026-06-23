import os
import httpx
from fastapi import APIRouter, HTTPException, Header
from typing import Optional
from collections import defaultdict

from app.database import supabase_client
from app.models import (
    MatchHistoryItem, MatchPlayerItem, TossHistorySummary,
    PlayerStatsItem,
    UpdateDisplayNameRequest,
    InningsSummaryItem, MatchSummaryItem,
)

router = APIRouter()

_SUPABASE_URL = os.environ["SUPABASE_URL"]
_SUPABASE_SECRET_KEY = os.environ["SUPABASE_SECRET_KEY"]



def _verify_jwt(authorization: Optional[str]) -> object:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing or invalid Authorization header")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        resp = supabase_client.auth.get_user(token)
        if not resp or not resp.user:
            raise HTTPException(401, "Invalid or expired token")
        return resp.user
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(401, "Invalid or expired token")


@router.get("/history", response_model=list[MatchHistoryItem])
async def get_history(authorization: Optional[str] = Header(default=None)):
    user = _verify_jwt(authorization)

    sessions_res = (
        supabase_client.table("sessions")
        .select("id, name, created_at")
        .eq("owner_id", str(user.id))
        .order("created_at", desc=True)
        .limit(100)
        .execute()
    )
    sessions = sessions_res.data or []
    if not sessions:
        return []

    session_ids = [s["id"] for s in sessions]

    assignments_res = (
        supabase_client.table("team_assignments")
        .select("session_id, team_name, team_a_name, team_b_name, is_captain, players(name, skill, can_bowl)")
        .in_("session_id", session_ids)
        .execute()
    )
    assignments_by_session: dict[str, list] = defaultdict(list)
    for row in (assignments_res.data or []):
        assignments_by_session[row["session_id"]].append(row)

    toss_res = (
        supabase_client.table("toss_history")
        .select("session_id, result, tossed_at")
        .in_("session_id", session_ids)
        .order("tossed_at", desc=False)
        .execute()
    )
    toss_by_session: dict[str, list] = defaultdict(list)
    for row in (toss_res.data or []):
        toss_by_session[row["session_id"]].append(row)

    # Fetch matches for these sessions
    matches_res = (
        supabase_client.table("matches")
        .select("id, session_id, name, status, overs, created_at")
        .in_("session_id", session_ids)
        .order("created_at", desc=False)
        .execute()
    )
    all_matches = matches_res.data or []
    match_ids = [m["id"] for m in all_matches]
    matches_by_session: dict[str, list] = defaultdict(list)
    for m in all_matches:
        matches_by_session[str(m["session_id"])].append(m)

    # Fetch innings for those matches
    all_innings: list[dict] = []
    innings_by_match: dict[str, list] = defaultdict(list)
    if match_ids:
        innings_res = (
            supabase_client.table("innings")
            .select("id, match_id, innings_number, batting_team, bowling_team, status")
            .in_("match_id", match_ids)
            .order("innings_number", desc=False)
            .execute()
        )
        all_innings = innings_res.data or []
        for inn in all_innings:
            innings_by_match[str(inn["match_id"])].append(inn)

    # Fetch ball events (lightweight columns only) for score aggregation
    innings_ids = [inn["id"] for inn in all_innings]
    balls_by_innings: dict[str, list] = defaultdict(list)
    if innings_ids:
        balls_res = (
            supabase_client.table("ball_events")
            .select("innings_id, runs, extras, is_legal_ball, event_type")
            .in_("innings_id", innings_ids)
            .execute()
        )
        for b in (balls_res.data or []):
            balls_by_innings[str(b["innings_id"])].append(b)

    result = []
    for s in sessions:
        sid = s["id"]
        rows = assignments_by_session.get(sid, [])

        team_a_name = None
        team_b_name = None
        if rows:
            first = rows[0]
            team_a_name = first.get("team_a_name")
            team_b_name = first.get("team_b_name")
            if not team_a_name or not team_b_name:
                names = list(dict.fromkeys(r["team_name"] for r in rows))
                team_a_name = names[0] if names else None
                team_b_name = names[1] if len(names) > 1 else None

        players = [
            MatchPlayerItem(
                name=r["players"]["name"],
                skill=r["players"]["skill"],
                can_bowl=r["players"].get("can_bowl", False),
                team_name=r["team_name"],
                is_captain=r["is_captain"],
            )
            for r in rows
        ]

        tosses = [
            TossHistorySummary(result=t["result"], tossed_at=t["tossed_at"])
            for t in toss_by_session.get(sid, [])
        ]

        match_summaries: list[MatchSummaryItem] = []
        for m in matches_by_session.get(sid, []):
            innings_summaries: list[InningsSummaryItem] = []
            for inn in innings_by_match.get(str(m["id"]), []):
                balls = balls_by_innings.get(str(inn["id"]), [])
                total_runs = sum(b["runs"] + b["extras"] for b in balls)
                total_wickets = sum(1 for b in balls if b["event_type"] == "wicket")
                legal_balls = sum(1 for b in balls if b["is_legal_ball"])
                overs_str = f"{legal_balls // 6}.{legal_balls % 6}"
                innings_summaries.append(InningsSummaryItem(
                    innings_number=inn["innings_number"],
                    batting_team=inn["batting_team"],
                    bowling_team=inn["bowling_team"],
                    runs=total_runs,
                    wickets=total_wickets,
                    overs_str=overs_str,
                    status=inn["status"],
                ))
            match_summaries.append(MatchSummaryItem(
                id=m["id"],
                name=m.get("name") or None,
                status=m["status"],
                created_at=m["created_at"],
                innings_list=innings_summaries,
            ))

        result.append(MatchHistoryItem(
            id=sid,
            name=s["name"],
            created_at=s["created_at"],
            team_a_name=team_a_name,
            team_b_name=team_b_name,
            players=players,
            toss_history=tosses,
            matches=match_summaries,
        ))

    return result


@router.get("/stats", response_model=list[PlayerStatsItem])
async def get_stats(authorization: Optional[str] = Header(default=None)):
    user = _verify_jwt(authorization)

    sessions_res = (
        supabase_client.table("sessions")
        .select("id")
        .eq("owner_id", str(user.id))
        .execute()
    )
    session_ids = [s["id"] for s in (sessions_res.data or [])]
    if not session_ids:
        return []

    assignments_res = (
        supabase_client.table("team_assignments")
        .select("is_captain, players(name, can_bowl)")
        .in_("session_id", session_ids)
        .execute()
    )

    stats: dict[str, dict] = {}
    seen: dict[str, set] = {}  # name → set of session_ids already counted

    sessions_by_assignment_res = (
        supabase_client.table("team_assignments")
        .select("session_id, is_captain, players(name, can_bowl)")
        .in_("session_id", session_ids)
        .execute()
    )

    counts: dict[str, dict] = defaultdict(lambda: {"games": 0, "as_captain": 0, "as_bowler": 0, "_sessions": set()})
    for row in (sessions_by_assignment_res.data or []):
        p = row["players"]
        name = p["name"]
        sid = row["session_id"]
        entry = counts[name]
        if sid not in entry["_sessions"]:
            entry["_sessions"].add(sid)
            entry["games"] += 1
            if p.get("can_bowl"):
                entry["as_bowler"] += 1
        if row["is_captain"]:
            entry["as_captain"] += 1

    return [
        PlayerStatsItem(
            name=name,
            games=v["games"],
            as_captain=v["as_captain"],
            as_bowler=v["as_bowler"],
        )
        for name, v in sorted(counts.items(), key=lambda x: -x[1]["games"])
    ]


@router.patch("/display_name")
async def update_display_name(
    body: UpdateDisplayNameRequest,
    authorization: Optional[str] = Header(default=None),
):
    user = _verify_jwt(authorization)
    try:
        supabase_client.table("user_profiles").upsert(
            {"id": str(user.id), "display_name": body.display_name},
            on_conflict="id",
        ).execute()
    except Exception as e:
        raise HTTPException(500, f"Failed to update display name: {e}")
    return {"display_name": body.display_name}


@router.get("/display_name")
async def get_display_name(authorization: Optional[str] = Header(default=None)):
    user = _verify_jwt(authorization)
    res = (
        supabase_client.table("user_profiles")
        .select("display_name")
        .eq("id", str(user.id))
        .limit(1)
        .execute()
    )
    name = res.data[0]["display_name"] if res.data else ""
    return {"display_name": name}



@router.delete("")
async def delete_account(authorization: Optional[str] = Header(default=None)):
    user = _verify_jwt(authorization)
    try:
        supabase_client.table("sessions").delete().eq("owner_id", str(user.id)).execute()
    except Exception as e:
        raise HTTPException(500, f"Failed to delete sessions: {e}")

    url = f"{_SUPABASE_URL}/auth/v1/admin/users/{user.id}"
    headers = {
        "apikey": _SUPABASE_SECRET_KEY,
        "Authorization": f"Bearer {_SUPABASE_SECRET_KEY}",
    }
    async with httpx.AsyncClient() as client:
        r = await client.delete(url, headers=headers, timeout=10)
    if r.status_code not in (200, 204):
        detail = r.json().get("message") or r.text
        raise HTTPException(r.status_code, f"Failed to delete auth account: {detail}")

    return {"message": "Account deleted."}
