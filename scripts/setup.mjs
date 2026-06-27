#!/usr/bin/env node
// First-run setup: verify Node, install deps, seed .env.local, create data/.
// Cross-platform (Windows + macOS + Linux). No external dependencies.
import { existsSync, copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const log = (m) => console.log(`[setup] ${m}`);

// 1. Node version gate (keep in sync with package.json "engines").
const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.error(
    `[setup] Node ${process.versions.node} is too old. Use Node 20 or newer (LTS lines 20, 22, 24).\n` +
      `        better-sqlite3 is a native module that needs a current Node with prebuilt binaries.`,
  );
  process.exit(1);
}
log(`Node ${process.versions.node} OK`);

// 2. Install dependencies if node_modules is missing.
if (!existsSync(join(root, "node_modules"))) {
  const cmd = existsSync(join(root, "package-lock.json")) ? "npm ci" : "npm install";
  log(`installing dependencies (${cmd})...`);
  execSync(cmd, { cwd: root, stdio: "inherit" });
} else {
  log("dependencies already installed");
}

// 3. Seed .env.local from the template if absent (never overwrite).
const envLocal = join(root, ".env.local");
const envExample = join(root, ".env.example");
if (!existsSync(envLocal) && existsSync(envExample)) {
  copyFileSync(envExample, envLocal);
  log("created .env.local from .env.example (edit it to add optional credentials)");
} else if (existsSync(envLocal)) {
  log(".env.local already exists, leaving it untouched");
}

// 4. Ensure the local data directory exists (gitignored, holds user data).
const dataDir = join(root, "data");
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
  log("created data/ directory");
}

log("done. Run `npm run build` then `npm run start`, and open http://localhost:3210");
log("(Or `npm run dev` for a hot-reloading dev server if you're modifying the code.)");
log("No credentials? The app boots into demo mode with realistic sample data.");
