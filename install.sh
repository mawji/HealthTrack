#!/usr/bin/env sh
# HealthTrack one-line installer (macOS / Linux / WSL / Git Bash).
#
#   curl -fsSL https://raw.githubusercontent.com/mawji/HealthTrack/main/install.sh | sh
#
# Clones the public repo, runs first-run setup, and builds for production.
# It NEVER starts a long-running server and never touches anything outside the
# target directory. Override the defaults with env vars:
#   HEALTHTRACK_REPO=<git url>   HEALTHTRACK_DIR=<folder name>
set -eu

REPO="${HEALTHTRACK_REPO:-https://github.com/mawji/HealthTrack.git}"
DIR="${HEALTHTRACK_DIR:-HealthTrack}"

say() { printf '[install] %s\n' "$1"; }
die() { printf '[install] error: %s\n' "$1" >&2; exit 1; }

command -v git  >/dev/null 2>&1 || die "git is required but not found. Install git and re-run."
command -v node >/dev/null 2>&1 || die "Node.js 20+ is required. Install from https://nodejs.org and re-run."
command -v npm  >/dev/null 2>&1 || die "npm is required but not found (it ships with Node.js)."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node $(node -v) is too old. Use Node 20 or newer (LTS 20, 22, 24)."

[ -e "$DIR" ] && die "'$DIR' already exists. Remove it, or set HEALTHTRACK_DIR=<other> and re-run."

say "cloning $REPO -> $DIR ..."
git clone "$REPO" "$DIR"
cd "$DIR"

say "first-run setup (deps, .env.local, data/) ..."
npm run setup

say "building for production ..."
npm run build

say "done."
say "start it:  cd $DIR && npm run start"
say "then open http://localhost:3210  (demo mode until you add credentials)"
