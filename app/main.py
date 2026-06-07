from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.requests import Request
from fastapi.responses import HTMLResponse
from contextlib import asynccontextmanager
import os

from app.routers import sessions, players, teams, toss, auth, profile
from app.database import supabase_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        supabase_client.table("sessions").select("id").limit(1).execute()
    except Exception as e:
        print(f"WARNING: Supabase connection check failed: {e}")
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


@app.get("/profile", response_class=HTMLResponse)
async def profile_page(request: Request):
    return templates.TemplateResponse(
        "profile.html",
        {
            "request": request,
            "supabase_url": SUPABASE_URL,
            "supabase_anon_key": SUPABASE_ANON_KEY,
        },
    )


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "supabase_url": SUPABASE_URL,
            "supabase_anon_key": SUPABASE_ANON_KEY,
        },
    )


@app.get("/health")
async def health():
    return {"status": "ok"}
