#!/usr/bin/env node
// Pre-run sanity checks: required files, Node version, port availability,
// and common config mistakes. Exits non-zero if anything is wrong.
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3210;
const problems = [];
const log = (m) => console.log(`[preflight] ${m}`);

// Node version.
const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  problems.push(`Node ${process.versions.node} is too old — use Node 20 or newer (LTS 20, 22, 24).`);
}

// Dependencies installed.
if (!existsSync(join(root, "node_modules"))) {
  problems.push("node_modules/ missing — run `npm run setup` (or `npm install`).");
}

// .env.local present (demo mode still works without it, so this is a warning).
if (!existsSync(join(root, ".env.local"))) {
  log("note: .env.local missing — the app will run in demo mode. `npm run setup` creates it.");
}

// data/ directory.
if (!existsSync(join(root, "data"))) {
  log("note: data/ missing — it will be created on first run.");
}

// Port availability.
await new Promise((resolve) => {
  const srv = createServer();
  srv.once("error", (err) => {
    if (err.code === "EADDRINUSE") problems.push(`port ${PORT} is already in use.`);
    resolve();
  });
  srv.once("listening", () => srv.close(resolve));
  srv.listen(PORT, "127.0.0.1");
});

if (problems.length) {
  console.error("[preflight] FAILED:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
log("all checks passed.");
