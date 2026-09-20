"""Lightweight visitor log: one row per page view.

Pages fire a beacon (`/static/js/track.js` → POST /api/visit). It's client-side because
the service worker serves HTML cache-first, so returning PWA users never hit the server
for the page itself.

Stored: salted IP hash, user agent (+ parsed device/browser/OS), language, country
(from a CDN header if present), path and referrer host. Never the query string —
watch/event codes live there.
"""
import asyncio
import re
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.database import supabase_client
from app.security import client_ip, hash_ip, rate_limit

router = APIRouter()
TRACKED_PATHS = {"/", "/score", "/watch", "/profile", "/join"}


class VisitBody(BaseModel):
    path: str = Field(..., max_length=50)
    referrer: Optional[str] = Field(default=None, max_length=500)


def _parse_ua(ua: str) -> tuple[str, str, str]:
    """Return (device_type, browser, os) from a user-agent string."""
    if re.search(r"bot|crawl|spider|slurp|preview|monitor|uptime|curl|python-requests", ua, re.I):
        return "bot", "bot", "other"
    if re.search(r"iPad|Tablet", ua):
        device = "tablet"
    elif re.search(r"Mobi|Android|iPhone", ua):
        device = "mobile"
    else:
        device = "desktop"
    if "Edg/" in ua:
        browser = "Edge"
    elif "OPR/" in ua or "Opera" in ua:
        browser = "Opera"
    elif "SamsungBrowser" in ua:
        browser = "Samsung"
    elif re.search(r"Chrome|CriOS", ua):
        browser = "Chrome"
    elif "Firefox" in ua or "FxiOS" in ua:
        browser = "Firefox"
    elif "Safari" in ua:
        browser = "Safari"
    else:
        browser = "other"
    if re.search(r"iPhone|iPad|iPod", ua):
        os_name = "iOS"
    elif "Android" in ua:
        os_name = "Android"
    elif "Windows" in ua:
        os_name = "Windows"
    elif "Mac OS X" in ua or "Macintosh" in ua:
        os_name = "macOS"
    elif "Linux" in ua:
        os_name = "Linux"
    else:
        os_name = "other"
    return device, browser, os_name


def _referrer_host(referrer: str | None, own_host: str | None) -> str | None:
    if not referrer:
        return None
    host = urlparse(referrer).netloc
    # Same-site navigation isn't interesting
    return None if host == own_host else (host[:100] or None)


def build_visit(request: Request, body: VisitBody) -> dict:
    ua = request.headers.get("user-agent", "")
    device, browser, os_name = _parse_ua(ua)
    lang = request.headers.get("accept-language", "").split(",")[0].strip()[:20]
    return {
        "ip_hash": hash_ip(client_ip(request)),
        "user_agent": ua[:300] or None,
        "device_type": device,
        "browser": browser,
        "os": os_name,
        "language": lang or None,
        "country": (request.headers.get("cf-ipcountry") or "")[:2].upper() or None,
        "path": body.path,
        "referrer": _referrer_host(body.referrer, request.headers.get("host")),
    }


def _write(row: dict) -> None:
    try:
        supabase_client.table("visits").insert(row).execute()
    except Exception as e:  # tracking must never break the app
        print(f"visit log failed: {e}")


@router.post("/visit", status_code=204)
async def record_visit(body: VisitBody, request: Request):
    """Fire-and-forget: the supabase client is sync, so push the insert to a thread."""
    rate_limit(f"visit:{client_ip(request)}", 60, 60)
    rate_limit("visit:global", 600, 60)  # spoofable IP key ⇒ also bound total log growth
    if body.path not in TRACKED_PATHS:
        return
    asyncio.get_running_loop().run_in_executor(None, _write, build_visit(request, body))
