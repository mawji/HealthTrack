import { NextRequest, NextResponse } from "next/server";
import { readJson, writeJson, newId } from "@/lib/store";
import { isConnected, logFoodToGoogleHealth } from "@/lib/googlehealth";
import { getRemoteMeals } from "@/lib/remote-food";
import { hasAiKey } from "@/lib/ai-provider";
import { decomposeAndResolve } from "@/lib/food-decompose";
import { FoodAnalysis, FoodComponent, FoodEntry, FoodProvenance, MealType, NutritionSource } from "@/lib/types";

const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "other"];
const NUTRITION_SOURCES: NutritionSource[] = ["photo", "text", "barcode", "fdc", "label", "user", "model", "composite"];

function parseMealType(v: unknown): MealType | undefined {
  return MEAL_TYPES.includes(v as MealType) ? (v as MealType) : undefined;
}

/** Keep only well-formed provenance from the client (it's display-only metadata,
 *  but we still bound the strings and validate the source enum). */
function parseProvenance(v: unknown): FoodProvenance | undefined {
  if (!v || typeof v !== "object") return undefined;
  const p = v as Record<string, unknown>;
  if (!NUTRITION_SOURCES.includes(p.source as NutritionSource)) return undefined;
  const str = (x: unknown, max: number) => (typeof x === "string" && x.trim() ? x.trim().slice(0, max) : undefined);
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
  const out: FoodProvenance = { source: p.source as NutritionSource };
  out.sourceLabel = str(p.sourceLabel, 80);
  out.sourceUrl = str(p.sourceUrl, 300);
  out.attribution = str(p.attribution, 120);
  out.barcode = str(p.barcode, 20);
  out.brand = str(p.brand, 80);
  out.servingG = n(p.servingG);
  out.portionEstimated = typeof p.portionEstimated === "boolean" ? p.portionEstimated : undefined;
  out.gi = n(p.gi);
  out.giSource = str(p.giSource, 80);
  out.nova = n(p.nova);
  out.ingredients = str(p.ingredients, 600);
  out.allergens = Array.isArray(p.allergens)
    ? p.allergens.filter((a): a is string => typeof a === "string").slice(0, 20)
    : undefined;
  return out;
}

/** Keep a well-formed component breakdown from the client (display + provenance
 *  detail). Bounds counts and reuses the provenance validator per component. */
function parseComponents(v: unknown): FoodComponent[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  const out: FoodComponent[] = [];
  for (const raw of v.slice(0, 30)) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const prov = parseProvenance(c.provenance);
    if (!prov) continue; // a component without a valid source isn't loggable provenance
    const per100g =
      c.per100g && typeof c.per100g === "object"
        ? {
            calories: Math.max(0, n((c.per100g as any).calories)),
            proteinG: Math.max(0, n((c.per100g as any).proteinG)),
            carbsG: Math.max(0, n((c.per100g as any).carbsG)),
            fatG: Math.max(0, n((c.per100g as any).fatG)),
          }
        : undefined;
    out.push({
      name: String(c.name ?? "item").slice(0, 120),
      portionG: Math.max(0, n(c.portionG)),
      calories: Math.max(0, Math.round(n(c.calories))),
      proteinG: Math.max(0, n(c.proteinG)),
      carbsG: Math.max(0, n(c.carbsG)),
      fatG: Math.max(0, n(c.fatG)),
      glycemicLoad: c.glycemicLoad != null ? Math.max(0, Math.round(n(c.glycemicLoad))) : undefined,
      per100g,
      fdcId: c.fdcId != null ? n(c.fdcId) : undefined,
      provenance: prov,
    });
  }
  return out.length ? out : undefined;
}

/** Client-chosen timestamp, clamped to valid dates; falls back to now. */
function parseLoggedAt(v: unknown): string {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
}

export async function GET() {
  const local = readJson<FoodEntry[]>("food-log.json", []).slice().reverse();
  // Meals logged in other apps (Fitbit app etc.), synced back from the API.
  const remote = await getRemoteMeals(local);
  return NextResponse.json({ local, remote });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const photo =
    typeof body.photo === "string" && body.photo.startsWith("data:image/") && body.photo.length < 400_000
      ? body.photo
      : undefined;

  // Coach path: the model logged a meal from a text description with its own
  // inline macro estimate. When asked, upgrade those numbers by routing the
  // description through the same decompose + USDA-resolve pipeline the food page
  // uses; the model's estimate stays as the fallback if resolution fails. Skipped
  // when the client already supplied a resolved breakdown (the food composer).
  let macros: Pick<FoodAnalysis, "name" | "calories" | "proteinG" | "carbsG" | "fatG" | "glycemicLoad"> & {
    confidence?: "low" | "medium" | "high";
    provenance?: FoodProvenance;
    components?: FoodComponent[];
  } = {
    name: String(body.name ?? "Meal"),
    calories: Math.max(0, Math.round(Number(body.calories) || 0)),
    proteinG: Math.max(0, Math.round(Number(body.proteinG) || 0)),
    carbsG: Math.max(0, Math.round(Number(body.carbsG) || 0)),
    fatG: Math.max(0, Math.round(Number(body.fatG) || 0)),
    glycemicLoad: Math.max(0, Math.round(Number(body.glycemicLoad) || 0)),
    confidence: body.confidence,
    provenance: parseProvenance(body.provenance),
    components: parseComponents(body.components),
  };

  if (body.resolveComposite && !macros.components && hasAiKey()) {
    try {
      const desc = [body.name, body.notes].filter((s) => typeof s === "string" && s.trim()).join(". ");
      if (desc) {
        const { analysis } = await decomposeAndResolve({ note: desc });
        macros = {
          name: macros.name, // keep the user's meal label
          calories: analysis.calories,
          proteinG: analysis.proteinG,
          carbsG: analysis.carbsG,
          fatG: analysis.fatG,
          glycemicLoad: analysis.glycemicLoad,
          confidence: analysis.confidence,
          provenance: analysis.provenance,
          components: analysis.components,
        };
      }
    } catch (e) {
      console.warn("Coach composite resolution failed, keeping model estimate:", e);
    }
  }

  const entry: FoodEntry = {
    id: newId(),
    loggedAt: parseLoggedAt(body.loggedAt),
    mealType: parseMealType(body.mealType) ?? "other",
    name: macros.name,
    calories: Math.max(0, Math.round(macros.calories)),
    proteinG: Math.max(0, Math.round(macros.proteinG)),
    carbsG: Math.max(0, Math.round(macros.carbsG)),
    fatG: Math.max(0, Math.round(macros.fatG)),
    glycemicLoad: Math.max(0, Math.round(macros.glycemicLoad || 0)),
    confidence: macros.confidence ?? "medium",
    notes: body.notes,
    photo,
    provenance: macros.provenance,
    components: macros.components,
    syncedToHealth: false,
  };

  if (isConnected()) {
    const googleName = await logFoodToGoogleHealth({
      name: entry.name,
      calories: entry.calories,
      proteinG: entry.proteinG,
      carbsG: entry.carbsG,
      fatG: entry.fatG,
      at: new Date(entry.loggedAt),
      mealType: entry.mealType,
    });
    entry.syncedToHealth = googleName !== null;
    entry.googleName = googleName;
  }

  const foods = readJson<FoodEntry[]>("food-log.json", []);
  foods.push(entry);
  writeJson("food-log.json", foods);
  return NextResponse.json(entry);
}

/** Edits a local entry. The API copy can't be changed — anonymous-food
 *  nutrition logs are immutable per Google's docs — so edits are local. */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const foods = readJson<FoodEntry[]>("food-log.json", []);
  const entry = foods.find((f) => f.id === body.id);
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (body.name != null) entry.name = String(body.name);
  if (body.mealType != null) entry.mealType = parseMealType(body.mealType) ?? entry.mealType;
  if (body.calories != null) entry.calories = Math.max(0, Math.round(Number(body.calories) || 0));
  if (body.proteinG != null) entry.proteinG = Math.max(0, Math.round(Number(body.proteinG) || 0));
  if (body.carbsG != null) entry.carbsG = Math.max(0, Math.round(Number(body.carbsG) || 0));
  if (body.fatG != null) entry.fatG = Math.max(0, Math.round(Number(body.fatG) || 0));
  if (body.glycemicLoad != null) entry.glycemicLoad = Math.max(0, Math.round(Number(body.glycemicLoad) || 0));
  entry.notes = entry.syncedToHealth
    ? "edited locally — the synced Google Health copy keeps its original values"
    : entry.notes;

  writeJson("food-log.json", foods);
  return NextResponse.json(entry);
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const foods = readJson<FoodEntry[]>("food-log.json", []);
  writeJson(
    "food-log.json",
    foods.filter((f) => f.id !== id)
  );
  return NextResponse.json({ ok: true });
}
