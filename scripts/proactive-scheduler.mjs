// Local proactive scheduler — the deterministic clock for item 14.
//
// It does NOT decide whether to nudge; it just wakes periodically and asks the
// app to evaluate (the engine enforces opt-in, windows, quiet hours, caps,
// cooldowns). It also fires the once-daily self-report at the owner's report
// time. Outbound-only, like the Telegram bridge; started with the app.
//
// Run: started automatically by `npm run dev`.

import fs from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, "data", "telegram", "config.json");
const STATE_PATH = path.join(ROOT, "data", "proactive", "scheduler-state.json");
const APP_BASE = process.env.APP_BASE_URL || "http://127.0.0.1:3210";

const BASE_INTERVAL_MS = 5 * 60 * 1000; // base loop: 5 min (med reminders need this granularity)
const PROACTIVE_EVERY = 3; // run the anti-nag proactive cycle every 3rd tick (~15 min)
const REPORT_HOUR = Number(process.env.PROACTIVE_REPORT_HOUR ?? 8); // local hour for the daily report
const TZ = process.env.APP_TZ || "Asia/Dubai";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read (and lazily create) the shared bridge secret the API routes expect. */
function bridgeSecret() {
  const cfg = readJson(CONFIG_PATH, {});
  if (!cfg.bridgeSecret) {
    cfg.bridgeSecret = crypto.randomBytes(24).toString("hex");
    writeJson(CONFIG_PATH, cfg);
  }
  return cfg.bridgeSecret;
}

async function post(routePath) {
  try {
    const res = await fetch(`${APP_BASE}${routePath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bridge-secret": bridgeSecret() },
      body: "{}",
    });
    return await res.json().catch(() => ({}));
  } catch (e) {
    console.warn("[proactive-scheduler] request failed:", e.message);
    return null;
  }
}

/** Local yyyy-MM-dd and hour in APP_TZ. */
function localParts() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

async function tick(count) {
  // Medication reminders: time-anchored, must-deliver — run EVERY tick (5 min)
  // so an "at 11:00" dose (± lead time) fires promptly. The endpoint no-ops when
  // reminders are disabled and de-dupes its own sends.
  const med = await post("/api/medications/tick");
  if (med?.sent) console.log(`[proactive-scheduler] med reminders sent: ${med.sent}`);

  // The anti-nag proactive cycle is coarser — only every ~15 min.
  if (count % PROACTIVE_EVERY === 0) {
    // Nudges: let the engine decide; it no-ops when disabled/quiet/capped.
    const res = await post("/api/proactive/evaluate");
    if (res?.sent) console.log(`[proactive-scheduler] nudge sent: ${res.chosen?.id}`);

    // Scheduled per-contact reports (#24): the endpoint sends only those due now.
    const cr = await post("/api/telegram/contact-reports");
    if (cr?.sent) console.log(`[proactive-scheduler] contact reports sent: ${cr.sent}`);

    // Daily report: once per local day, at/after the report hour.
    const { date, hour } = localParts();
    const state = readJson(STATE_PATH, { lastReportDate: null });
    if (hour >= REPORT_HOUR && state.lastReportDate !== date) {
      const r = await post("/api/proactive/report");
      if (r?.sent) {
        writeJson(STATE_PATH, { lastReportDate: date });
        console.log(`[proactive-scheduler] daily report sent for ${date}`);
      } else if (r && r.reason) {
        // Disabled/unpaired: mark the day done anyway so we don't retry all day.
        writeJson(STATE_PATH, { lastReportDate: date });
      }
    }
  }
}

async function main() {
  console.log(`[proactive-scheduler] running (base ${BASE_INTERVAL_MS / 60000} min; proactive every ${PROACTIVE_EVERY}× , report ~${REPORT_HOUR}:00 ${TZ})`);
  let count = 0;
  for (;;) {
    await tick(count);
    count++;
    await sleep(BASE_INTERVAL_MS);
  }
}

main().catch((e) => { console.error("[proactive-scheduler] fatal:", e); process.exit(1); });
