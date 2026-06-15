import { isConnected, fetchRemoteFood } from "./googlehealth";
import { complete, hasAiKey, parseJsonReply } from "./openrouter";
import { readJson, writeJson, localDateStr } from "./store";
import { FoodEntry, RemoteFoodEntry } from "./types";

function addDays(date: string, n: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Fills glycemicLoad on remote (Google Health) entries by asking the AI to
 * estimate from name + macros, cached by meal signature so each unique meal
 * costs one call ever. Best-effort: missing key or AI failure leaves null.
 */
export async function fillRemoteGl(remote: RemoteFoodEntry[]): Promise<void> {
  if (!remote.length || !hasAiKey()) return;
  const sig = (r: RemoteFoodEntry) => `${r.name.toLowerCase()}|${r.carbsG ?? "?"}|${r.calories}`;
  const cache = readJson<Record<string, number>>("gl-cache.json", {});
  const pending = new Map<string, RemoteFoodEntry>();
  for (const r of remote) {
    const k = sig(r);
    if (cache[k] != null) r.glycemicLoad = cache[k];
    else pending.set(k, r);
  }
  if (!pending.size) return;
  try {
    const list = [...pending.values()].map((r, i) => ({
      i,
      name: r.name,
      calories: r.calories,
      carbsG: r.carbsG,
      proteinG: r.proteinG,
      fatG: r.fatG,
    }));
    const reply = await complete([
      {
        role: "user",
        content:
          `Estimate the glycemic load (GI of the dish × net carbs ÷ 100) for each meal below. ` +
          `Reply with ONLY a JSON object {"gl": [<integer per meal, same order>]}.\n` +
          JSON.stringify(list),
      },
    ]);
    const { gl } = parseJsonReply<{ gl: number[] }>(reply);
    [...pending.keys()].forEach((k, i) => {
      const v = Math.max(0, Math.round(Number(gl?.[i])));
      if (Number.isFinite(v)) cache[k] = v;
    });
    writeJson("gl-cache.json", cache);
    // Apply to every instance — duplicates share one cache signature.
    for (const r of remote) if (r.glycemicLoad == null && cache[sig(r)] != null) r.glycemicLoad = cache[sig(r)];
  } catch (e) {
    console.error("Remote GL estimation failed:", e);
  }
}

/**
 * Meals logged in other apps and synced back from Google Health, over the last
 * `days` calendar days. Deduped against the local food log (API copies of
 * meals this app logged itself are dropped) and GL-filled. Returns [] when
 * Google Health isn't connected or the fetch fails.
 */
export async function getRemoteMeals(local: FoodEntry[], days = 7): Promise<RemoteFoodEntry[]> {
  if (!isConnected()) return [];
  try {
    const end = localDateStr();
    const all = await fetchRemoteFood(addDays(end, -(days - 1)), end);
    // Drop API copies of meals this app logged itself. Primary match is the
    // dataPoint resource name recorded at sync time; the name+kcal+date key
    // covers entries synced before googleName was stored.
    const localNames = new Set(local.map((f) => f.googleName).filter(Boolean));
    const localKeys = new Set(
      local
        .filter((f) => f.syncedToHealth)
        .map((f) => `${f.name.toLowerCase()}|${f.calories}|${localDateStr(new Date(f.loggedAt))}`)
    );
    const remote = all.filter(
      (r) =>
        !(r.googleName && localNames.has(r.googleName)) &&
        !localKeys.has(`${r.name.toLowerCase()}|${r.calories}|${localDateStr(new Date(r.at))}`)
    );
    await fillRemoteGl(remote);
    return remote;
  } catch (e) {
    console.error("Remote food fetch failed:", e);
    return [];
  }
}
