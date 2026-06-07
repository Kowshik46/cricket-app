from fastapi import APIRouter, HTTPException, Header
from typing import Optional
from app.models import UserOut, ClaimRequest
from app.database import supabase_client

router = APIRouter()


def _verify_jwt(authorization: Optional[str]) -> dict:
    """Extract and verify Bearer JWT via Supabase; return user dict or raise 401."""
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


@router.get("/me", response_model=UserOut)
async def get_me(authorization: Optional[str] = Header(default=None)):
    user = _verify_jwt(authorization)
    return UserOut(id=str(user.id), email=user.email)


@router.post("/claim")
async def claim_sessions(
    body: ClaimRequest,
    authorization: Optional[str] = Header(default=None),
):
    """Assign anonymous sessions to the authenticated user."""
    user = _verify_jwt(authorization)
    if not body.session_ids:
        return {"claimed": 0}

    # Only claim sessions that have no owner yet
    res = (
        supabase_client.table("sessions")
        .update({"owner_id": str(user.id)})
        .in_("id", body.session_ids)
        .is_("owner_id", "null")
        .execute()
    )
    return {"claimed": len(res.data) if res.data else 0}
