"""Super-admin API (cookie-authenticated with ADMIN_PASSWORD).

Manage day events + their games, saved grounds, and see the visitor log.
"""
from collections import Counter
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from app.database import supabase_client
from app.models import (
    AdminLogin, EventCreate, EventUpdate, GameCreate, GroundUpdate,
)
from app.routers.events import build_event_payload, gen_event_code, is_live
from app.security import (
    ADMIN_COOKIE, ADMIN_COOKIE_PATH, ADMIN_TTL_SECONDS, admin_password,
    check_admin_password, client_ip, is_https, make_admin_token, rate_limit, require_admin,
)

router = APIRouter()
protected = APIRouter(dependencies=[Depends(require_admin)])


# ── Auth ──────────────────────────────────────────────────────────────────────

@router.post("/login")
async def login(body: AdminLogin, request: Request, response: Response):
    if not admin_password():
        raise HTTPException(503, "Admin is not configured — set ADMIN_PASSWORD on the server")
    # Per-IP, plus a global cap: X-Forwarded-For is client-controlled, so the per-IP key alone is bypassable
    rate_limit(f"admin-login:{client_ip(request)}", 5, 60)
    rate_limit("admin-login:global", 20, 60)
    if not check_admin_password(body.password):
        raise HTTPException(401, "Wrong password")
    response.set_cookie(
        ADMIN_COOKIE, make_admin_token(), max_age=ADMIN_TTL_SECONDS, path=ADMIN_COOKIE_PATH,
        httponly=True, samesite="strict", secure=is_https(request),
    )
    return {"ok": True}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(ADMIN_COOKIE, path=ADMIN_COOKIE_PATH)
    return {"ok": True}


@protected.get("/me")
async def me():
    return {"admin": True}


# ── Grounds ───────────────────────────────────────────────────────────────────

@protected.patch("/grounds/{ground_id}")
async def update_ground(ground_id: str, body: GroundUpdate):
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(422, "Nothing to update")
    if "name" in updates:
        updates["name"] = updates["name"].strip()
    try:
        res = supabase_client.table("grounds").update(updates).eq("id", ground_id).execute()
    except Exception:
        raise HTTPException(409, "A ground with that name already exists")
    if not res.data:
        raise HTTPException(404, "Ground not found")
    return res.data[0]


@protected.delete("/grounds/{ground_id}", status_code=204)
async def delete_ground(ground_id: str):
    # events / sessions / matches referencing it fall back to NULL (ON DELETE SET NULL)
    supabase_client.table("grounds").delete().eq("id", ground_id).execute()


# ── Events ────────────────────────────────────────────────────────────────────

def _require_ground(ground_id: str | None) -> None:
    if ground_id and not supabase_client.table("grounds").select("id").eq("id", ground_id).execute().data:
        raise HTTPException(422, "Ground not found")


def _get_event_or_404(event_id: str) -> dict:
    res = supabase_client.table("events").select("*").eq("id", event_id).execute()
    if not res.data:
        raise HTTPException(404, "Event not found")
    return res.data[0]


@protected.get("/events")
async def list_events():
    events = (
        supabase_client.table("events").select("*")
        .order("event_date", desc=True).order("created_at", desc=True).limit(100).execute().data or []
    )
    ids = [e["id"] for e in events]
    players, games, grounds = Counter(), Counter(), {}
    if ids:
        for r in supabase_client.table("event_players").select("event_id").in_("event_id", ids).execute().data or []:
            players[r["event_id"]] += 1
        for r in supabase_client.table("sessions").select("event_id").in_("event_id", ids).execute().data or []:
            games[r["event_id"]] += 1
        gids = list({e["ground_id"] for e in events if e.get("ground_id")})
        if gids:
            grounds = {g["id"]: g for g in supabase_client.table("grounds").select("*").in_("id", gids).execute().data or []}
    return [
        {**e, "live": is_live(e), "players_count": players[e["id"]], "games_count": games[e["id"]],
         "ground": grounds.get(e.get("ground_id"))}
        for e in events
    ]


@protected.post("/events", status_code=201)
async def create_event(body: EventCreate):
    if body.expires_at.astimezone(timezone.utc) <= datetime.now(timezone.utc):
        raise HTTPException(422, "Expiry must be in the future")
    _require_ground(body.ground_id)
    res = supabase_client.table("events").insert({
        "name": body.name.strip(),
        "organisation": (body.organisation or "").strip() or None,
        "code": gen_event_code(),
        "ground_id": body.ground_id or None,
        "event_date": body.event_date.isoformat(),
        "expires_at": body.expires_at.isoformat(),
    }).execute()
    if not res.data:
        raise HTTPException(500, "Failed to create event")
    return build_event_payload(res.data[0])


@protected.get("/events/{event_id}")
async def get_event(event_id: str):
    return build_event_payload(_get_event_or_404(event_id))


@protected.patch("/events/{event_id}")
async def update_event(event_id: str, body: EventUpdate):
    _get_event_or_404(event_id)
    fields = body.model_dump(exclude_unset=True)  # unset ≠ null: null clears ground / organisation
    if not fields:
        raise HTTPException(422, "Nothing to update")
    if fields.get("name") is None:
        fields.pop("name", None)
    if "organisation" in fields:
        fields["organisation"] = (fields["organisation"] or "").strip() or None
    if fields.get("expires_at") is None:
        fields.pop("expires_at", None)
    else:
        fields["expires_at"] = fields["expires_at"].isoformat()
    if fields.get("status") is None:
        fields.pop("status", None)
    if fields.get("ground_id"):
        _require_ground(fields["ground_id"])
    elif "ground_id" in fields:
        fields["ground_id"] = None
    if not fields:
        raise HTTPException(422, "Nothing to update")
    res = supabase_client.table("events").update(fields).eq("id", event_id).execute()
    return build_event_payload(res.data[0])


@protected.delete("/events/{event_id}", status_code=204)
async def delete_event(event_id: str):
    # Player pool is removed; games (sessions) and their matches are kept, just unlinked.
    supabase_client.table("events").delete().eq("id", event_id).execute()


# ── Games (a session inside an event) ─────────────────────────────────────────

@protected.post("/events/{event_id}/games", status_code=201)
async def create_game(event_id: str, body: GameCreate):
    event = _get_event_or_404(event_id)
    ground_id = body.ground_id or event.get("ground_id")
    _require_ground(ground_id)
    res = supabase_client.table("sessions").insert({
        "name": body.name.strip(), "event_id": event_id, "ground_id": ground_id,
    }).execute()
    if not res.data:
        raise HTTPException(500, "Failed to create game")
    return res.data[0]


@protected.delete("/events/{event_id}/games/{session_id}", status_code=204)
async def delete_game(event_id: str, session_id: str):
    supabase_client.table("sessions").delete().eq("id", session_id).eq("event_id", event_id).execute()


# ── Visitors ──────────────────────────────────────────────────────────────────

def _fetch_visits(since: datetime) -> list[dict]:
    """Page through the log — PostgREST caps each response at 1000 rows."""
    rows: list[dict] = []
    for page in range(10):
        chunk = (
            supabase_client.table("visits")
            .select("ip_hash,device_type,browser,os,country,language,path,referrer,created_at")
            .gte("created_at", since.isoformat()).order("created_at", desc=True)
            .range(page * 1000, page * 1000 + 999).execute().data or []
        )
        rows.extend(chunk)
        if len(chunk) < 1000:
            break
    return rows


@protected.get("/visitors")
async def visitors(days: int = Query(default=7, ge=1, le=90), tz_offset: int = Query(default=0, ge=-840, le=840)):
    """Aggregate the visit log. `tz_offset` = minutes east of UTC, so days bucket in the admin's local time."""
    now = datetime.now(timezone.utc)
    rows = _fetch_visits(now - timedelta(days=days))
    humans = [r for r in rows if r["device_type"] != "bot"]

    def local_day(iso: str) -> str:
        return (datetime.fromisoformat(iso.replace("Z", "+00:00")) + timedelta(minutes=tz_offset)).date().isoformat()

    per_day: dict[str, dict] = {}
    for r in humans:
        d = per_day.setdefault(local_day(r["created_at"]), {"views": 0, "ips": set()})
        d["views"] += 1
        if r["ip_hash"]:
            d["ips"].add(r["ip_hash"])

    today = (now + timedelta(minutes=tz_offset)).date()
    series = []
    for i in range(days - 1, -1, -1):
        key = (today - timedelta(days=i)).isoformat()
        d = per_day.get(key)
        series.append({"date": key, "views": d["views"] if d else 0, "visitors": len(d["ips"]) if d else 0})

    def top(field: str, n: int = 8) -> list[dict]:
        c = Counter(r[field] for r in humans if r.get(field))
        return [{"label": k, "count": v} for k, v in c.most_common(n)]

    return {
        "days": days,
        "views": len(humans),
        "unique_visitors": len({r["ip_hash"] for r in humans if r["ip_hash"]}),
        "bot_views": len(rows) - len(humans),
        "series": series,
        "paths": top("path"),
        "devices": top("device_type"),
        "browsers": top("browser"),
        "os": top("os"),
        "countries": top("country"),
        "referrers": top("referrer"),
        "recent": [
            {**{k: r[k] for k in ("path", "device_type", "browser", "os", "country", "language", "referrer", "created_at")},
             "visitor": (r["ip_hash"] or "")[:8]}
            for r in rows[:40]
        ],
        "truncated": len(rows) >= 10_000,
    }


router.include_router(protected)
