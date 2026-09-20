"""Saved grounds (venues). Public: anyone setting up a match can list and add one so it's
reusable next time. Rename/delete lives in the admin router."""
from fastapi import APIRouter, HTTPException, Request

from app.database import supabase_client
from app.models import GroundCreate, GroundOut
from app.security import client_ip, rate_limit

router = APIRouter()


@router.get("", response_model=list[GroundOut])
async def list_grounds():
    res = supabase_client.table("grounds").select("*").order("name").limit(500).execute()
    return res.data or []


@router.post("", response_model=GroundOut)
async def create_ground(body: GroundCreate, request: Request):
    """Create a ground, or return the existing one with the same name (case-insensitive).
    If the existing row has no coordinates and this request supplies them, fill them in."""
    rate_limit(f"ground:{client_ip(request)}", 15, 60)
    rate_limit("ground:global", 60, 60)
    name = body.name.strip()
    if not name:
        raise HTTPException(422, "Ground name is required")
    if (body.latitude is None) != (body.longitude is None):
        raise HTTPException(422, "Provide both latitude and longitude, or neither")

    # Small table — compare in Python rather than build an ilike pattern from user text
    existing = supabase_client.table("grounds").select("*").limit(1000).execute()
    match = next((g for g in (existing.data or []) if g["name"].lower() == name.lower()), None)
    if match:
        if match.get("latitude") is None and body.latitude is not None and body.longitude is not None:
            upd = supabase_client.table("grounds").update(
                {"latitude": body.latitude, "longitude": body.longitude}
            ).eq("id", match["id"]).execute()
            return upd.data[0]
        return match

    res = supabase_client.table("grounds").insert({
        "name": name,
        "latitude": body.latitude,
        "longitude": body.longitude,
        "address": body.address,
    }).execute()
    if not res.data:
        raise HTTPException(500, "Failed to save ground")
    return res.data[0]
