#!/usr/bin/env node
// Upgrade to the latest released code, then refresh deps + rebuild.
// Pulls the latest commits (fast-forward only, so it never rewrites local
// work), then runs the same dependency-refresh + rebuild as `npm run update`.
// Preserves .env.local and data/ (both gitignored — never touched here).
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const log = (m) => console.log(`[upgrade] ${m}`);
const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit" });

// 1. Pull the latest code. --ff-only refuses to merge/rewrite, so a clone with
//    no local edits updates cleanly and a modified tree fails loudly instead of
//    creating a surprise merge commit.
if (!existsSync(join(root, ".git"))) {
  console.error("[upgrade] no .git directory here — clone the repo with git to use upgrade.");
  process.exit(1);
}
log("pulling latest code (git pull --ff-only)...");
try {
  run("git pull --ff-only");
} catch {
  console.error(
    "[upgrade] git pull failed. If you have local changes, commit or stash them first,\n" +
      "          then re-run `npm run upgrade`. Your .env.local and data/ are gitignored and safe.",
  );
  process.exit(1);
}

// 2. Refresh dependencies + rebuild (delegates to the existing update script).
log("refreshing dependencies and rebuilding...");
run("npm run update");

log("done. Restart the app (`npm run start`) to pick up the new build.");
