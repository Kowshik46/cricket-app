import random
from fastapi import APIRouter, HTTPException
from app.models import TossResult, TossHistoryItem, TossDecisionUpdate
from app.database import supabase_client

router = APIRouter()


@router.post("/{session_id}/toss", response_model=TossResult)
async def do_toss(session_id: str):
    result = "heads" if random.random() < 0.5 else "tails"
    row = (
        supabase_client.table("toss_history")
        .insert({"session_id": session_id, "result": result})
        .execute()
    )

    count_res = (
        supabase_client.table("toss_history")
        .select("id", count="exact")
        .eq("session_id", session_id)
        .execute()
    )
    toss_number = count_res.count or 1
    toss_id = row.data[0]["id"]

    return TossResult(
        id=toss_id,
        result=result,
        toss_number=toss_number,
        session_id=session_id,
    )


@router.patch("/{session_id}/toss/{toss_id}", response_model=TossHistoryItem)
async def record_toss_decision(session_id: str, toss_id: str, body: TossDecisionUpdate):
    res = (
        supabase_client.table("toss_history")
        .update({"winner_team": body.winner_team, "elected_to": body.elected_to})
        .eq("id", toss_id)
        .eq("session_id", session_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Toss not found")
    return res.data[0]


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
