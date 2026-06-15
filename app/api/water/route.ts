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

function todayEntries(): WaterEntry[] {
  const all = readJson<WaterEntry[]>(FILE, []);
  const today = localDateStr();
  return all.filter((e) => localDateStr(new Date(e.at)) === today);
}

async function total(): Promise<{ ml: number; glasses: number; synced: boolean }> {
  const local = todayEntries();
  // Synced entries come back inside the API total; unsynced ones don't.
  const unsyncedMl = local.filter((e) => !e.googleName).reduce((a, e) => a + e.ml, 0);
  if (isConnected()) {
    const remote = await fetchWaterTotal(localDateStr());
    if (remote !== null) {
      const ml = remote + unsyncedMl;
      return { ml, glasses: Math.round(ml / GLASS_ML), synced: true };
    }
  }
  const ml = local.reduce((a, e) => a + e.ml, 0);
  return { ml, glasses: Math.round(ml / GLASS_ML), synced: false };
}

export async function GET() {
  return NextResponse.json(await total());
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
