// Open Food Facts barcode lookup: fetch a packaged product's macros + metadata,
// map to the app's FoodAnalysis + FoodProvenance shapes, and cache results
// locally so repeat scans cost no network. OFF data is ODbL — we attribute it
// and never bundle a derived database into the public repo (data/ is gitignored).
//
// API: GET https://world.openfoodfacts.org/api/v2/product/{barcode}.json — no
// key, but a descriptive User-Agent is requested by OFF.

import { readJson, writeJson } from "./store";
import { FoodAnalysis, FoodProvenance } from "./types";
import { resolveGi, glycemicLoad } from "./glycemic-index";

const CACHE = "off-cache.json";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days — packaged-product macros are stable
const USER_AGENT = "HealthTrack/0.1 (local personal health dashboard; https://github.com/shamsmawji/HealthTrack)";

export interface BarcodeResult {
  analysis: FoodAnalysis; // scaled to the default serving (or 100 g if unknown)
  per100g: { calories: number; proteinG: number; carbsG: number; fatG: number } | null;
  servingG: number | null; // default serving the analysis is scaled to
}

interface CacheRow {
  fetchedAt: number;
  result: BarcodeResult | null; // null = looked up, not found (don't re-hit OFF every time)
}

function readCache(): Record<string, CacheRow> {
  return readJson<Record<string, CacheRow>>(CACHE, {});
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Kcal per 100 g from the OFF nutriments block, tolerating the kJ-only case. */
function kcalPer100g(nutr: Record<string, unknown>): number | null {
  const kcal = num(nutr["energy-kcal_100g"]);
  if (kcal != null) return kcal;
  const kj = num(nutr["energy_100g"]) ?? num(nutr["energy-kj_100g"]);
  return kj != null ? kj / 4.184 : null;
}

function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => (typeof t === "string" ? t.replace(/^[a-z]{2}:/, "").replace(/-/g, " ").trim() : ""))
    .filter(Boolean);
}

/** Map a raw OFF product object to our result shape, or null if it has no usable
 *  energy value. */
function mapProduct(barcode: string, product: Record<string, any>): BarcodeResult | null {
  const nutr = (product.nutriments ?? {}) as Record<string, unknown>;
  const cal100 = kcalPer100g(nutr);
  if (cal100 == null) return null; // nothing to log — treat as not found

  const per100g = {
    calories: round(cal100),
    proteinG: round(num(nutr["proteins_100g"]) ?? 0),
    carbsG: round(num(nutr["carbohydrates_100g"]) ?? 0),
    fatG: round(num(nutr["fat_100g"]) ?? 0),
  };

  const servingG = num(product.serving_quantity);
  const factor = servingG && servingG > 0 ? servingG / 100 : 1;
  const scaled = {
    calories: Math.round(per100g.calories * factor),
    proteinG: round(per100g.proteinG * factor),
    carbsG: round(per100g.carbsG * factor),
    fatG: round(per100g.fatG * factor),
  };

  const brand = typeof product.brands === "string" ? product.brands.split(",")[0]?.trim() : undefined;
  const baseName = typeof product.product_name === "string" && product.product_name.trim() ? product.product_name.trim() : `Product ${barcode}`;
  const name = brand && !baseName.toLowerCase().includes(brand.toLowerCase()) ? `${baseName} (${brand})` : baseName;

  const nova = num(product.nova_group);
  const ingredients = typeof product.ingredients_text === "string" && product.ingredients_text.trim() ? product.ingredients_text.trim().slice(0, 600) : undefined;
  const allergens = cleanTags(product.allergens_tags);

  const provenance: FoodProvenance = {
    source: "barcode",
    sourceLabel: "Open Food Facts",
    sourceUrl: `https://world.openfoodfacts.org/product/${barcode}`,
    attribution: "Source: Open Food Facts (ODbL)",
    barcode,
    brand,
    servingG: servingG && servingG > 0 ? round(servingG) : undefined,
    portionEstimated: true, // serving is a default/estimate the user confirms
    nova: nova != null ? Math.round(nova) : undefined,
    ingredients,
    allergens: allergens.length ? allergens : undefined,
  };

  const servingText = product.serving_size && typeof product.serving_size === "string" ? product.serving_size : servingG ? `${round(servingG)} g` : "100 g";
  const analysis: FoodAnalysis = {
    name,
    calories: scaled.calories,
    proteinG: scaled.proteinG,
    carbsG: scaled.carbsG,
    fatG: scaled.fatG,
    glycemicLoad: 0, // set below if a curated GI applies; else stays unavailable
    confidence: "high", // label macros are reliable; portion is the estimate
    notes: `Macros from the product label via Open Food Facts (per ${servingText}). Adjust the serving to match what you ate.`,
    provenance,
  };

  // Source-backed glycemic load when the product name matches the curated GI set
  // (most packaged products won't — GL then stays unavailable, not guessed).
  const gi = resolveGi(baseName);
  if (gi) {
    analysis.glycemicLoad = glycemicLoad(gi.gi, analysis.carbsG);
    provenance.gi = gi.gi;
    provenance.giSource = gi.source;
    analysis.notes += ` Glycemic load from GI ${gi.gi} (${gi.label}, ${gi.source}).`;
  } else {
    analysis.notes += " Glycemic load isn't available for this packaged product.";
  }

  return { analysis, per100g, servingG: servingG && servingG > 0 ? round(servingG) : null };
}

/**
 * Look up a barcode against Open Food Facts, with a local 30-day cache (both hits
 * and misses are cached). Returns null when the product isn't in OFF or has no
 * usable energy value.
 */
export async function lookupBarcode(rawCode: string): Promise<BarcodeResult | null> {
  const barcode = String(rawCode).replace(/\D/g, "");
  if (!barcode || barcode.length < 6 || barcode.length > 14) return null;

  const cache = readCache();
  const cached = cache[barcode];
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.result;

  let result: BarcodeResult | null = null;
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (res.ok) {
      const json = await res.json();
      if (json && json.status === 1 && json.product) {
        result = mapProduct(barcode, json.product);
      }
    }
  } catch {
    // network failure — fall through to caching a miss only if we have nothing
    if (cached) return cached.result; // serve stale on transient failure
    return null;
  }

  cache[barcode] = { fetchedAt: Date.now(), result };
  writeJson(CACHE, cache);
  return result;
}
