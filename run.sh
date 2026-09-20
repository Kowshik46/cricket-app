#!/usr/bin/env bash
# Cricket Team Maker — one command to set up and run the app.
#
#   ./run.sh                 dev server with auto-reload on http://127.0.0.1:8000
#   ./run.sh --prod          production-style: 0.0.0.0, no reload
#   ./run.sh --reinstall     force reinstalling dependencies
#   ./run.sh --skip-check    skip the Supabase connectivity / migration check
#   PORT=9000 HOST=0.0.0.0 ./run.sh
#
# What it does, in order (each step is skipped when already done):
#   1. finds Python (and `uv` if you have it — faster)      2. creates the venv  app/cricket/
#   3. creates app/.env (asks for your keys) if none exists 4. checks .env has the required values
#   5. installs requirements.txt when it changed            6. checks Supabase keys + tables (warns only)
#   7. starts uvicorn
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

VENV="$ROOT/app/cricket"
REQ="$ROOT/app/requirements.txt"
EXAMPLE="$ROOT/app/.env.example"
MODE=dev; REINSTALL=0; CHECK=1
PORT="${PORT:-8000}"; HOST="${HOST:-}"

for arg in "$@"; do
  case "$arg" in
    --prod)        MODE=prod ;;
    --reinstall)   REINSTALL=1 ;;
    --skip-check)  CHECK=0 ;;
    -h|--help)     sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)             echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done
[ -n "$HOST" ] || { [ "$MODE" = prod ] && HOST=0.0.0.0 || HOST=127.0.0.1; }

if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; N=$'\033[0m'; else B=; G=; Y=; R=; D=; N=; fi
step() { printf '%s▸ %s%s\n' "$B" "$*" "$N"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
die()  { printf '%s✗ %s%s\n' "$R" "$*" "$N" >&2; exit 1; }

# ── 1. Python ────────────────────────────────────────────────────────────────
step "Python"
PY=
for c in python3.12 python3.11 python3.13 python3.10 python3.9 python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 9))' 2>/dev/null; then PY="$(command -v "$c")"; break; fi
done
HAVE_UV=0; command -v uv >/dev/null 2>&1 && HAVE_UV=1
[ -n "$PY" ] || [ "$HAVE_UV" = 1 ] || die "Python 3.9+ not found. Install it (e.g. 'sudo apt install python3 python3-venv') and re-run."
[ -n "$PY" ] && ok "$($PY --version) at $PY"
[ "$HAVE_UV" = 1 ] && ok "uv found — using it for the venv and installs"

# ── 2. Virtualenv ────────────────────────────────────────────────────────────
step "Virtualenv ($VENV)"
if [ -d "$VENV" ] && [ ! -x "$VENV/bin/python" ]; then
  [ -f "$VENV/pyvenv.cfg" ] || die "$VENV exists but isn't a usable venv. Remove or rename it and re-run."
  warn "existing venv is broken or from another OS — recreating"
  rm -rf "$VENV"
fi
if [ ! -x "$VENV/bin/python" ]; then
  if [ "$HAVE_UV" = 1 ]; then
    uv venv -q "$VENV"
  else
    "$PY" -m venv "$VENV" || { rm -rf "$VENV"; die "Could not create a venv. On Debian/Ubuntu: sudo apt install python3-venv"; }
    "$VENV/bin/python" -m pip --version >/dev/null 2>&1 || "$VENV/bin/python" -m ensurepip --upgrade >/dev/null 2>&1 \
      || { rm -rf "$VENV"; die "venv has no pip. On Debian/Ubuntu: sudo apt install python3-venv (or install uv)"; }
  fi
  ok "created"
else
  ok "using existing venv ($("$VENV/bin/python" --version))"
fi
VPY="$VENV/bin/python"

# ── 3. .env ──────────────────────────────────────────────────────────────────
# python-dotenv (database.py) looks in app/ first, then the project root — mirror that.
step "Environment file"
ENV_FILE=
for f in "$ROOT/app/.env" "$ROOT/.env"; do [ -f "$f" ] && { ENV_FILE="$f"; break; }; done

gen() { "${PY:-$VPY}" -c "import secrets,sys; print(secrets.token_urlsafe(int(sys.argv[1])))" "$1"; }

# Fill app/.env.example with the given values (passed via env, never argv) and write it 0600.
write_env() {
  V_SUPABASE_URL="$1" V_SUPABASE_SECRET_KEY="$2" V_SUPABASE_PUBLISHABLE_KEY="$3" V_ADMIN_PASSWORD="$4" V_VISITOR_HASH_SALT="$5" \
  "${PY:-$VPY}" - "$EXAMPLE" "$ROOT/app/.env" <<'PYEOF'
import os, re, sys
src, dst = sys.argv[1], sys.argv[2]
def q(v):  # quote only when python-dotenv would otherwise mangle it
    return v if re.fullmatch(r"[A-Za-z0-9_@%+=:,./-]*", v) else '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'
out = []
for line in open(src):
    m = re.match(r"^([A-Z_]+)=", line)
    val = os.environ.get("V_" + m.group(1), "") if m else ""
    out.append(f"{m.group(1)}={q(val)}\n" if val else line)
os.umask(0o077)
open(dst, "w").write("".join(out))
PYEOF
}

if [ -z "$ENV_FILE" ] && [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SECRET_KEY:-}" ]; then
  ok "no .env file, but SUPABASE_URL / SUPABASE_SECRET_KEY are set in the shell — using those"
elif [ -z "$ENV_FILE" ]; then
  [ -f "$EXAMPLE" ] || die "app/.env.example is missing — can't create app/.env"
  if [ -t 0 ]; then
    printf '  No .env found — let'"'"'s create app/.env %s(gitignored; input for keys is hidden)%s\n' "$D" "$N"
    printf '  Supabase → Project Settings → API Keys\n\n'
    read -rp "  Supabase project URL (https://xxxx.supabase.co): " URL
    read -rsp "  SECRET key (sb_secret_...): " SECRET; echo
    read -rp  "  PUBLISHABLE key (sb_publishable_..., Enter to skip = no sign-in): " PUB
    read -rsp "  Admin password for /admin (Enter to auto-generate): " ADMIN; echo
    URL="${URL%/}"
  else
    URL=; SECRET=; PUB=; ADMIN=
  fi
  GENERATED=0; [ -n "$ADMIN" ] || { ADMIN="$(gen 18)"; GENERATED=1; }
  write_env "$URL" "$SECRET" "$PUB" "$ADMIN" "$(gen 24)"
  ENV_FILE="$ROOT/app/.env"
  ok "created app/.env (permissions 600)"
  [ "$GENERATED" = 1 ] && warn "generated admin password: ${B}${ADMIN}${N}  (saved in app/.env — use it to sign in at /admin)"
  if [ ! -t 0 ]; then
    die "Non-interactive run: fill in SUPABASE_URL and SUPABASE_SECRET_KEY in app/.env, then re-run ./run.sh"
  fi
else
  ok "using $ENV_FILE"
fi

# ── 4. Validate .env ─────────────────────────────────────────────────────────
env_get() {  # value of KEY from the shell env, else from the .env file (never sourced)
  local v="${!1:-}"
  if [ -z "$v" ] && [ -n "$ENV_FILE" ]; then
    v="$(grep -E "^[[:space:]]*$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
    v="${v%$'\r'}"; v="${v#\"}"; v="${v%\"}"; v="${v#\'}"; v="${v%\'}"
  fi
  printf '%s' "$v"
}
is_placeholder() { [[ -z "$1" || "$1" == your-* || "$1" == *your-project-id* || "$1" == sb_secret_your-* || "$1" == choose-a-long-* || "$1" == any-long-random-* ]]; }

BAD=()
for k in SUPABASE_URL SUPABASE_SECRET_KEY; do is_placeholder "$(env_get "$k")" && BAD+=("$k"); done
if [ "${#BAD[@]}" -gt 0 ]; then
  die "Missing or placeholder value in ${ENV_FILE:-the environment}: ${BAD[*]}
  Edit that file (see app/.env.example for where to find each) and re-run."
fi
ok "SUPABASE_URL and SUPABASE_SECRET_KEY set"
PUBV="$(env_get SUPABASE_PUBLISHABLE_KEY)"; [ -n "$PUBV" ] || PUBV="$(env_get SUPABASE_ANON_KEY)"
is_placeholder "$PUBV" && warn "SUPABASE_PUBLISHABLE_KEY not set — the app works, but sign-in is disabled"
ADMINV="$(env_get ADMIN_PASSWORD)"
if is_placeholder "$ADMINV"; then warn "ADMIN_PASSWORD not set — /admin login will be disabled"
elif [ "${#ADMINV}" -lt 8 ]; then warn "ADMIN_PASSWORD is shorter than 8 characters — use a longer one"; fi

# ── 5. Dependencies ──────────────────────────────────────────────────────────
step "Dependencies"
STAMP="$VENV/.requirements.sha256"
WANT="$(sha256sum "$REQ" | cut -d' ' -f1)"
if [ "$REINSTALL" = 0 ] && [ "$(cat "$STAMP" 2>/dev/null || true)" = "$WANT" ] \
   && "$VPY" -c 'import fastapi, uvicorn, supabase, jinja2, dotenv' 2>/dev/null; then
  ok "up to date (requirements.txt unchanged)"
else
  if [ "$HAVE_UV" = 1 ]; then
    uv pip install -q --python "$VPY" -r "$REQ"
  else
    "$VPY" -m pip install -q --disable-pip-version-check -r "$REQ"
  fi
  printf '%s' "$WANT" > "$STAMP"
  ok "installed from app/requirements.txt"
fi

# ── 6. Supabase check (warn only, except a bad key type which would stop the app anyway) ──
if [ "$CHECK" = 1 ]; then
  step "Supabase connection"
  set +e
  CHECK_OUT="$(PYTHONPATH="$ROOT" timeout 40 "$VPY" - <<'PYEOF' 2>&1
import sys
try:
    from app.database import supabase_client as c
except Exception as e:
    print(f"FATAL {e}"); sys.exit(3)
need = {  # table -> where it comes from
    "sessions": "supabase_master.sql", "matches": "supabase_master.sql", "innings_overs": "supabase_master.sql",
    "grounds": "supabase_events_migration.sql", "events": "supabase_events_migration.sql",
    "event_players": "supabase_events_migration.sql", "visits": "supabase_events_migration.sql",
}
bad = {}
for t, src in need.items():
    try:
        c.table(t).select("*").limit(1).execute()
    except Exception as e:
        msg = str(e)
        if any(s in msg.lower() for s in ("invalid api key", "invalid jwt", "apikey", "unauthorized")):
            print(f"KEY {msg[:160]}"); sys.exit(4)
        if any(s in msg for s in ("PGRST205", "42P01", "does not exist", "schema cache")):
            bad[t] = src
        else:
            print(f"NET {msg[:160]}"); sys.exit(5)
for t in need:
    print(("MISS " if t in bad else "OK   ") + t + (f" {bad[t]}" if t in bad else ""))
PYEOF
)"
  RC=$?
  set -e
  case "$RC" in
    0) MISSING=""; SRCS=""
       while read -r tag tbl src; do
         [ "$tag" = MISS ] || continue
         MISSING+="$tbl "
         case " $SRCS " in *" app/$src "*) ;; *) SRCS+="app/$src " ;; esac
       done <<<"$CHECK_OUT"
       if [ -z "$MISSING" ]; then ok "keys work and all expected tables exist"
       else warn "missing tables: ${MISSING}
    → run in the Supabase SQL editor: ${SRCS}(app/supabase_master.sql sets up everything on a fresh project)"; fi ;;
    3) die "${CHECK_OUT#FATAL }" ;;
    4) die "Supabase rejected the keys: ${CHECK_OUT#KEY }
  Re-copy SUPABASE_SECRET_KEY from Project Settings → API Keys (same project as SUPABASE_URL)." ;;
    124) warn "Supabase check timed out — continuing (network down?)" ;;
    *) warn "couldn't reach Supabase (${CHECK_OUT#NET }) — continuing anyway" ;;
  esac
fi

# ── 7. Run ───────────────────────────────────────────────────────────────────
step "Starting the app ($MODE)"
printf '  App    http://%s:%s\n  Admin  http://%s:%s/admin\n  API    http://%s:%s/docs\n  %sCtrl+C to stop%s\n\n' \
  "$( [ "$HOST" = 0.0.0.0 ] && echo localhost || echo "$HOST" )" "$PORT" \
  "$( [ "$HOST" = 0.0.0.0 ] && echo localhost || echo "$HOST" )" "$PORT" \
  "$( [ "$HOST" = 0.0.0.0 ] && echo localhost || echo "$HOST" )" "$PORT" "$D" "$N"

if [ "$MODE" = prod ]; then
  exec "$VPY" -m uvicorn app.main:app --host "$HOST" --port "$PORT"
else
  exec "$VPY" -m uvicorn app.main:app --reload --host "$HOST" --port "$PORT"
fi
