// Local exercise library sourced from wger (https://wger.de). wger's exercise
// DATABASE is CC-BY-SA 4.0; we download it ONCE on explicit opt-in, store it
// locally (pinned), and attribute it. We never vendor wger's AGPL CODE and never
// depend on wger.de at runtime — the only network call is the user-triggered
// download/refresh. User-created exercises live in a SEPARATE store so a refresh
// (merge by stable UUID) never clobbers them. Mirrors the workout-overrides
// side-store pattern.

import fs from "fs";
import path from "path";
import { readJson, writeJson, newId, dataPath, ensureDir } from "./store";

const IMAGE_DIR = "exercise-images"; // under data/ (gitignored)
const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp"];

export const WGER_ATTRIBUTION = "Exercise data © wger.de contributors, licensed CC-BY-SA 4.0";
const WGER_API = "https://wger.de/api/v2/exerciseinfo/?language=2&limit=100&format=json";
const MAX_PAGES = 8; // cap the one-time pull (~800 exercises) to stay bounded

const LIBRARY = "exercise-library.json"; // downloaded wger data (pinned)
const CUSTOM = "custom-exercises.json"; // user-created, never touched by refresh

export interface LibraryExercise {
  uuid: string; // stable id; wger uuid or a generated one for custom
  name: string;
  category?: string;
  muscles: string[];
  equipment: string[];
  source: "wger" | "custom";
  image?: string; // main image URL on wger (remote)
  images?: string[]; // all image URLs (main first) — secondary ones lazy-load from wger
  imageLocal?: boolean; // true when the main image has been downloaded under data/ for offline use
}

interface LibraryFile {
  downloadedAt: string;
  attribution: string;
  count: number;
  exercises: LibraryExercise[];
}

export function getLibraryMeta(): {
  downloaded: boolean;
  downloadedAt: string | null;
  count: number;
  customCount: number;
  imagesAvailable: number; // exercises with a wger image
  imagesLocal: number; // main images downloaded for offline
} {
  const lib = readJson<LibraryFile | null>(LIBRARY, null);
  const custom = readJson<LibraryExercise[]>(CUSTOM, []);
  const exercises = lib?.exercises ?? [];
  return {
    downloaded: !!lib,
    downloadedAt: lib?.downloadedAt ?? null,
    count: exercises.length,
    customCount: custom.length,
    imagesAvailable: exercises.filter((e) => e.image).length,
    imagesLocal: exercises.filter((e) => e.imageLocal).length,
  };
}

/** wger exercises + user-created ones, custom first. */
export function getLibrary(): LibraryExercise[] {
  const lib = readJson<LibraryFile | null>(LIBRARY, null);
  const custom = readJson<LibraryExercise[]>(CUSTOM, []);
  return [...custom, ...(lib?.exercises ?? [])];
}

export function getExerciseByUuid(uuid: string): LibraryExercise | null {
  return getLibrary().find((e) => e.uuid === uuid) ?? null;
}

export function searchLibrary(query: string, limit = 20): LibraryExercise[] {
  const q = query.trim().toLowerCase();
  if (!q) return getLibrary().slice(0, limit);
  return getLibrary()
    .filter((e) => e.name.toLowerCase().includes(q) || e.muscles.some((m) => m.toLowerCase().includes(q)))
    .slice(0, limit);
}

// ── custom exercises (separate store) ───────────────────────────────────────
export function addCustomExercise(input: { name: string; category?: string; muscles?: string[]; equipment?: string[] }): LibraryExercise | { error: string } {
  const name = String(input.name ?? "").trim();
  if (!name) return { error: "name required" };
  const ex: LibraryExercise = {
    uuid: `custom-${newId()}`,
    name: name.slice(0, 80),
    category: input.category ? String(input.category).slice(0, 40) : undefined,
    muscles: Array.isArray(input.muscles) ? input.muscles.map(String).slice(0, 12) : [],
    equipment: Array.isArray(input.equipment) ? input.equipment.map(String).slice(0, 12) : [],
    source: "custom",
  };
  const custom = readJson<LibraryExercise[]>(CUSTOM, []);
  custom.push(ex);
  writeJson(CUSTOM, custom);
  return ex;
}

export function deleteCustomExercise(uuid: string): boolean {
  const custom = readJson<LibraryExercise[]>(CUSTOM, []);
  const next = custom.filter((e) => e.uuid !== uuid);
  if (next.length === custom.length) return false;
  writeJson(CUSTOM, next);
  return true;
}

// ── one-time download / refresh ─────────────────────────────────────────────
function mapWger(r: any): LibraryExercise | null {
  const uuid = typeof r?.uuid === "string" ? r.uuid : null;
  if (!uuid) return null;
  // English name from translations (language id 2), else any available.
  const translations: any[] = Array.isArray(r.translations) ? r.translations : [];
  const en = translations.find((t) => t?.language === 2 && t?.name) ?? translations.find((t) => t?.name);
  const name = (en?.name ?? r.name ?? "").trim();
  if (!name) return null;

  // Images: main first, then the rest (deduped).
  const imgObjs: any[] = Array.isArray(r.images) ? r.images : [];
  const mainUrl = (imgObjs.find((im) => im?.is_main)?.image ?? imgObjs[0]?.image) || undefined;
  const images = [...new Set([mainUrl, ...imgObjs.map((im) => im?.image)].filter(Boolean) as string[])];

  return {
    uuid,
    name: name.slice(0, 80),
    category: r.category?.name ? String(r.category.name) : undefined,
    muscles: [
      ...(Array.isArray(r.muscles) ? r.muscles : []),
      ...(Array.isArray(r.muscles_secondary) ? r.muscles_secondary : []),
    ]
      .map((m: any) => m?.name_en || m?.name)
      .filter(Boolean)
      .slice(0, 12),
    equipment: (Array.isArray(r.equipment) ? r.equipment : []).map((e: any) => e?.name).filter(Boolean).slice(0, 12),
    source: "wger",
    image: mainUrl,
    images: images.length ? images.slice(0, 6) : undefined,
  };
}

// ── offline main-image download + serving ───────────────────────────────────
function localImagePath(uuid: string): string | null {
  for (const ext of IMAGE_EXTS) {
    const p = dataPath(IMAGE_DIR, `${uuid}.${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Resolve a uuid to a downloaded local image (bytes + content-type), or null. */
export function readLocalImage(uuid: string): { buffer: Buffer; contentType: string } | null {
  const p = localImagePath(uuid);
  if (!p) return null;
  const ext = path.extname(p).slice(1).toLowerCase();
  const contentType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/png";
  return { buffer: fs.readFileSync(p), contentType };
}

/** Remote main-image URL for a uuid (for the lazy/redirect fallback). */
export function remoteImageUrl(uuid: string): string | null {
  const ex = getLibrary().find((e) => e.uuid === uuid);
  return ex?.image ?? null;
}

/**
 * Download main images for offline use (resumable — skips ones already saved).
 * Secondary images are NOT downloaded; they lazy-load from wger when online.
 * Capped per call so the request stays bounded; click again to finish stragglers.
 */
export async function downloadImages(cap = 500): Promise<{ ok: boolean; downloaded: number; remaining: number; localTotal: number }> {
  const lib = readJson<LibraryFile | null>(LIBRARY, null);
  if (!lib) return { ok: false, downloaded: 0, remaining: 0, localTotal: 0 };
  ensureDir(dataPath(IMAGE_DIR));

  const pending = lib.exercises.filter((e) => e.image && !e.imageLocal && !localImagePath(e.uuid));
  const batch = pending.slice(0, cap);
  let downloaded = 0;
  const CONC = 6;
  for (let i = 0; i < batch.length; i += CONC) {
    await Promise.all(
      batch.slice(i, i + CONC).map(async (e) => {
        try {
          const res = await fetch(e.image!, { headers: { "User-Agent": "HealthTrack/0.1 (personal health dashboard)" } });
          if (!res.ok) return;
          const buf = Buffer.from(await res.arrayBuffer());
          const ext = (e.image!.split("?")[0].split(".").pop() || "png").toLowerCase();
          const safeExt = IMAGE_EXTS.includes(ext) ? ext : "png";
          fs.writeFileSync(dataPath(IMAGE_DIR, `${e.uuid}.${safeExt}`), buf);
          e.imageLocal = true;
          downloaded++;
        } catch {
          // skip a failed image; resumable on next run
        }
      })
    );
  }
  writeJson(LIBRARY, lib);
  const localTotal = lib.exercises.filter((e) => e.imageLocal).length;
  const remaining = lib.exercises.filter((e) => e.image && !e.imageLocal).length;
  return { ok: true, downloaded, remaining, localTotal };
}

/**
 * Download (or refresh) the wger library. Refresh MERGES by uuid — existing
 * entries are updated in place, new ones added; user-created exercises are in a
 * separate store and untouched. Returns the resulting count, or an error.
 */
export async function downloadLibrary(): Promise<{ ok: true; count: number; downloadedAt: string } | { ok: false; error: string }> {
  const fetched: LibraryExercise[] = [];
  let url: string | null = WGER_API;
  let pages = 0;
  try {
    while (url && pages < MAX_PAGES) {
      const res: Response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "HealthTrack/0.1 (personal health dashboard)" } });
      if (!res.ok) {
        if (pages === 0) return { ok: false, error: `wger responded ${res.status}` };
        break;
      }
      const json: any = await res.json();
      for (const r of json?.results ?? []) {
        const ex = mapWger(r);
        if (ex) fetched.push(ex);
      }
      url = typeof json?.next === "string" ? json.next : null;
      pages++;
    }
  } catch (e: any) {
    return { ok: false, error: `couldn't reach wger.de — ${String(e?.message ?? e)}` };
  }
  if (!fetched.length) return { ok: false, error: "no exercises returned" };

  // Merge by uuid with any existing library (refresh updates in place).
  const existing = readJson<LibraryFile | null>(LIBRARY, null);
  const byUuid = new Map<string, LibraryExercise>();
  for (const e of existing?.exercises ?? []) byUuid.set(e.uuid, e);
  for (const e of fetched) byUuid.set(e.uuid, e);

  const exercises = [...byUuid.values()].sort((a, b) => a.name.localeCompare(b.name));
  const file: LibraryFile = {
    downloadedAt: new Date().toISOString(),
    attribution: WGER_ATTRIBUTION,
    count: exercises.length,
    exercises,
  };
  writeJson(LIBRARY, file);
  return { ok: true, count: exercises.length, downloadedAt: file.downloadedAt };
}
