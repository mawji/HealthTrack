import { NextRequest, NextResponse } from "next/server";
import { readJson, writeJson, newId } from "@/lib/store";
import { isConnected, logFoodToGoogleHealth } from "@/lib/googlehealth";
import { getRemoteMeals } from "@/lib/remote-food";
import { FoodEntry, FoodProvenance, MealType, NutritionSource } from "@/lib/types";

const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "other"];
const NUTRITION_SOURCES: NutritionSource[] = ["photo", "text", "barcode", "fdc", "label", "user", "model"];

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
  const entry: FoodEntry = {
    id: newId(),
    loggedAt: parseLoggedAt(body.loggedAt),
    mealType: parseMealType(body.mealType) ?? "other",
    name: String(body.name ?? "Meal"),
    calories: Math.max(0, Math.round(Number(body.calories) || 0)),
    proteinG: Math.max(0, Math.round(Number(body.proteinG) || 0)),
    carbsG: Math.max(0, Math.round(Number(body.carbsG) || 0)),
    fatG: Math.max(0, Math.round(Number(body.fatG) || 0)),
    glycemicLoad: Math.max(0, Math.round(Number(body.glycemicLoad) || 0)),
    confidence: body.confidence ?? "medium",
    notes: body.notes,
    photo,
    provenance: parseProvenance(body.provenance),
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
