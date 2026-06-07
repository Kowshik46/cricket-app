from fastapi import APIRouter, HTTPException
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
async def list_sessions():
    res = supabase_client.table("sessions").select("*").order("created_at", desc=True).limit(50).execute()
    return res.data


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
