# HealthTrack — production image (Tailscale-only Docker deployment).
# Multi-stage: a builder that compiles native deps + builds the Next standalone
# output, and a lean runner. Debian-slim (NOT Alpine) because the app carries
# glibc native binaries: better-sqlite3 (compiled), onnxruntime-node + ffmpeg-static
# + @huggingface/transformers (local voice), pdf-parse, sharp.
#
# Build context = the repo root. Published to GHCR by .github/workflows/docker-publish.yml.

# ── builder ─────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Toolchain for native module compilation (better-sqlite3 via node-gyp).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install deps against the lockfile first (better layer caching).
COPY package.json package-lock.json* ./
RUN npm ci

# Build the app → produces .next/standalone/server.js + .next/static.
COPY . .
RUN npm run build

# ── runner ──────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3210 \
    HOSTNAME=0.0.0.0
# ffmpeg-static ships its own binary; no system ffmpeg needed. ca-certificates
# for outbound HTTPS (Google, OpenRouter, Telegram, model downloads).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Next standalone server + assets.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# The background workers + the prod launcher (not part of the Next trace).
COPY --from=builder /app/scripts ./scripts

# Externalized native packages are excluded from the standalone trace — carry them
# (and their dep subtrees) in explicitly. NOTE (verify at build, §9 of the runbook):
# if any of these fails to load at runtime because a transitive dep is missing, the
# robust fallback is a prod-deps stage (`npm ci --omit=dev`) copied wholesale to
# ./node_modules instead of cherry-picking.
COPY --from=builder /app/node_modules/better-sqlite3       ./node_modules/better-sqlite3
COPY --from=builder /app/node_modules/onnxruntime-node     ./node_modules/onnxruntime-node
COPY --from=builder /app/node_modules/ffmpeg-static        ./node_modules/ffmpeg-static
COPY --from=builder /app/node_modules/@huggingface         ./node_modules/@huggingface
COPY --from=builder /app/node_modules/pdf-parse            ./node_modules/pdf-parse

# Data (JSON/SQLite, OAuth tokens, cached Whisper model) lives on a mounted volume.
RUN mkdir -p /app/data && chown -R node:node /app
VOLUME ["/app/data"]
USER node

# Entrypoint = next standalone server + scheduler + telegram bridge (see scripts/start.mjs).
CMD ["node", "scripts/start.mjs"]
