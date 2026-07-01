#!/usr/bin/env bash
# HealthTrack — one-command installer (Tailscale-only Docker deployment).
# Fetches the deploy bundle, collects settings, brings Tailscale up to learn your
# *.ts.net hostname, auto-fills APP_BASE_URL, then starts the stack.
#
#   curl -fsSL https://raw.githubusercontent.com/<owner>/HealthTrack/main/deploy/install.sh | bash
#   ./install.sh [--dir PATH] [--no-start] [--local-ai] [--channel stable|beta]
#
# Re-running is safe: an existing .env is never overwritten. Verify end-to-end per
# §9 of docs/docker-deployment-runbook.html (needs a real Docker host + Tailscale key).
set -euo pipefail

# ── config / args ─────────────────────────────────────────────────────────────
OWNER="${GHCR_OWNER:-mawji}"
BRANCH="${HT_BRANCH:-main}"
RAW="https://raw.githubusercontent.com/${OWNER}/HealthTrack/${BRANCH}/deploy"
DIR="$(pwd)"   # install in the current folder; override with --dir
START=1
CHANNEL="stable"
PROFILE=()

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)      DIR="$2"; shift 2 ;;
    --no-start) START=0; shift ;;
    --local-ai) PROFILE=(--profile local-ai); shift ;;
    --channel)  CHANNEL="$2"; shift 2 ;;
    -h|--help)  grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

say()  { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!  \033[0m%s\n' "$*" >&2; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing required command: $1" >&2; exit 1; }; }
setkv(){ # setkv KEY VALUE  — replace KEY=... in .env (value treated literally)
  local k="$1" v="$2" tmp; tmp="$(mktemp)"
  awk -v k="$k" -v v="$v" 'BEGIN{done=0}
    $0 ~ "^"k"=" {print k"="v; done=1; next} {print}
    END{if(!done) print k"="v}' .env > "$tmp" && mv "$tmp" .env
}

# ── prerequisites ─────────────────────────────────────────────────────────────
say "Checking prerequisites"
need docker
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 plugin required" >&2; exit 1; }
need curl

# ── fetch bundle ──────────────────────────────────────────────────────────────
say "Setting up $DIR"
mkdir -p "$DIR"; cd "$DIR"
for f in compose.yml serve.json; do
  [ -f "$f" ] || { say "Fetching $f"; curl -fsSL "$RAW/$f" -o "$f"; }
done
[ -f .env.example ] || curl -fsSL "$RAW/.env.example" -o .env.example

# ── settings (.env) ───────────────────────────────────────────────────────────
if [ -f .env ]; then
  say "Using existing .env (delete it to reconfigure)"
else
  cp .env.example .env
  # generated / fixed values first, so the .env is usable even if we can't prompt
  TOKEN="$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  setkv WATCHTOWER_TOKEN "$TOKEN"
  setkv GHCR_OWNER "$OWNER"
  setkv CHANNEL "$CHANNEL"
  # `curl | bash` makes stdin the download pipe, so gate prompting on the terminal
  # (/dev/tty), not stdin — otherwise it can never ask.
  if [ -t 0 ] || { : </dev/tty; } 2>/dev/null; then
    say "Enter your settings (Enter keeps the [default]; optional ones can be blank)"
    ask(){ local def="${3:-}" v=""; read -r -p "$2${def:+ [$def]}: " v </dev/tty || true; setkv "$1" "${v:-$def}"; }
    ask GOOGLE_HEALTH_CLIENT_ID     "Google Health client ID"
    ask GOOGLE_HEALTH_CLIENT_SECRET "Google Health client secret"
    ask APP_TZ                      "Timezone (IANA)" "Asia/Dubai"
    ask TS_HOSTNAME                 "Tailscale machine name" "healthtrack"
    ask TS_AUTHKEY                  "Tailscale auth key"
    ask TELEGRAM_BOT_TOKEN          "Telegram bot token (optional, blank to skip)"
  else
    warn "No terminal available for prompts — wrote $DIR/.env from the template."
    warn "Edit it (GOOGLE_HEALTH_*, APP_TZ, TS_HOSTNAME, TS_AUTHKEY), then re-run the"
    warn "installer from this folder:  cd \"$DIR\" && bash <(curl -fsSL $RAW/install.sh)"
    exit 1
  fi
fi

if [ "$START" -eq 0 ]; then
  say "Wrote $DIR/.env. Review it, then run:  docker compose up -d"
  exit 0
fi

# ── bring Tailscale up first, learn the hostname, fill APP_BASE_URL ────────────
say "Starting Tailscale to obtain your HTTPS hostname"
docker compose up -d ts

FQDN=""
for _ in $(seq 1 30); do
  if command -v jq >/dev/null 2>&1; then
    FQDN="$(docker compose exec -T ts tailscale status --json 2>/dev/null | jq -r '.Self.DNSName // empty' | sed 's/\.$//')" || true
  else
    FQDN="$(docker compose exec -T ts tailscale status --json 2>/dev/null \
            | tr ',' '\n' | grep -m1 '"DNSName"' | sed 's/.*"DNSName":"//; s/".*//; s/\.$//')" || true
  fi
  [ -n "$FQDN" ] && break
  sleep 2
done

if [ -n "$FQDN" ]; then
  setkv APP_BASE_URL "https://$FQDN"
  say "Your app URL:  https://$FQDN"
else
  warn "Could not auto-detect the Tailscale hostname. Set APP_BASE_URL in $DIR/.env by hand, then re-run."
fi

# ── start the rest ────────────────────────────────────────────────────────────
say "Starting the stack"
docker compose "${PROFILE[@]}" up -d

# HTTPS needs "HTTPS Certificates" enabled on the tailnet (off by default).
if [ -n "$FQDN" ] && ! docker compose exec -T ts tailscale cert "$FQDN" >/dev/null 2>&1; then
  warn "Tailscale couldn't provision an HTTPS cert yet. Enable it once in the admin"
  warn "console: https://login.tailscale.com/admin/dns -> HTTPS Certificates -> Enable,"
  warn "then:  cd $DIR && docker compose restart"
fi

# ── what's left (the inherently-manual steps) ─────────────────────────────────
URL="${FQDN:+https://$FQDN}"
cat <<EOF

$(printf '\033[1;32m✓ HealthTrack is up.\033[0m')

Finish in the browser:
  1. Google Cloud → your OAuth client → Authorized redirect URIs → add exactly:
       ${URL:-<APP_BASE_URL>}/api/googlehealth/callback
  2. Open ${URL:-your app URL} and: Settings → connect Google Health;
     Settings → AI Provider → connect ChatGPT (Subscription) via the device code
     ${PROFILE:+(and point background/fallback at Ollama: http://localhost:11434)}.
  3. Install the app: phone browser → "Add to Home screen"; desktop Chrome/Edge → install icon.

Updates later: the app shows an "Update available" banner (one-click via Watchtower),
or run:  cd $DIR && docker compose pull && docker compose up -d
EOF
