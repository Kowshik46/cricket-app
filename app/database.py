import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
# Secret key (server-side only) — bypasses RLS, never expose to the browser
SUPABASE_SECRET_KEY = os.environ["SUPABASE_SECRET_KEY"]

supabase_client: Client = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)
