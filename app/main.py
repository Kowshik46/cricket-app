from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.requests import Request
from fastapi.responses import HTMLResponse
from contextlib import asynccontextmanager
import os

from app.routers import sessions, players, teams, toss, auth, profile, matches, watch, grounds, events, admin
from app.database import supabase_client
from app.security import admin_password
from app import tracking

SUPABASE_URL = os.environ["SUPABASE_URL"]
# Publishable key (sb_publishable_...) goes to the browser for Supabase Auth.
# SUPABASE_ANON_KEY is the pre-rename name, still honoured so old deployments keep working.
SUPABASE_PUBLISHABLE_KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_ANON_KEY", "")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        supabase_client.table("sessions").select("id").limit(1).execute()
    except Exception as e:
        print(f"WARNING: Supabase connection check failed: {e}")
    if len(admin_password()) < 8:
        print("WARNING: ADMIN_PASSWORD is unset or shorter than 8 chars — /admin login is disabled or weak")
    yield


app = FastAPI(
    title="Cricket Team Maker",
    description="Fair team splitter with skill balancing, custom names, and coin toss",
    version="1.0.0",
    lifespan=lifespan,
)

app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")

app.include_router(sessions.router, prefix="/api/sessions", tags=["sessions"])
app.include_router(players.router, prefix="/api/sessions", tags=["players"])
app.include_router(teams.router, prefix="/api/sessions", tags=["teams"])
app.include_router(toss.router, prefix="/api/sessions", tags=["toss"])
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(profile.router, prefix="/api/profile", tags=["profile"])
app.include_router(matches.router, prefix="/api/matches", tags=["matches"])
app.include_router(watch.router, prefix="/api/watch", tags=["watch"])
app.include_router(grounds.router, prefix="/api/grounds", tags=["grounds"])
app.include_router(events.router, prefix="/api/events", tags=["events"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(tracking.router, prefix="/api", tags=["tracking"])


@app.get("/watch", response_class=HTMLResponse)
async def watch_page(request: Request):
    return templates.TemplateResponse("watch.html", {"request": request})


@app.get("/join", response_class=HTMLResponse)
async def join_page(request: Request):
    return templates.TemplateResponse("event.html", {"request": request})


@app.get("/admin", response_class=HTMLResponse)
async def admin_page(request: Request):
    return templates.TemplateResponse("admin.html", {"request": request})


@app.get("/score", response_class=HTMLResponse)
async def score_page(request: Request):
    return templates.TemplateResponse(
        "score.html",
        {
            "request": request,
            "supabase_url": SUPABASE_URL,
            "supabase_publishable_key": SUPABASE_PUBLISHABLE_KEY,
        },
    )


@app.get("/profile", response_class=HTMLResponse)
async def profile_page(request: Request):
    return templates.TemplateResponse(
        "profile.html",
        {
            "request": request,
            "supabase_url": SUPABASE_URL,
            "supabase_publishable_key": SUPABASE_PUBLISHABLE_KEY,
        },
    )


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "supabase_url": SUPABASE_URL,
            "supabase_publishable_key": SUPABASE_PUBLISHABLE_KEY,
        },
    )


@app.get("/health")
async def health():
    return {"status": "ok"}
