import base64
import json
import os
from pathlib import Path
from supabase import create_client, Client
from dotenv import load_dotenv

# Explicit paths: bare load_dotenv() searches from the CWD in processes with no __main__.__file__
# (e.g. uvicorn's --reload worker), so it would miss app/.env. app/ wins over the project root.
for _env in (Path(__file__).resolve().parent / ".env", Path(__file__).resolve().parent.parent / ".env"):
    if _env.is_file():
        load_dotenv(_env)
        break

SUPABASE_URL = os.environ["SUPABASE_URL"]
# Secret key (server-side only) — bypasses RLS, never expose to the browser.
# New format: sb_secret_...  (legacy service_role JWT eyJ... also still accepted)
SUPABASE_SECRET_KEY = os.environ["SUPABASE_SECRET_KEY"]


def _reject_non_secret_key(key: str) -> None:
    """Fail fast if a publishable/anon key was pasted where the secret key belongs.
    It would otherwise "work" but every query would hit RLS and silently return nothing."""
    if key.startswith("sb_publishable_"):
        raise RuntimeError("SUPABASE_SECRET_KEY is a publishable key — use the sb_secret_... key instead")
    if key.startswith("eyJ"):
        try:
            payload = key.split(".")[1]
            role = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))).get("role")
        except Exception:
            return  # not decodable — let Supabase reject it if it's bad
        if role == "anon":
            raise RuntimeError("SUPABASE_SECRET_KEY is the legacy anon key — use the secret / service_role key instead")


_reject_non_secret_key(SUPABASE_SECRET_KEY)

supabase_client: Client = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)
