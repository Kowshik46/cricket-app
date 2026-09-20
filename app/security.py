"""Small stdlib-only helpers: admin session token, rate limiting, client IP + hashing."""
import hashlib
import hmac
import os
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

ADMIN_COOKIE = "admin_session"
ADMIN_COOKIE_PATH = "/api/admin"
ADMIN_TTL_SECONDS = 12 * 3600


# ── Admin auth ────────────────────────────────────────────────────────────────
# One super-admin password (ADMIN_PASSWORD). Login issues a signed, expiring cookie.
# The signing key is derived from the password, so changing it logs everyone out.

def admin_password() -> str:
    return os.environ.get("ADMIN_PASSWORD", "")


def _admin_key() -> bytes:
    return hmac.new(b"cricket-admin-v1", admin_password().encode(), hashlib.sha256).digest()


def check_admin_password(candidate: str) -> bool:
    pw = admin_password()
    return bool(pw) and hmac.compare_digest(candidate.encode(), pw.encode())


def make_admin_token() -> str:
    exp = str(int(time.time()) + ADMIN_TTL_SECONDS)
    sig = hmac.new(_admin_key(), exp.encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{sig}"


def _token_valid(token: str | None) -> bool:
    if not token or not admin_password() or "." not in token:
        return False
    exp, _, sig = token.partition(".")
    want = hmac.new(_admin_key(), exp.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, want) and exp.isdigit() and int(exp) > time.time()


def is_admin(request: Request) -> bool:
    return _token_valid(request.cookies.get(ADMIN_COOKIE))


def require_admin(request: Request) -> None:
    """FastAPI dependency: 401 unless the request carries a valid admin cookie."""
    if not is_admin(request):
        raise HTTPException(401, "Admin login required")


# ── Client identity ───────────────────────────────────────────────────────────

def client_ip(request: Request) -> str:
    """Best-effort client IP behind Render's proxy. Spoofable, so analytics only —
    never use it as a security control."""
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else ""


def is_https(request: Request) -> bool:
    return request.headers.get("x-forwarded-proto", request.url.scheme) == "https"


def hash_ip(ip: str) -> str | None:
    """Salted HMAC of the IP — lets us count unique visitors without keeping addresses."""
    if not ip:
        return None
    salt = os.environ.get("VISITOR_HASH_SALT") or os.environ.get("SUPABASE_SECRET_KEY", "")
    return hmac.new(salt.encode(), ip.encode(), hashlib.sha256).hexdigest()[:32]


# ── Rate limiting (in-memory, per process — fine for a single free-tier instance) ─

_hits: dict[str, deque] = defaultdict(deque)


def rate_limit(key: str, limit: int, window_seconds: int) -> None:
    now = time.monotonic()
    if len(_hits) > 10_000:
        _hits.clear()
    q = _hits[key]
    while q and q[0] < now - window_seconds:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(429, "Too many requests — slow down and try again shortly")
    q.append(now)
