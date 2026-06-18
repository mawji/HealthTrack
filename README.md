# HealthTrack

A minimal, mobile-first **personal** health dashboard that runs entirely on your
own machine. Live wearable data via the **Google Health API**, an app-derived
**readiness score**, inline and trend **AI insights**, AI food-photo calorie
logging, custom **habit tracking**, **macro health goals**, manual vitals
logging, medical-record-aware coaching, and a natural-language **coach that
logs on your behalf** — all local-first, with your data stored in plain files
next to the app. Installable as a PWA.

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
realistic, deterministic sample data across every screen (Daily, Fitness,
Trends, Food, Habits, Coach, Records) so you can explore the whole UI without
connecting anything.

> **Port note:** port 3000 is OS-reserved on some Windows machines, so the app
> runs on **3210**.

## Connecting your own data (all optional)

Everything below is optional. The app is fully usable in demo mode without any
of it. Configure credentials in `.env.local` (created by `npm run setup` from
[`.env.example`](.env.example)) or via the in-app **Settings** page.

### Google Health API — wearable data + food write-back

The Google Health API (`health.googleapis.com/v4`) is Google's replacement for
the legacy Fitbit Web API, which shuts down in September 2026. HealthTrack reads
your wearable data through it over standard Google OAuth 2.0, and writes
nutrition logs back.

#### How the app actually gets your data

Important: this app reads the **cloud Google Health data tied to your Google
account** — it does **not** read your phone's on-device store directly. So your
job is to get your wearable's data *into your Google account*, then point this
app at the Google Health API. The chain looks like this:

```
your wearable
  → (Android) Health Connect on the phone
  → (iOS)     Apple Health on the phone
  → the Google Health app  →  your Google account / Google Health platform
  → Google Health API (OAuth)
  → HealthTrack (this app)
```

On both platforms the **Google Health app** (the rebranded Fitbit app, since May
2026) is the bridge that uploads your phone's health data to your Google
account; the Google Health API then serves that cloud data to HealthTrack.

```mermaid
flowchart TD
    subgraph Android
      AW["Wearable<br/>(Fitbit / Galaxy Watch /<br/>Garmin / Wear OS)"] --> HC["Health Connect<br/>(on-device hub)"]
      HC --> GHA["Google Health app<br/>(Connections → Partner apps)"]
    end
    subgraph iOS
      IW["Wearable<br/>(Apple Watch / Fitbit /<br/>3rd-party app)"] --> AH["Apple Health / HealthKit<br/>(on-device hub)"]
      AH --> GHI["Google Health app<br/>(Connections → Apps and services →<br/>Apple Health, read-only)"]
    end
    GHA --> ACCT["Your Google account /<br/>Google Health platform (cloud)"]
    GHI --> ACCT
    ACCT --> API["Google Health API<br/>health.googleapis.com/v4"]
    API -->|OAuth 2.0 + PKCE| APP["HealthTrack (this app)"]
```

> Some wearables (notably Fitbit and Pixel Watch) also sync **directly** to your
> Google account through the Google Health app's own cloud — once you've migrated
> your Fitbit account to Google (see below), Health Connect / Apple Health is only
> needed for *other* brands.

#### Fitbit → Google account migration (do this first if you use Fitbit)

If your wearable is a Fitbit or Pixel Watch, migrate your Fitbit account to your
Google account so the device syncs into the Google Health platform. Open the
Fitbit / Google Health app → **Profile / Settings → Move account** and follow the
prompts. Fitbit is hard-requiring this in 2026 (legacy Fitbit logins stop working
mid-May 2026; the Fitbit Web API is decommissioned September 2026), so this is the
only supported path going forward.

#### Android — connect a wearable via Health Connect

Health Connect (Android 9+) is the on-device hub other wearable apps write into;
the Google Health app then uploads it to your Google account.

1. Install **Health Connect** (built in on Android 14+; otherwise from Play
   Store) and the **Google Health** app (the rebranded Fitbit app).
2. Open your wearable's own app (Samsung Health, Garmin Connect, etc.) and enable
   its **Health Connect** integration so it writes your data there. (Fitbit/Pixel
   Watch sync straight to Google — skip to step 4.)
3. In **Google Health → Connections → Partner apps → Sync your favorite health
   apps → Set up**, accept the terms and **choose which data types** to sync
   (steps, heart rate, sleep, weight, nutrition, etc.) and grant background
   access. You manage this later under **Connections → Partner apps → Manage
   Health Connect → Manage data and access**, or in **Health Connect →
   Permissions**.
4. To control *which source* supplies each metric when several apps write the
   same type, open the metric in Google Health and use **View sources** (and
   Health Connect's per-app data priority). This is how you stop, say, two apps
   double-counting steps.
5. Once data is flowing into your Google account, connect this app — see
   [**Google Cloud OAuth setup**](#google-cloud-oauth-setup) below.

#### iOS — connect a wearable via Apple Health

The Google Health API does **not** read Apple HealthKit directly. On iPhone the
realistic path is: your wearable writes into **Apple Health** (HealthKit), and
the **Google Health app reads Apple Health and uploads it to your Google
account**, where the Google Health API can serve it to HealthTrack.

1. Make sure your wearable's app writes to **Apple Health** (most do — Apple
   Watch natively; Fitbit, Garmin, Oura, Whoop, etc. via their iOS app's Apple
   Health permission).
2. Install the **Google Health** app (iOS 16.4+) and sign in with your Google
   account.
3. In **Google Health → Connections → Apps and services → Apple Health → Get
   started**, review the permissions and grant the health-data categories you
   want synced.
4. Connect this app via [**Google Cloud OAuth setup**](#google-cloud-oauth-setup)
   below.

**Honest iOS limitations** (current as of mid-2026):

- The Google Health ↔ Apple Health link is **one-way, read-only** — Google Health
  reads from Apple Health but does not write back yet, so anything HealthTrack
  logs (food, water, workouts) will **not** appear in Apple Health.
- Google Health currently surfaces only about **3 months** of Apple Health
  history.
- A wearable only reaches your Google account if its own iOS app actually writes
  to Apple Health. For a device that syncs **only** to its own vendor cloud and
  never to Apple Health (and isn't Fitbit/Pixel), there is **no clean iOS path**
  into the Google Health API today — that's a genuine gap, not something this app
  can work around.
- For **Fitbit / Pixel Watch** on iOS you don't need Apple Health at all: once
  migrated to your Google account, the device syncs straight to Google Health.

#### Google Cloud OAuth setup

Shared by both platforms — do this once to let HealthTrack call the Google Health
API for your account:

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

Scopes requested: `activity_and_fitness.readonly`,
`health_metrics_and_measurements.readonly`, `sleep.readonly`,
`nutrition.readonly`, `nutrition.writeonly` (plus `activity_and_fitness.writeonly`
for manual workout logging, `health_metrics_and_measurements.writeonly` for
writing weight and body-fat measurements back, and read-only `profile`/`settings`
for the account view). If you connect after a scope was added, **reconnect once**
to grant it.

> **Write-back note:** the Google Health API currently supports
> `dataPoints:create` only for **weight** and **body-fat**. Blood-glucose,
> body temperature, and sleep logged through HealthTrack are stored locally
> only; the API rejects create for those types.

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

| Tab / feature | What it does |
|---|---|
| **Daily** | Steps goal + zone ring, streak, water, workout card, sleep clock + hypnogram, an app-derived **Readiness score** (HRV/RHR/sleep vs your baseline), heart + key-metric rows, your Daily habits — plus **inline AI insights by section** (movement, readiness, hydration, sleep, nutrition) for the current day only; opt-in **Goals card** surfacing active macro targets at the top |
| **Fitness** | Workout history with rich capture — type, duration, intensity/effort, soreness, injuries, exercises |
| **Trends** | Week / month / 90-day / year trends with hover values; **AI summaries per range** (week & month on open, 90-day & year on demand); weight shows latest + low/high; **dynamic metric cards** — a card is added automatically for each active Goal (dashed target overlay) and each manually logged vitals kind |
| **Food** | Photo or text → AI calorie/macro estimate → edit → log to Google Health; meals logged elsewhere sync back |
| **Habits** | Create custom **boost/avoid** habits (targets, units, icons), log daily, track streaks; surfaced on Daily and in coach context; avoid habits have "Nailed it / I slipped" buttons |
| **Goals** | Set macro health targets (weight, steps, RHR, sleep, fasting glucose, HbA1c, lipids) with deterministic **met / on-track / needs attention** status and progress bars; coach sees all active goals as authoritative context; reach via sidebar on desktop or profile menu on mobile |
| **+ Log** | Floating pill button (desktop) / circle FAB (mobile) — quick-entry popup for **Weight, Glucose, Body temp, Body fat, Sleep**; routes Activity / Food / Hydration to their existing screens. Weight and body-fat sync to Google Health automatically |
| **Journal** | View, edit, and delete all hand-logged measurements (newest-first); reach from sidebar / profile menu |
| **Coach** | Streaming chat with inline charts; logs **workouts, water, food, and habits** from natural language; sees your readiness score, active goals, recent manual measurements, and uploaded records as context |
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

### Installing as an app (PWA)

HealthTrack ships a web manifest + icons, so it can be installed to your home
screen / desktop and run full-screen. Browsers only allow install from a
**secure context** (HTTPS, or `localhost`):

- **Same machine (no setup):** open `http://localhost:3210` in Chrome/Edge and
  use the install icon in the address bar. `localhost` counts as secure, so no
  certificate is needed.
- **From your phone:** you need **HTTPS**, easiest with
  [Caddy](https://caddyserver.com) as a reverse proxy. Keep the app local-only
  (`npm run start`) and let Caddy terminate TLS.

  **Install Caddy:**
  - **Windows:** `winget install CaddyServer.Caddy` (or `scoop install caddy`)
  - **macOS:** `brew install caddy`
  - **Linux (Debian/Ubuntu):** follow the apt-repo steps at
    <https://caddyserver.com/docs/install>, or download a static binary from
    <https://caddyserver.com/download>
  - For the **DNS-01** option below you need a *plugin-enabled* build —
    `xcaddy build --with github.com/caddy-dns/<provider>` or tick the plugin on
    the download page.

  Then copy [`Caddyfile.example`](Caddyfile.example) to `Caddyfile`, pick one
  option, set your hostname, and run `caddy run --config ./Caddyfile`:
  - **Real domain, server reachable on 80/443** → Caddy auto-fetches a trusted
    Let's Encrypt cert; the phone installs with no device setup.
  - **Real domain, server not internet-exposed** → use a **DNS-01 challenge**.
    Note the standard Caddy binary has no DNS plugins — build one with your
    provider's plugin (`xcaddy build --with github.com/caddy-dns/cloudflare`, or
    the custom-build option on the Caddy download page), add a DNS API token, and
    point the hostname's A record at the server (a private LAN IP works, set
    "DNS only"). No domain? DuckDNS is a free option. Full steps in
    [`Caddyfile.example`](Caddyfile.example).
  - **Local-only hostname** (e.g. `health.local`) → Caddy's internal CA works,
    but you must install Caddy's root certificate on the phone, or the browser
    shows "Not secure" and blocks install. The root is created only after Caddy
    serves a `tls internal` site once, and lives under Caddy's **data** dir (not
    `/etc/caddy`). Easiest export, via the admin API — Linux/macOS:
    `curl -s http://localhost:2019/pki/ca/local | jq -r .root_certificate > caddy-root.crt`;
    Windows PowerShell (no jq/curl):
    `(Invoke-RestMethod http://localhost:2019/pki/ca/local).root_certificate | Set-Content -Encoding ascii caddy-root.crt`.
    Then install it on the phone. Details in [`Caddyfile.example`](Caddyfile.example).

  If you connect Google Health through the HTTPS hostname, add
  `https://<host>/api/googlehealth/callback` as an authorized redirect URI too.

  > HealthTrack ships both SVG and PNG icons (192 × 192, 512 × 512, maskable,
  > and 180 × 180 apple-touch), so install works cleanly on Android and iOS.
  > An offline service worker is planned.

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
log, manually logged measurements, goals, medical-record files and summaries,
cached insights. Nothing leaves your machine except the API calls **you**
configure (Google Health, your chosen AI provider). No telemetry, no analytics,
no third-party hosting.

## Requirements

- **Node.js 20 or newer** (tested on LTS lines 20, 22, and 24).
  `better-sqlite3` is a native module that needs a current Node with prebuilt
  binaries; the `engines` field in `package.json` enforces the minimum.

## Architecture

- **Next.js 15 (App Router) + React 19**, TypeScript, no UI framework — the
  design system is ~200 lines of CSS variables.
- API routes under `app/api/*`: `googlehealth/*` (OAuth 2.0 + PKCE,
  auto-refresh), `health` (aggregation + demo fallback), `food/*`, `water`,
  `workouts`, `habits/*`, `goals` (macro health targets CRUD + progress),
  `measurements` (manual vitals log + Google Health write-back),
  `devices` (paired device list + local relabelling), `daily-insights`
  (today's section insights + readiness), `chat` (streaming coach +
  natural-language logging), `coach/insights` (Trends range summaries), `records`.
- The **readiness score** is derived in `lib/readiness.ts` (HRV/RHR/sleep vs a
  personal rolling baseline — see
  [`docs/readiness-scoring.md`](docs/readiness-scoring.md)); the deterministic
  daily section-insight gate lives in `lib/daily-insights.ts`.
- `lib/goals.ts` holds all 9 macro goal definitions, deterministic status
  computation (`statusFor`/`progressFor`), and the coach-visible summary.
  `lib/measurements.ts` manages hand-logged vitals and the Google Health
  write-back (weight + body-fat only — the API rejects create for other types).
  `lib/devices.ts` reads paired devices and applies local display-name overrides.
- `lib/googlehealth.ts` is the only file that talks to the Google Health API;
  the AI provider layer in `lib/ai-provider.ts` is the only one that talks to
  the models. `lib/demo.ts` generates the demo-mode dataset.

## License

[GNU AGPL-3.0](LICENSE) © 2026 Shams Mawji.

The AGPL's network-copyleft means anyone who runs a modified version as a
hosted service must release their full source under the same license. As the
sole copyright holder, Shams Mawji can also grant separate commercial licenses
— reach out if you need terms other than the AGPL.
