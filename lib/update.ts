// In-app update check + one-click Watchtower trigger.
//
// The app compares its own version (baked in from package.json at build) against
// the latest GitHub release, and — in the Docker deployment — can ask the
// Watchtower sidecar to pull + recreate it. The token and Watchtower's address
// reach the app via .env (same file the watchtower service reads). Outside Docker
// (no token) the check still works; "apply" just isn't offered.
import pkg from "@/package.json";

const REPO = process.env.UPDATE_REPO || "mawji/HealthTrack";
const WATCHTOWER_URL = process.env.WATCHTOWER_URL || "http://127.0.0.1:8080/v1/update";
const TTL_MS = 6 * 60 * 60 * 1000; // re-check GitHub at most every 6h

export const CURRENT_VERSION: string = (pkg as { version: string }).version;

export type LatestRelease = { tag: string; url: string; name: string; publishedAt: string | null };

let cache: { at: number; release: LatestRelease | null } | null = null;

function semver(v: string): number[] {
  return v.replace(/^v/, "").split(/[.\-+]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
}

/** true when `a` is a strictly newer semver than `b`. */
export function isNewer(a: string, b: string): boolean {
  const pa = semver(a), pb = semver(b);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

export async function fetchLatest(force = false): Promise<LatestRelease | null> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.release;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "HealthTrack" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) { cache = { at: Date.now(), release: null }; return null; }
    const j = await res.json();
    const release: LatestRelease = {
      tag: String(j.tag_name || ""),
      url: String(j.html_url || ""),
      name: String(j.name || j.tag_name || ""),
      publishedAt: j.published_at ?? null,
    };
    cache = { at: Date.now(), release: release.tag ? release : null };
    return cache.release;
  } catch {
    cache = { at: Date.now(), release: null };
    return null;
  }
}

export function watchtowerConfigured(): boolean {
  return Boolean(process.env.WATCHTOWER_TOKEN);
}

/** Fire the Watchtower update. Not awaited by the caller: Watchtower recreates
 *  this very container mid-request, so the connection drops by design. */
export async function triggerUpdate(): Promise<void> {
  const token = process.env.WATCHTOWER_TOKEN;
  if (!token) return;
  try {
    await fetch(WATCHTOWER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    /* expected — the app is being recreated */
  }
}
