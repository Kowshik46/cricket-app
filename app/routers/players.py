from fastapi import APIRouter, HTTPException
from app.models import PlayerCreate, PlayerUpdate, PlayerOut
from app.database import supabase_client

router = APIRouter()


@router.post("/{session_id}/players", response_model=PlayerOut, status_code=201)
async def add_player(session_id: str, body: PlayerCreate):
    # Check for duplicate name within session
    existing = (
        supabase_client.table("players")
        .select("id")
        .eq("session_id", session_id)
        .ilike("name", body.name)
        .execute()
    )
    if existing.data:
        raise HTTPException(409, f"Player '{body.name}' already exists in this session")

    res = (
        supabase_client.table("players")
        .insert({"session_id": session_id, "name": body.name, "skill": body.skill, "can_bowl": body.can_bowl, "bowl_type": body.bowl_type})
        .execute()
    )
    if not res.data:
        raise HTTPException(500, "Failed to add player")
    return res.data[0]


@router.get("/{session_id}/players", response_model=list[PlayerOut])
async def list_players(session_id: str):
    res = (
        supabase_client.table("players")
        .select("*")
        .eq("session_id", session_id)
        .order("created_at")
        .execute()
    )
    return res.data


@router.patch("/{session_id}/players/{player_id}", response_model=PlayerOut)
async def update_player(session_id: str, player_id: str, body: PlayerUpdate):
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(400, "No fields to update")

    if "name" in updates:
        existing = (
            supabase_client.table("players")
            .select("id")
            .eq("session_id", session_id)
            .ilike("name", updates["name"])
            .neq("id", player_id)
            .execute()
        )
        if existing.data:
            raise HTTPException(409, f"Player '{updates['name']}' already exists in this session")

    res = (
        supabase_client.table("players")
        .update(updates)
        .eq("id", player_id)
        .eq("session_id", session_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Player not found")
    return res.data[0]


@router.delete("/{session_id}/players/{player_id}", status_code=204)
async def remove_player(session_id: str, player_id: str):
    supabase_client.table("players").delete().eq("id", player_id).eq("session_id", session_id).execute()
