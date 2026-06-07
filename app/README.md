# Cricket Team Maker

A mobile-first PWA for fair cricket team splits — skill-balanced teams, custom team names, coin toss, and Supabase persistence.

**Live app:** https://cricket.kowshik.co.in

## Stack

- **FastAPI** — Python backend, REST API
- **Supabase** — Postgres database + Auth (hosted)
- **Vanilla JS** — PWA frontend, installable on mobile
- **Render** — hosting (free tier, auto-deploys from GitHub)

---

## Deployment

The app is deployed on **Render** and served at `cricket.kowshik.co.in`.

### How it works

```
GitHub (Kowshik46/cricket-app)
        │  push to main
        ▼
  Render (free tier)
  builds Dockerfile → runs uvicorn
        │
        ▼
  cricket.kowshik.co.in   ← CNAME → cricket-app-rl4s.onrender.com
```

- Any push to `main` triggers an automatic redeploy on Render
- SSL certificate is managed by Render (Let's Encrypt)
- The app may take ~30 seconds to wake up after a period of inactivity (free tier behaviour)

### Key deployment files

| File | Purpose |
|------|---------|
| [`Dockerfile`](../Dockerfile) | Builds the production image |
| [`render.yaml`](../render.yaml) | Render service config (runtime, health check, env vars) |

### Environment variables (set in Render dashboard)

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL (`https://<id>.supabase.co`) |
| `SUPABASE_SECRET_KEY` | Legacy service_role JWT — server only, never expose to browser |
| `SUPABASE_ANON_KEY` | Legacy anon JWT — injected into HTML for browser Supabase JS SDK |

> **Key format:** `supabase-py 2.4.6` only accepts legacy JWT-format keys (`eyJ...`).
> Get them from: Supabase Dashboard → Project Settings → API Keys → **"Legacy"** tab.

---

## Local development

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**
2. Open **SQL Editor** and run these migration files in order:
   - `app/supabase_schema.sql`
   - `app/supabase_auth_migration.sql`
   - `app/supabase_features_migration.sql`
   - `app/supabase_profile_migration.sql`
3. Then run: `ALTER TABLE user_profiles DISABLE ROW LEVEL SECURITY;`
4. Go to **Project Settings → API Keys → Legacy** and copy the Project URL, anon key, and service_role key

### 2. Configure environment

Create `.env` at the project root (next to `app/`):

```
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SECRET_KEY=eyJ...   ← legacy service_role key
SUPABASE_ANON_KEY=eyJ...     ← legacy anon key
```

### 3. Install & run

```powershell
# From the project root (Cricket team genrator/)
app\cricket\Scripts\activate        # activate the bundled venv

pip install -r app/requirements.txt

uvicorn app.main:app --reload --port 8000
```

Open http://localhost:8000 in your browser.

> **Important:** always run `uvicorn` from the project root, not from inside `app/`.

### Install as mobile app (PWA)

On Android: open the URL in Chrome → menu → **Add to Home screen**
On iOS: open in Safari → Share → **Add to Home Screen**

---

## Project structure

```
Cricket team genrator/
├── Dockerfile              # production image for Render
├── render.yaml             # Render service config
├── .gitignore
└── app/
    ├── main.py             # FastAPI app entry point
    ├── database.py         # Supabase client
    ├── models.py           # Pydantic schemas
    ├── routers/
    │   ├── sessions.py
    │   ├── players.py
    │   ├── teams.py
    │   ├── toss.py
    │   ├── auth.py
    │   └── profile.py
    ├── static/
    │   ├── manifest.json   # PWA manifest
    │   ├── sw.js           # Service worker
    │   └── icons/          # Add icon-192.png and icon-512.png here
    ├── templates/
    │   ├── index.html      # Main SPA
    │   └── profile.html    # Profile page
    ├── supabase_schema.sql
    ├── supabase_auth_migration.sql
    ├── supabase_features_migration.sql
    ├── supabase_profile_migration.sql
    ├── requirements.txt
    └── .env.example
```

### PWA icons

Add two PNG icon files to `app/static/icons/`:
- `icon-192.png` (192×192 px)
- `icon-512.png` (512×512 px)

You can generate them from any cricket emoji or logo at [maskable.app](https://maskable.app/editor).

---

## API docs

Run the server locally and visit http://localhost:8000/docs for the full interactive Swagger UI.
