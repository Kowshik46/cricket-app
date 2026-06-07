import random
from fastapi import APIRouter, HTTPException
from app.models import TeamGenerateRequest, TeamsOut, TeamAssignmentOut, AddToTeamRequest
from app.database import supabase_client

router = APIRouter()

SKILL_WEIGHT = {"expert": 3, "intermediate": 2, "beginner": 1}


def _tier_shuffle(players: list[dict]) -> list[dict]:
    tiers: dict[str, list] = {"expert": [], "intermediate": [], "beginner": []}
    for p in players:
        tiers[p["skill"]].append(p)
    for t in tiers.values():
        random.shuffle(t)
    return tiers["expert"] + tiers["intermediate"] + tiers["beginner"]


def _split_balanced(players: list[dict]) -> tuple[list[dict], list[dict]]:
    """
    Split players into two teams balancing both skill and bowling.

    Strategy:
    1. Separate bowlers from non-bowlers.
    2. Snake-draft bowlers by skill weight into team_a / team_b.
    3. Snake-draft non-bowlers by skill weight into team_a / team_b.
    4. Tier-shuffle within each team for variety.
    """
    bowlers     = [p for p in players if p.get("can_bowl")]
    non_bowlers = [p for p in players if not p.get("can_bowl")]

    bowlers.sort(key=lambda p: SKILL_WEIGHT[p["skill"]], reverse=True)
    non_bowlers.sort(key=lambda p: SKILL_WEIGHT[p["skill"]], reverse=True)

    team_a_raw, team_b_raw = [], []
    for i, p in enumerate(bowlers):
        (team_a_raw if i % 2 == 0 else team_b_raw).append(p)
    for i, p in enumerate(non_bowlers):
        (team_a_raw if i % 2 == 0 else team_b_raw).append(p)

    return _tier_shuffle(team_a_raw), _tier_shuffle(team_b_raw)


def _build_assignment_out(p: dict, team_name: str, is_captain: bool) -> TeamAssignmentOut:
    return TeamAssignmentOut(
        player_id=p["id"],
        player_name=p["name"],
        skill=p["skill"],
        can_bowl=p.get("can_bowl", False),
        team_name=team_name,
        is_captain=is_captain,
    )


@router.post("/{session_id}/teams/generate", response_model=TeamsOut)
async def generate_teams(session_id: str, body: TeamGenerateRequest):
    players_res = (
        supabase_client.table("players")
        .select("*")
        .eq("session_id", session_id)
        .execute()
    )
    players = players_res.data or []
    if len(players) < 2:
        raise HTTPException(400, "Need at least 2 players to generate teams")

    team_a, team_b = _split_balanced(players)

    cap_a = random.choice(team_a)
    cap_b = random.choice(team_b)

    assignments = []
    for p in team_a:
        assignments.append({
            "player_id": p["id"],
            "team_name": body.team_a_name,
            "team_a_name": body.team_a_name,
            "team_b_name": body.team_b_name,
            "is_captain": p["id"] == cap_a["id"],
        })
    for p in team_b:
        assignments.append({
            "player_id": p["id"],
            "team_name": body.team_b_name,
            "team_a_name": body.team_a_name,
            "team_b_name": body.team_b_name,
            "is_captain": p["id"] == cap_b["id"],
        })

    supabase_client.table("team_assignments").delete().eq("session_id", session_id).execute()
    rows = [{"session_id": session_id, **a} for a in assignments]
    supabase_client.table("team_assignments").insert(rows).execute()

    player_map = {p["id"]: p for p in players}
    result = [
        _build_assignment_out(player_map[a["player_id"]], a["team_name"], a["is_captain"])
        for a in assignments
    ]

    return TeamsOut(team_a_name=body.team_a_name, team_b_name=body.team_b_name, assignments=result)


@router.get("/{session_id}/teams", response_model=TeamsOut)
async def get_teams(session_id: str):
    res = (
        supabase_client.table("team_assignments")
        .select("*, players(name, skill, can_bowl)")
        .eq("session_id", session_id)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise HTTPException(404, "No teams generated yet for this session")

    # Recover team names from stored metadata columns (fall back to distinct team_name values)
    first = rows[0]
    team_a_name = first.get("team_a_name") or ""
    team_b_name = first.get("team_b_name") or ""
    if not team_a_name or not team_b_name:
        names = list(dict.fromkeys(r["team_name"] for r in rows))
        team_a_name = names[0] if len(names) > 0 else "Team A"
        team_b_name = names[1] if len(names) > 1 else "Team B"

    assignments = [
        TeamAssignmentOut(
            player_id=r["player_id"],
            player_name=r["players"]["name"],
            skill=r["players"]["skill"],
            can_bowl=r["players"].get("can_bowl", False),
            team_name=r["team_name"],
            is_captain=r["is_captain"],
        )
        for r in rows
    ]

    return TeamsOut(team_a_name=team_a_name, team_b_name=team_b_name, assignments=assignments)


@router.post("/{session_id}/teams/add_player", response_model=TeamsOut)
async def add_player_to_team(session_id: str, body: AddToTeamRequest):
    """Add a new player directly to a specific team without reshuffling."""
    # Verify teams already exist
    existing_res = (
        supabase_client.table("team_assignments")
        .select("team_a_name, team_b_name")
        .eq("session_id", session_id)
        .limit(1)
        .execute()
    )
    if not existing_res.data:
        raise HTTPException(400, "Generate teams first before adding players to a team")

    meta = existing_res.data[0]
    team_a_name = meta.get("team_a_name") or body.team_name
    team_b_name = meta.get("team_b_name") or body.team_name

    # Duplicate name check within session
    dup = (
        supabase_client.table("players")
        .select("id")
        .eq("session_id", session_id)
        .ilike("name", body.name)
        .execute()
    )
    if dup.data:
        raise HTTPException(409, f"Player '{body.name}' already exists in this session")

    # Insert the new player
    p_res = (
        supabase_client.table("players")
        .insert({
            "session_id": session_id,
            "name": body.name,
            "skill": body.skill,
            "can_bowl": body.can_bowl,
        })
        .execute()
    )
    if not p_res.data:
        raise HTTPException(500, "Failed to create player")
    new_player = p_res.data[0]

    # Assign to the requested team (not captain)
    supabase_client.table("team_assignments").insert({
        "session_id": session_id,
        "player_id": new_player["id"],
        "team_name": body.team_name,
        "team_a_name": team_a_name,
        "team_b_name": team_b_name,
        "is_captain": False,
    }).execute()

    # Return full updated teams
    return await get_teams(session_id)
