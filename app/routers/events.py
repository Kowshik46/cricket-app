"""Day events — public, code-gated API.

An organiser (admin) creates an event for a day; it has a short code valid until
`expires_at`. Anyone with the code can see the lobby, add themselves to the day's
player pool, and copy pool players into a game (a session with `event_id` set).
Teams / toss / scoring then happen in the normal app against that session.
"""
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from app.database import supabase_client
from app.models import EventPlayerCreate, EventPlayerUpdate, AddGamePlayers
from app.security import client_ip, rate_limit

router = APIRouter()

# No 0/O/1/I so codes survive being read out over a phone call
_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def gen_event_code() -> str:
    for _ in range(20):
        code = "".join(secrets.choice(_CODE_CHARS) for _ in range(6))
        if not supabase_client.table("events").select("id").eq("code", code).execute().data:
            return code
    raise HTTPException(500, "Could not generate a unique event code")


def _parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def is_live(event: dict) -> bool:
    return event["status"] == "active" and _parse_ts(event["expires_at"]) > datetime.now(timezone.utc)


def build_event_payload(event: dict) -> dict:
    """Event + ground + player pool + games (with their matches). Shared with the admin router."""
    eid = event["id"]
    pool = (
        supabase_client.table("event_players").select("*").eq("event_id", eid)
        .order("created_at").execute().data or []
    )
    sessions = (
        supabase_client.table("sessions").select("id,name,ground_id,created_at").eq("event_id", eid)
        .order("created_at").execute().data or []
    )
    sids = [s["id"] for s in sessions]

    names_by_session: dict[str, list[str]] = {sid: [] for sid in sids}
    matches_by_session: dict[str, list[dict]] = {sid: [] for sid in sids}
    if sids:
        for p in supabase_client.table("players").select("session_id,name").in_("session_id", sids).execute().data or []:
            names_by_session[p["session_id"]].append(p["name"])
        for m in (
            supabase_client.table("matches").select("id,session_id,name,status,overs,watch_code,created_at")
            .in_("session_id", sids).order("created_at").execute().data or []
        ):
            matches_by_session[m["session_id"]].append(m)

    ground_ids = {g for g in [event.get("ground_id")] + [s.get("ground_id") for s in sessions] if g}
    grounds = {}
    if ground_ids:
        for g in supabase_client.table("grounds").select("*").in_("id", list(ground_ids)).execute().data or []:
            grounds[g["id"]] = g

    games = [
        {
            "id": s["id"],
            "name": s["name"],
            "ground": grounds.get(s.get("ground_id")) or grounds.get(event.get("ground_id")),
            "player_names": names_by_session[s["id"]],
            "matches": matches_by_session[s["id"]],
        }
        for s in sessions
    ]
    return {
        "event": {
            "id": eid,
            "name": event["name"],
            "organisation": event.get("organisation"),
            "code": event["code"],
            "event_date": event["event_date"],
            "expires_at": event["expires_at"],
            "status": event["status"],
            "live": is_live(event),
            "ground": grounds.get(event.get("ground_id")),
        },
        "players": pool,
        "games": games,
    }


def _load_live_event(request: Request, code: str) -> dict:
    ip = client_ip(request)
    rate_limit(f"evt:{ip}", 120, 60)
    res = supabase_client.table("events").select("*").eq("code", code.strip().upper()).execute()
    if not res.data:
        rate_limit(f"evt-miss:{ip}", 20, 60)  # brute-force guard on code guessing
        rate_limit("evt-miss:global", 300, 60)  # …and a global cap, since the IP key is spoofable
        raise HTTPException(404, "Event not found — check the code and try again")
    event = res.data[0]
    if not is_live(event):
        raise HTTPException(410, "This event has ended")
    return event


def _name_taken(event_id: str, name: str, exclude_id: str | None = None) -> bool:
    rows = supabase_client.table("event_players").select("id,name").eq("event_id", event_id).execute().data or []
    return any(r["name"].lower() == name.lower() and r["id"] != exclude_id for r in rows)


@router.get("/{code}")
async def get_event(code: str, request: Request):
    return build_event_payload(_load_live_event(request, code))


@router.post("/{code}/players", status_code=201)
async def add_pool_player(code: str, body: EventPlayerCreate, request: Request):
    event = _load_live_event(request, code)
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "Name is required")
    if _name_taken(event["id"], name):
        raise HTTPException(409, f'"{name}" is already in the player list')
    res = supabase_client.table("event_players").insert({
        "event_id": event["id"], "name": name, "skill": body.skill,
        "can_bowl": body.can_bowl, "bowl_type": body.bowl_type,
    }).execute()
    if not res.data:
        raise HTTPException(500, "Failed to add player")
    return res.data[0]


@router.patch("/{code}/players/{player_id}")
async def update_pool_player(code: str, player_id: str, body: EventPlayerUpdate, request: Request):
    event = _load_live_event(request, code)
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(422, "Nothing to update")
    if "name" in updates:
        updates["name"] = updates["name"].strip()
        if _name_taken(event["id"], updates["name"], exclude_id=player_id):
            raise HTTPException(409, f'"{updates["name"]}" is already in the player list')
    res = (
        supabase_client.table("event_players").update(updates)
        .eq("id", player_id).eq("event_id", event["id"]).execute()
    )
    if not res.data:
        raise HTTPException(404, "Player not found")
    return res.data[0]


@router.delete("/{code}/players/{player_id}", status_code=204)
async def delete_pool_player(code: str, player_id: str, request: Request):
    event = _load_live_event(request, code)
    supabase_client.table("event_players").delete().eq("id", player_id).eq("event_id", event["id"]).execute()


@router.post("/{code}/games/{session_id}/players")
async def add_players_to_game(code: str, session_id: str, body: AddGamePlayers, request: Request):
    """Copy chosen pool players into a game's roster, skipping names already there."""
    event = _load_live_event(request, code)
    sess = (
        supabase_client.table("sessions").select("id").eq("id", session_id).eq("event_id", event["id"]).execute()
    )
    if not sess.data:
        raise HTTPException(404, "Game not found in this event")

    pool = (
        supabase_client.table("event_players").select("*")
        .in_("id", [str(i) for i in body.player_ids]).eq("event_id", event["id"]).execute().data or []
    )
    have = {
        p["name"].lower()
        for p in supabase_client.table("players").select("name").eq("session_id", session_id).execute().data or []
    }
    rows = [
        {"session_id": session_id, "name": p["name"], "skill": p["skill"],
         "can_bowl": p["can_bowl"], "bowl_type": p["bowl_type"]}
        for p in pool if p["name"].lower() not in have
    ]
    if rows:
        supabase_client.table("players").insert(rows).execute()
    return {"added": len(rows), "skipped": len(pool) - len(rows)}
