// Telegram long-poll bridge — the only inbound network surface for the bot.
//
// Why a separate worker (not a webhook): HealthTrack is local-first on
// 127.0.0.1, so it has no public HTTPS URL for Telegram to call. Instead this
// worker phones Telegram (getUpdates long-poll, outbound only) and forwards each
// update to the app's own /api/telegram/update endpoint, which holds ALL the
// logic (owner gate, coach, replies). The worker itself stays dumb: poll →
// forward → advance offset. Nothing here is exposed to the internet.
//
// Run: `npm run telegram:bridge` (or auto-started by `npm run dev`).

import fs from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, "data", "telegram", "config.json");
const OFFSET_PATH = path.join(ROOT, "data", "telegram", "bridge-offset.json");
const APP_BASE = process.env.APP_BASE_URL || "http://127.0.0.1:3210";
const POLL_TIMEOUT = 30; // seconds Telegram holds the long-poll open

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

/** Resolve token + bridge secret, generating the secret on first run so the app
 *  (which reads the same file) authenticates the forwarded updates. */
function loadCreds() {
  const cfg = readJson(CONFIG_PATH, {});
  const token = process.env.TELEGRAM_BOT_TOKEN || cfg.botToken;
  if (!cfg.bridgeSecret) {
    cfg.bridgeSecret = crypto.randomBytes(24).toString("hex");
    writeJson(CONFIG_PATH, cfg);
  }
  return { token, secret: cfg.bridgeSecret };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tgCall(token, method, params = {}) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`${method}: ${json.description ?? res.status}`);
  return json.result;
}

async function forward(update, secret) {
  try {
    await fetch(`${APP_BASE}/api/telegram/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bridge-secret": secret },
      body: JSON.stringify(update),
    });
  } catch (e) {
    // App not up yet / transient — log and move on; we've already advanced the
    // offset, so a missed message is preferable to a redelivery storm. (The
    // owner can just resend.)
    console.warn("[telegram-bridge] forward failed:", e.message);
  }
}

async function main() {
  let { token, secret } = loadCreds();

  // Wait for a token to be configured (via Settings) before polling.
  while (!token) {
    console.log("[telegram-bridge] no bot token yet — waiting (set it in Settings → Telegram)…");
    await sleep(10000);
    ({ token, secret } = loadCreds());
  }

  // getUpdates and webhooks are mutually exclusive — drop any stale webhook.
  try {
    await tgCall(token, "deleteWebhook", { drop_pending_updates: false });
    const me = await tgCall(token, "getMe");
    console.log(`[telegram-bridge] polling as @${me.username}`);
  } catch (e) {
    console.error("[telegram-bridge] startup check failed:", e.message);
  }

  let offset = readJson(OFFSET_PATH, { offset: 0 }).offset;

  for (;;) {
    try {
      const updates = await tgCall(token, "getUpdates", {
        offset,
        timeout: POLL_TIMEOUT,
        allowed_updates: ["message", "callback_query"],
      });
      for (const update of updates) {
        await forward(update, secret);
        offset = update.update_id + 1;
        writeJson(OFFSET_PATH, { offset });
      }
    } catch (e) {
      console.warn("[telegram-bridge] poll error:", e.message);
      await sleep(5000); // back off on transient errors / 409 conflicts
      // Re-read creds in case the token changed.
      ({ token, secret } = loadCreds());
    }
  }
}

main().catch((e) => {
  console.error("[telegram-bridge] fatal:", e);
  process.exit(1);
});
