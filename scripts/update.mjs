#!/usr/bin/env node
// Update dependencies and rebuild without touching user data.
// Preserves .env.local and data/. Cross-platform, no external deps.
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const log = (m) => console.log(`[update] ${m}`);

// .env.local and data/ are gitignored and are never modified here; this
// script only refreshes installed packages and the build output.
const cmd = existsSync(join(root, "package-lock.json")) ? "npm ci" : "npm install";
log(`refreshing dependencies (${cmd})...`);
execSync(cmd, { cwd: root, stdio: "inherit" });

log("building...");
execSync("npm run build", { cwd: root, stdio: "inherit" });

log("done. Your .env.local and data/ were left untouched.");
