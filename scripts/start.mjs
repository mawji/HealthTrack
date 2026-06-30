// Production launcher — the `next start` twin of scripts/dev.mjs, used as the
// Docker container entrypoint. Runs the three processes the app needs together:
//   1. the Next standalone server (node server.js)   — the web app + API
//   2. proactive-scheduler.mjs                        — nudges, med reminders, nightly reflection
//   3. telegram-bridge.mjs                            — the long-poll bot (no-ops without a token)
//
// All three run from the image's WORKDIR (/app) so they read the mounted data
// volume at ./data, exactly like dev. The standalone server honours PORT and
// HOSTNAME from the environment (set in the image / compose).

import { spawn } from "child_process";
import { existsSync } from "fs";

const PORT = process.env.PORT || "3210";
// Workers (scheduler/bridge) call the app over the loopback inside the container,
// NOT the public APP_BASE_URL. APP_BASE_URL must stay the external https URL for
// OAuth redirects, but routing internal calls through it would needlessly bounce
// through Tailscale; 127.0.0.1 is direct and avoids the boot-time race entirely.
const INTERNAL_BASE = `http://127.0.0.1:${PORT}`;
const children = [];

function start(name, cmd, args, extraEnv = {}, shell = false) {
  const child = spawn(cmd, args, { stdio: "inherit", shell, env: { ...process.env, ...extraEnv } });
  child.on("exit", (code) => {
    console.log(`[start] ${name} exited (${code}); shutting down.`);
    shutdown();
  });
  children.push(child);
  return child;
}

// 1) The web server — keeps the inherited (public) APP_BASE_URL for OAuth.
//    In the standalone image server.js sits at /app/server.js; otherwise fall
//    back to `next start` (defensive, non-standalone checkout).
if (existsSync("server.js")) start("next", process.execPath, ["server.js"]);
else start("next", "npx", ["next", "start", "-p", PORT], {}, true);

// 2) Wait for the server to answer, THEN launch the workers pointed at the
//    internal URL — so their first tick never races an unbound server.
async function launchWorkers() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(INTERNAL_BASE + "/")).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  start("proactive", process.execPath, ["scripts/proactive-scheduler.mjs"], { APP_BASE_URL: INTERNAL_BASE });
  start("telegram", process.execPath, ["scripts/telegram-bridge.mjs"], { APP_BASE_URL: INTERNAL_BASE });
}
launchWorkers();

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (!c.killed) c.kill();
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
