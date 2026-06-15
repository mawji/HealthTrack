#!/usr/bin/env node
// Back up the data/ directory to a timestamped copy under backups/.
// Cross-platform recursive copy using only Node builtins.
import { existsSync, mkdirSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const log = (m) => console.log(`[backup] ${m}`);

const dataDir = join(root, "data");
if (!existsSync(dataDir)) {
  log("no data/ directory yet — nothing to back up.");
  process.exit(0);
}

// e.g. 2026-06-16T14-32-05
const stamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
const dest = join(root, "backups", `data-${stamp}`);
mkdirSync(dirname(dest), { recursive: true });

cpSync(dataDir, dest, { recursive: true });
log(`copied data/ -> ${dest}`);
log("backups/ is gitignored, so backups never leave your machine.");
