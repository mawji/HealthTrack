import fs from "fs";
import path from "path";

// Single-user local app: persistence is plain JSON files under data/.
// HEALTHTRACK_DATA_DIR overrides the location so a second instance (e.g. a
// disconnected demo server for screenshots/guides) can run against an isolated
// data dir without touching the primary install. Defaults to <cwd>/data.
const DATA_DIR = process.env.HEALTHTRACK_DATA_DIR || path.join(process.cwd(), "data");

export function dataPath(...parts: string[]) {
  return path.join(DATA_DIR, ...parts);
}

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(dataPath(file), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, value: unknown) {
  ensureDir(DATA_DIR);
  const full = dataPath(file);
  ensureDir(path.dirname(full));
  fs.writeFileSync(full, JSON.stringify(value, null, 2), "utf8");
}

export function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Timezone the user's health data lives in (device timezone, not server). */
export const APP_TZ = process.env.APP_TZ || "Asia/Dubai";

/** Current local date + clock time for the coach prompt, e.g.
 *  "Monday 2026-06-29 21:27 (Asia/Dubai)". Unlike localDateStr this includes the
 *  time and weekday, so the coach can resolve relative times ("in an hour",
 *  "tonight") and weekly days when setting reminders. */
export function localDateTimeStr(d = new Date(), timeZone = APP_TZ): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${g("weekday")} ${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")} (${timeZone})`;
  } catch {
    return localDateStr(d, timeZone);
  }
}

export function localDateStr(d = new Date(), timeZone = APP_TZ): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(d);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    return `${y}-${m}-${day}`;
  } catch {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const r = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${r}`;
  }
}

