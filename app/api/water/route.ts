import { NextRequest, NextResponse } from "next/server";
import { readJson, writeJson, newId, localDateStr } from "@/lib/store";
import {
  isConnected,
  fetchWaterTotal,
  logWaterToGoogleHealth,
  deleteDataPoint,
} from "@/lib/googlehealth";
import { WaterEntry } from "@/lib/types";

const FILE = "water-log.json";
const GLASS_ML = 250;

function entriesForDate(date: string): WaterEntry[] {
  const all = readJson<WaterEntry[]>(FILE, []);
  return all.filter((e) => localDateStr(new Date(e.at)) === date);
}

const todayEntries = (): WaterEntry[] => entriesForDate(localDateStr());

async function total(date = localDateStr()): Promise<{ ml: number; glasses: number; synced: boolean }> {
  const local = entriesForDate(date);
  // Synced entries come back inside the API total; unsynced ones don't.
  const unsyncedMl = local.filter((e) => !e.googleName).reduce((a, e) => a + e.ml, 0);
  if (isConnected()) {
    const remote = await fetchWaterTotal(date);
    if (remote !== null) {
      const ml = remote + unsyncedMl;
      return { ml, glasses: Math.round(ml / GLASS_ML), synced: true };
    }
  }
  const ml = local.reduce((a, e) => a + e.ml, 0);
  return { ml, glasses: Math.round(ml / GLASS_ML), synced: false };
}

/** Per-day water totals from the local log (app-logged), newest first. */
function historyByDay(): { date: string; ml: number; glasses: number; lastAt: string }[] {
  const all = readJson<WaterEntry[]>(FILE, []);
  const byDay = new Map<string, { ml: number; lastAt: string }>();
  for (const e of all) {
    const d = localDateStr(new Date(e.at));
    const cur = byDay.get(d) ?? { ml: 0, lastAt: e.at };
    cur.ml += e.ml;
    if (e.at > cur.lastAt) cur.lastAt = e.at;
    byDay.set(d, cur);
  }
  return [...byDay.entries()]
    .map(([date, v]) => ({ date, ml: v.ml, glasses: Math.round(v.ml / GLASS_ML), lastAt: v.lastAt }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("history")) {
    return NextResponse.json({ days: historyByDay() });
  }
  const date = req.nextUrl.searchParams.get("date") || undefined;
  return NextResponse.json(await total(date));
}

/** DELETE ?date=yyyy-MM-dd → clear that day's app-logged water (and the synced
 *  Google copies). Water logged by other apps isn't touched. */
export async function DELETE(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  if (!date) return NextResponse.json({ error: "missing date" }, { status: 400 });
  const all = readJson<WaterEntry[]>(FILE, []);
  const keep: WaterEntry[] = [];
  const remove: WaterEntry[] = [];
  for (const e of all) (localDateStr(new Date(e.at)) === date ? remove : keep).push(e);
  for (const e of remove) {
    if (e.googleName && isConnected()) await deleteDataPoint("hydration-log", e.googleName).catch(() => {});
  }
  writeJson(FILE, keep);
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const { delta } = await req.json(); // +1 / -1 glasses
  const all = readJson<WaterEntry[]>(FILE, []);

  if (Number(delta) > 0) {
    const entry: WaterEntry = { id: newId(), at: new Date().toISOString(), ml: GLASS_ML };
    if (isConnected()) {
      const name = await logWaterToGoogleHealth(GLASS_ML, new Date());
      if (name) entry.googleName = name;
    }
    all.push(entry);
    writeJson(FILE, all);
  } else {
    // Remove the most recent glass logged today through this app. Water
    // logged by other apps can't be retracted from here.
    const mine = todayEntries();
    const last = mine[mine.length - 1];
    if (last) {
      if (last.googleName && isConnected()) {
        await deleteDataPoint("hydration-log", last.googleName).catch(() => {});
      }
      writeJson(
        FILE,
        all.filter((e) => e.id !== last.id)
      );
    }
  }

  return NextResponse.json(await total());
}
