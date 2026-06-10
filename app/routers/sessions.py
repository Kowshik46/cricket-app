from fastapi import APIRouter, HTTPException, Header, Query
from typing import Optional
from app.models import SessionCreate, SessionOut, SessionRename
from app.database import supabase_client

router = APIRouter()


@router.post("", response_model=SessionOut, status_code=201)
async def create_session(body: SessionCreate):
    res = supabase_client.table("sessions").insert({"name": body.name}).execute()
    if not res.data:
        raise HTTPException(500, "Failed to create session")
    return res.data[0]


@router.get("", response_model=list[SessionOut])
async def list_sessions(
    authorization: Optional[str] = Header(default=None),
    ids: Optional[str] = Query(default=None),
):
    # Authenticated user: filter by their owner_id
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        try:
            resp = supabase_client.auth.get_user(token)
            if resp and resp.user:
                user_id = str(resp.user.id)
                res = (
                    supabase_client.table("sessions")
                    .select("*")
                    .eq("owner_id", user_id)
                    .order("created_at", desc=True)
                    .limit(50)
                    .execute()
                )
                return res.data
        except Exception:
            pass

    # Guest: only return sessions whose IDs the browser provided
    if ids:
        id_list = [i.strip() for i in ids.split(",") if i.strip()]
        if id_list:
            res = (
                supabase_client.table("sessions")
                .select("*")
                .in_("id", id_list)
                .is_("owner_id", "null")
                .order("created_at", desc=True)
                .execute()
            )
            return res.data

    return []


@router.get("/{session_id}", response_model=SessionOut)
async def get_session(session_id: str):
    res = supabase_client.table("sessions").select("*").eq("id", session_id).single().execute()
    if not res.data:
        raise HTTPException(404, "Session not found")
    return res.data


@router.patch("/{session_id}", response_model=SessionOut)
async def rename_session(session_id: str, body: SessionRename):
    res = (
        supabase_client.table("sessions")
        .update({"name": body.name})
        .eq("id", session_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Session not found")
    return res.data[0]


@router.delete("/{session_id}", status_code=204)
async def delete_session(session_id: str):
    supabase_client.table("sessions").delete().eq("id", session_id).execute()
