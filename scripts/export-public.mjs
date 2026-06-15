#!/usr/bin/env node
// Export an allowlisted, sanitized copy of this repo to a separate public
// repo folder for manual review and release. One-way: HealthTrack-dev -> HealthTrack.
//
//   node scripts/export-public.mjs --out ../HealthTrack [--dry-run]
//
// It NEVER pushes and NEVER touches the private repo. It copies only files on
// the allowlist, refuses forbidden paths, and aborts if a secret-like pattern
// is found in any file it would publish.
import {
  existsSync, mkdirSync, copyFileSync, readFileSync, readdirSync, statSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : join(root, "..", "HealthTrack");

// Files/dirs safe to publish. Directories are copied recursively, minus DENY.
const ALLOW = [
  "app", "components", "lib", "scripts", "public", ".github",
  "package.json", "package-lock.json", "tsconfig.json", "next.config.ts",
  ".gitignore", ".env.example", "README.md", "LICENSE",
  // Demo-mode showcase screenshots go here once captured. Real-data
  // screenshots must NEVER be added to this allowlist.
  // e.g. "docs/screenshots/today.png",
];

// Never published, even if nested inside an allowlisted directory.
const DENY = [
  "data", ".env.local", ".next", "node_modules", ".codegraph", "plans",
  "todo.md", ".claude", "backups", "logs", ".playwright-mcp", ".git",
];

// Real-secret patterns (placeholders in .env.example use "..." / "…" / "_here"
// and intentionally do NOT match these).
const SECRET_PATTERNS = [
  [/sk-or-v1-[A-Za-z0-9]{20,}/, "OpenRouter key"],
  [/sk-proj-[A-Za-z0-9_-]{20,}/, "OpenAI project key"],
  [/sk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic key"],
  [/AIza[0-9A-Za-z_-]{30,}/, "Google API key"],
  [/GOCSPX-[A-Za-z0-9_-]{10,}/, "Google OAuth client secret"],
  [/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, "private key block"],
  [/ya29\.[A-Za-z0-9_-]{20,}/, "Google OAuth access token"],
];
const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|json|md|css|txt|yml|yaml|env|example|html)$/i;

const log = (m) => console.log(`[export] ${m}`);
const isDenied = (rel) => rel.split(sep).some((part) => DENY.includes(part));

function walk(abs) {
  const out = [];
  for (const entry of readdirSync(abs)) {
    const childAbs = join(abs, entry);
    const rel = relative(root, childAbs);
    if (isDenied(rel)) continue;
    if (statSync(childAbs).isDirectory()) out.push(...walk(childAbs));
    else out.push(childAbs);
  }
  return out;
}

// 1. Resolve the allowlist into a concrete file list.
const files = [];
for (const item of ALLOW) {
  const abs = join(root, item);
  if (!existsSync(abs)) continue; // optional entries (e.g. public/) may be absent
  if (statSync(abs).isDirectory()) files.push(...walk(abs));
  else files.push(abs);
}

// 2. Scan every publishable text file for secrets.
const violations = [];
for (const abs of files) {
  if (!TEXT_EXT.test(abs)) continue;
  const text = readFileSync(abs, "utf8");
  for (const [re, label] of SECRET_PATTERNS) {
    if (re.test(text)) violations.push(`${relative(root, abs)} — looks like a ${label}`);
  }
}

if (violations.length) {
  console.error("[export] ABORTED — secret-like content found in files that would be published:");
  for (const v of violations) console.error(`  - ${v}`);
  console.error("[export] Nothing was copied. Remove the secrets and re-run.");
  process.exit(1);
}

// 3. Copy (or, with --dry-run, just list).
log(`source: ${root}`);
log(`target: ${outDir}`);
log(`${files.length} files to ${dryRun ? "publish (dry run)" : "copy"}:`);
for (const abs of files) {
  const rel = relative(root, abs);
  console.log(`  ${rel}`);
  if (!dryRun) {
    const dest = join(outDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(abs, dest);
  }
}

if (dryRun) {
  log("dry run complete — no files written.");
} else {
  log("copy complete.");
  log(`Next: cd "${outDir}" && git status — review the diff, then commit and push manually.`);
}
