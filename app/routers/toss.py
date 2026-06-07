import random
from fastapi import APIRouter
from app.models import TossResult, TossHistoryItem
from app.database import supabase_client

router = APIRouter()


@router.post("/{session_id}/toss", response_model=TossResult)
async def do_toss(session_id: str):
    result = "heads" if random.random() < 0.5 else "tails"
    supabase_client.table("toss_history").insert({"session_id": session_id, "result": result}).execute()

    count_res = (
        supabase_client.table("toss_history")
        .select("id", count="exact")
        .eq("session_id", session_id)
        .execute()
    )
    toss_number = count_res.count or 1

    return TossResult(result=result, toss_number=toss_number, session_id=session_id)


@router.get("/{session_id}/toss/history", response_model=list[TossHistoryItem])
async def toss_history(session_id: str):
    res = (
        supabase_client.table("toss_history")
        .select("*")
        .eq("session_id", session_id)
        .order("tossed_at", desc=True)
        .limit(20)
        .execute()
    )
    return res.data or []
