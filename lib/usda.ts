// USDA FoodData Central (FDC) client: search generic/branded foods and map them
// to the app's FoodAnalysis + FoodProvenance shapes, reusing the same serving-
// rescale contract as the barcode path. FDC fixes macro DENSITY (per 100 g);
// the portion stays an editable estimate.
//
// Key: process.env.USDA_FDC_API_KEY, falling back to api.data.gov's shared
// DEMO_KEY (heavily rate-limited — fine for trying it out, swap in a free key
// for real use). FDC data is U.S. public domain; cite "USDA FoodData Central".

import { readJson, writeJson } from "./store";
import { FoodAnalysis, FoodProvenance } from "./types";
import { resolveGi, glycemicLoad } from "./glycemic-index";

const SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search";
const CACHE = "fdc-cache.json";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

function apiKey(): string {
  return process.env.USDA_FDC_API_KEY || "DEMO_KEY";
}

export function usingDemoKey(): boolean {
  return !process.env.USDA_FDC_API_KEY;
}

/** Resolved food in the same shape the composer uses for barcode results. */
export interface FdcResolved {
  analysis: FoodAnalysis; // scaled to the default serving (or 100 g)
  per100g: { calories: number; proteinG: number; carbsG: number; fatG: number };
  servingG: number | null;
}

export interface FdcCandidate extends FdcResolved {
  fdcId: number;
  label: string; // list display: description + brand + data type
  dataType: string;
}

interface CacheRow {
  fetchedAt: number;
  candidates: FdcCandidate[];
}

const round = (n: number) => Math.round(n * 10) / 10;

// FDC nutrient ids for the macros we track.
const N = { energyKcal: 1008, protein: 1003, fat: 1004, carbs: 1005 };

function nutrient(food: any, id: number): number | null {
  const arr = food?.foodNutrients;
  if (!Array.isArray(arr)) return null;
  for (const n of arr) {
    // search results use nutrientId; some shapes nest under .nutrient.id
    const nid = n.nutrientId ?? n.nutrient?.id;
    if (nid === id) {
      const v = n.value ?? n.amount;
      const num = typeof v === "string" ? Number(v) : v;
      if (typeof num === "number" && Number.isFinite(num)) return num;
    }
  }
  return null;
}

function mapFood(food: any): FdcCandidate | null {
  const cal = nutrient(food, N.energyKcal);
  if (cal == null) return null; // nothing loggable

  const per100g = {
    calories: round(cal),
    proteinG: round(nutrient(food, N.protein) ?? 0),
    carbsG: round(nutrient(food, N.carbs) ?? 0),
    fatG: round(nutrient(food, N.fat) ?? 0),
  };

  // Branded foods carry a gram serving size; generic foods don't (default 100 g).
  const servingUnit = String(food.servingSizeUnit ?? "").toLowerCase();
  const servingG = servingUnit === "g" && Number(food.servingSize) > 0 ? round(Number(food.servingSize)) : null;
  const factor = servingG ? servingG / 100 : 1;

  const brand = (food.brandOwner || food.brandName || "").trim() || undefined;
  const desc = String(food.description ?? "").trim() || `FDC ${food.fdcId}`;
  const name = brand && !desc.toLowerCase().includes(brand.toLowerCase()) ? `${desc} (${brand})` : desc;
  const dataType = String(food.dataType ?? "");

  const provenance: FoodProvenance = {
    source: "fdc",
    sourceLabel: "USDA FoodData Central",
    sourceUrl: `https://fdc.nal.usda.gov/food-details/${food.fdcId}/nutrients`,
    attribution: "Source: USDA FoodData Central",
    brand,
    servingG: servingG ?? undefined,
    portionEstimated: true,
  };

  const servingText = servingG ? `${servingG} g` : "100 g";
  const analysis: FoodAnalysis = {
    name,
    calories: Math.round(per100g.calories * factor),
    proteinG: round(per100g.proteinG * factor),
    carbsG: round(per100g.carbsG * factor),
    fatG: round(per100g.fatG * factor),
    glycemicLoad: 0, // set below when a curated GI applies
    confidence: "high", // macro density is reference-grade; portion is the estimate
    notes: `Macros from USDA FoodData Central (${dataType || "FDC"}, per ${servingText}). Adjust the serving to match what you ate.`,
    provenance,
  };

  // Source-backed glycemic load when the food matches the curated GI set.
  const gi = resolveGi(desc);
  if (gi) {
    analysis.glycemicLoad = glycemicLoad(gi.gi, analysis.carbsG);
    provenance.gi = gi.gi;
    provenance.giSource = gi.source;
    analysis.notes += ` Glycemic load from GI ${gi.gi} (${gi.label}, ${gi.source}).`;
  }

  return { fdcId: Number(food.fdcId), label: `${name} · ${dataType}`, dataType, analysis, per100g, servingG };
}

/**
 * Search FDC for a food name. Generic data types first (Foundation, SR Legacy,
 * Survey/FNDDS), then Branded. Cached locally for 14 days. Returns [] on no
 * match or API error (caller falls back to the model estimate).
 */
export async function searchFoods(query: string, limit = 8): Promise<FdcCandidate[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const cache = readJson<Record<string, CacheRow>>(CACHE, {});
  const cached = cache[q];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.candidates.slice(0, limit);

  let candidates: FdcCandidate[] = [];
  try {
    const params = new URLSearchParams({
      api_key: apiKey(),
      query,
      pageSize: "25",
      dataType: "Foundation,SR Legacy,Survey (FNDDS),Branded",
    });
    const res = await fetch(`${SEARCH_URL}?${params}`, { headers: { Accept: "application/json" } });
    if (res.ok) {
      const json = await res.json();
      const foods: any[] = Array.isArray(json?.foods) ? json.foods : [];
      candidates = foods.map(mapFood).filter((c): c is FdcCandidate => !!c);
      // Generic data types first (whole foods over branded novelty items),
      // preserving FDC's relevance order within each tier.
      const tier = (t: string) =>
        ({ Foundation: 0, "SR Legacy": 1, "Survey (FNDDS)": 2 } as Record<string, number>)[t] ?? 3;
      candidates = candidates
        .map((c, i) => ({ c, i }))
        .sort((a, b) => tier(a.c.dataType) - tier(b.c.dataType) || a.i - b.i)
        .map((x) => x.c);
    }
  } catch {
    if (cached) return cached.candidates.slice(0, limit); // serve stale on transient failure
    return [];
  }

  cache[q] = { fetchedAt: Date.now(), candidates };
  writeJson(CACHE, cache);
  return candidates.slice(0, limit);
}
