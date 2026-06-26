// Dev launcher: runs the Next dev server and the Telegram long-poll bridge
// together, so `npm run dev` brings the bot online automatically. The bridge
// no-ops (and waits) until a bot token is configured in Settings, so this is
// harmless before Telegram is set up. Use `npm run dev:next` for Next alone.

import { spawn } from "child_process";

const procs = [
  // npm is a .cmd on Windows so it needs the shell; the node workers are spawned
  // directly via the current node binary (no shell — its path has spaces).
  { name: "next", cmd: "npm", args: ["run", "dev:next"], shell: process.platform === "win32" },
  { name: "telegram", cmd: process.execPath, args: ["scripts/telegram-bridge.mjs"], shell: false },
  { name: "proactive", cmd: process.execPath, args: ["scripts/proactive-scheduler.mjs"], shell: false },
];

const children = procs.map(({ name, cmd, args, shell }) => {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    shell,
    env: process.env,
  });
  child.on("exit", (code) => {
    console.log(`[dev] ${name} exited (${code}); shutting down.`);
    shutdown();
  });
  return child;
});

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
