import Database from "better-sqlite3";
import path from "path";
import { dataPath, ensureDir, localDateStr } from "./store";
import { DaySummary, WorkoutSession } from "./types";

/**
 * Local archive of historical health data (data/archive.db, SQLite).
 *
 * Days older than SETTLE_AFTER_DAYS are "settled": their data is final
 * (late watch syncs and the previous night's sleep have all landed), so they
 * are served from here and never refetched from the Google Health API. Today
 * and the last few days are always fetched live; their rows are only written
 * as snapshots (settled = 0) so an API outage can fall back to the last known
 * state instead of demo data. Manual workout edits to a settled date refresh
 * its row via refreshArchivedDay in context.ts.
 */

/** Days that must pass before a civil date is considered final. */
export const SETTLE_AFTER_DAYS = 3;

export interface ArchivedDay {
  date: string;
  summary: DaySummary;
  workouts: WorkoutSession[] | null;
  waterMl: number | null;
  settled: boolean;
  fetchedAt: string;
}

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  ensureDir(path.dirname(dataPath("archive.db")));
  db = new Database(dataPath("archive.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS days (
      date       TEXT PRIMARY KEY,
      summary    TEXT NOT NULL,
      workouts   TEXT,
      water_ml   INTEGER,
      settled    INTEGER NOT NULL DEFAULT 0,
      fetched_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    -- Per-day macro + GL totals for meals synced from Google Health, deduped
    -- against the local food log. Only settled days are stored (their meals are
    -- final), so trends serve them from here instead of refetching the API +
    -- re-estimating GL. Local-log macros are cheap and always recomputed live.
    CREATE TABLE IF NOT EXISTS nutrition_days (
      date       TEXT PRIMARY KEY,
      protein_g  REAL,
      carbs_g    REAL,
      fat_g      REAL,
      gl         REAL,
      fetched_at TEXT NOT NULL
    );
  `);
  return db;
}

/** True once `date` is old enough that its data can no longer change. */
export function isSettledDate(date: string, today = localDateStr()): boolean {
  return date <= addDays(today, -SETTLE_AFTER_DAYS);
}

function addDays(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function rowToDay(r: any): ArchivedDay {
  return {
    date: r.date,
    summary: JSON.parse(r.summary),
    workouts: r.workouts ? JSON.parse(r.workouts) : null,
    waterMl: r.water_ml,
    settled: Boolean(r.settled),
    fetchedAt: r.fetched_at,
  };
}

export function getArchivedDay(date: string): ArchivedDay | null {
  try {
    const r = getDb().prepare("SELECT * FROM days WHERE date = ?").get(date);
    return r ? rowToDay(r) : null;
  } catch (e) {
    console.error("Archive read failed:", e);
    return null;
  }
}

export function getArchivedRange(start: string, endInclusive: string): Map<string, ArchivedDay> {
  const out = new Map<string, ArchivedDay>();
  try {
    const rows = getDb()
      .prepare("SELECT * FROM days WHERE date >= ? AND date <= ? ORDER BY date")
      .all(start, endInclusive);
    for (const r of rows) {
      const d = rowToDay(r);
      out.set(d.date, d);
    }
  } catch (e) {
    console.error("Archive range read failed:", e);
  }
  return out;
}

/** Insert or update a day. Omitted workouts/waterMl keep their stored value. */
export function upsertDay(
  date: string,
  data: {
    summary: DaySummary;
    workouts?: WorkoutSession[];
    waterMl?: number | null;
    settled: boolean;
  }
) {
  try {
    getDb()
      .prepare(
        `INSERT INTO days (date, summary, workouts, water_ml, settled, fetched_at)
         VALUES (@date, @summary, @workouts, @waterMl, @settled, @fetchedAt)
         ON CONFLICT(date) DO UPDATE SET
           summary    = excluded.summary,
           workouts   = COALESCE(excluded.workouts, days.workouts),
           water_ml   = COALESCE(excluded.water_ml, days.water_ml),
           settled    = excluded.settled,
           fetched_at = excluded.fetched_at`
      )
      .run({
        date,
        summary: JSON.stringify(data.summary),
        workouts: data.workouts ? JSON.stringify(data.workouts) : null,
        waterMl: data.waterMl ?? null,
        settled: data.settled ? 1 : 0,
        fetchedAt: new Date().toISOString(),
      });
  } catch (e) {
    console.error("Archive write failed:", e);
  }
}

// -- Nutrition (remote macro totals) ------------------------------

/** Per-day totals of macros + GL from synced (Google Health) meals. */
export interface NutritionTotals {
  p: number | null;
  c: number | null;
  f: number | null;
  gl: number | null;
}

export function getArchivedNutrition(start: string, endInclusive: string): Map<string, NutritionTotals> {
  const out = new Map<string, NutritionTotals>();
  try {
    const rows = getDb()
      .prepare("SELECT * FROM nutrition_days WHERE date >= ? AND date <= ?")
      .all(start, endInclusive) as any[];
    for (const r of rows) out.set(r.date, { p: r.protein_g, c: r.carbs_g, f: r.fat_g, gl: r.gl });
  } catch (e) {
    console.error("Nutrition archive read failed:", e);
  }
  return out;
}

/** Store one settled day's synced-meal totals (null fields stay null). */
export function upsertNutrition(date: string, t: NutritionTotals) {
  try {
    getDb()
      .prepare(
        `INSERT INTO nutrition_days (date, protein_g, carbs_g, fat_g, gl, fetched_at)
         VALUES (@date, @p, @c, @f, @gl, @fetchedAt)
         ON CONFLICT(date) DO UPDATE SET
           protein_g  = excluded.protein_g,
           carbs_g    = excluded.carbs_g,
           fat_g      = excluded.fat_g,
           gl         = excluded.gl,
           fetched_at = excluded.fetched_at`
      )
      .run({ date, p: t.p, c: t.c, f: t.f, gl: t.gl, fetchedAt: new Date().toISOString() });
  } catch (e) {
    console.error("Nutrition archive write failed:", e);
  }
}

/** Settled archived workouts overlapping [start, end], grouped per date. */
export function getArchivedWorkouts(start: string, endInclusive: string): WorkoutSession[] {
  const out: WorkoutSession[] = [];
  for (const d of getArchivedRange(start, endInclusive).values()) {
    if (d.settled && d.workouts) out.push(...d.workouts);
  }
  return out;
}

// -- Coverage / backfill progress ---------------------------------

export interface BackfillState {
  target: string; // oldest date to reach (inclusive)
  cursor: string; // next date to process, walking backward; done when < target
  startedAt: string;
}

export function getBackfillState(): BackfillState | null {
  try {
    const r = getDb().prepare("SELECT value FROM meta WHERE key = 'backfill'").get() as
      | { value: string }
      | undefined;
    return r ? (JSON.parse(r.value) as BackfillState) : null;
  } catch {
    return null;
  }
}

export function setBackfillState(state: BackfillState | null) {
  try {
    if (state === null) {
      getDb().prepare("DELETE FROM meta WHERE key = 'backfill'").run();
    } else {
      getDb()
        .prepare(
          "INSERT INTO meta (key, value) VALUES ('backfill', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        )
        .run(JSON.stringify(state));
    }
  } catch (e) {
    console.error("Backfill state write failed:", e);
  }
}

export function archiveCoverage(): { days: number; oldest: string | null; newest: string | null } {
  try {
    const r = getDb()
      .prepare("SELECT COUNT(*) AS n, MIN(date) AS oldest, MAX(date) AS newest FROM days WHERE settled = 1")
      .get() as { n: number; oldest: string | null; newest: string | null };
    return { days: r.n, oldest: r.oldest, newest: r.newest };
  } catch {
    return { days: 0, oldest: null, newest: null };
  }
}
