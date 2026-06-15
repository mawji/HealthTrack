# HealthTrack

A minimal, mobile-first **personal** health dashboard that runs entirely on your
own machine. Live Fitbit data via the **Google Health API**, AI food-photo
calorie logging, and medical-record-aware AI health coaching — all local-first,
with your data stored in plain files next to the app.

> **Not medical software.** HealthTrack coaches general wellness habits. It does
> not diagnose, treat, or replace a clinician. Built as a personal project.

## Try it in 60 seconds (demo mode)

No accounts, no API keys, no cloud. With [Node.js](https://nodejs.org) 20 or
newer installed:

```bash
git clone https://github.com/mawji/HealthTrack.git
cd HealthTrack
npm run setup     # installs deps, creates .env.local + data/
npm run dev       # http://localhost:3210
```

With no credentials configured, the app boots straight into **demo mode** —
realistic, deterministic sample data across every screen (Today, Trends, Food,
Coach, Records) so you can explore the whole UI without connecting anything.

> **Port note:** port 3000 is OS-reserved on some Windows machines, so the app
> runs on **3210**.

## Connecting your own data (all optional)

Everything below is optional. The app is fully usable in demo mode without any
of it. Configure credentials in `.env.local` (created by `npm run setup` from
[`.env.example`](.env.example)) or via the in-app **Settings** page.

### Google Health API — wearable data + food write-back

The Google Health API (`health.googleapis.com/v4`) is Google's replacement for
the legacy Fitbit Web API, which shuts down in September 2026. It reads your
Fitbit device data through standard Google OAuth 2.0 and accepts nutrition logs
back.

1. Go to <https://console.cloud.google.com> → create (or pick) a project.
2. **APIs & Services → Library** → enable the **Google Health API**.
3. **OAuth consent screen** → External → add your own Google account as a
   **test user** (the Health API scopes are Restricted; test-user mode is fine
   for a personal local app and skips the verification review).
4. **Credentials → Create credentials → OAuth client ID → Web application**,
   authorized redirect URI exactly:
   `http://localhost:3210/api/googlehealth/callback`
5. Put the client ID and secret in `.env.local`, restart `npm run dev`, open the
   app, and tap **connect Google Health** on the Today screen.
6. Your Fitbit account must be migrated to your Google account (the Fitbit app
   prompts for this) so the device syncs into the Google Health platform.

Scopes requested: `activity_and_fitness.readonly`,
`health_metrics_and_measurements.readonly`, `sleep.readonly`,
`nutrition.readonly`, `nutrition.writeonly`.

### AI providers — coach + food vision

Connect **any one** provider (or none — coaching simply stays off). Set keys in
`.env.local` or in **Settings → AI Provider**:

- **OpenRouter** (default): `OPENROUTER_API_KEY` from
  <https://openrouter.ai/keys>. The coach model (`OPENROUTER_MODEL`, default
  `openai/gpt-oss-120b`) is pinned to the **Cerebras** provider; the vision model
  (`OPENROUTER_VISION_MODEL`) routes to any provider for food/document photos.
- **OpenAI** (API key or ChatGPT-subscription OAuth), **Gemini**,
  **Anthropic Claude**, or local **Ollama** — all configurable in Settings.

## Features

| Tab | What it does |
|---|---|
| **Today** | Steps goal bar + zone ring, streak days, water widget, workouts, sleep clock + hypnogram, heart-range bars, key-metric rows |
| **Trends** | 7/30/90-day trends with hover values; weight shows latest + low/high |
| **Food** | Photo → AI calorie/macro estimate → edit → log to Google Health; meals logged elsewhere sync back |
| **Coach** | Day/week/month AI insights + streaming chat with inline charts; logs workouts/water from natural language |
| **Records** | Upload PDFs/photos/text; AI extracts + summarizes; coach uses them as context |

## Scripts

| Command | What it does |
|---|---|
| `npm run setup` | First-run: check Node, install deps, create `.env.local` + `data/` |
| `npm run dev` | Dev server on `127.0.0.1:3210` (local only) |
| `npm run dev:lan` | Dev server on `0.0.0.0:3210` (reachable from your phone on the LAN) |
| `npm run build` | Production build |
| `npm run start` / `start:lan` | Production server, local-only / LAN-visible |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check` | Typecheck **and** build |
| `npm run preflight` | Verify Node, deps, and that port 3210 is free |
| `npm run update` | Refresh dependencies + rebuild (leaves `.env.local` and `data/` untouched) |
| `npm run backup:data` | Timestamped copy of `data/` into `backups/` |

### Viewing on your phone

Run `npm run dev:lan` (or `start:lan`) and open `http://<your-PC-LAN-IP>:3210`
on your phone, on the same network. The default `dev`/`start` bind to
`127.0.0.1` so the app is not exposed to your network unless you opt in.

### Running in the background (optional)

This is a local-first personal app, not a hosted service. To keep it running
after login:

- **Windows** — Task Scheduler: create a task that runs `npm run start` in the
  project folder at logon.
- **macOS** — `launchd`: a user `LaunchAgent` plist running `npm run start` at
  login.

Full service installers are intentionally deferred for this limited release.

## Storage & privacy

Everything lives in `data/` next to the app (gitignored): OAuth tokens, food
log, medical-record files and summaries, cached insights. Nothing leaves your
machine except the API calls **you** configure (Google Health, your chosen AI
provider). No telemetry, no analytics, no third-party hosting.

## Requirements

- **Node.js 20 or newer** (tested on LTS lines 20, 22, and 24).
  `better-sqlite3` is a native module that needs a current Node with prebuilt
  binaries; the `engines` field in `package.json` enforces the minimum.

## Architecture

- **Next.js 15 (App Router) + React 19**, TypeScript, no UI framework — the
  design system is ~200 lines of CSS variables.
- API routes under `app/api/*`: `googlehealth/*` (OAuth 2.0 + PKCE,
  auto-refresh), `health` (aggregation + demo fallback), `food/*`, `chat`
  (streaming), `coach/insights`, `records`.
- `lib/googlehealth.ts` is the only file that talks to the Google Health API;
  the AI provider layer in `lib/ai-provider.ts` is the only one that talks to
  the models. `lib/demo.ts` generates the demo-mode dataset.

## License

[MIT](LICENSE) © 2026 Shams Mawji.
