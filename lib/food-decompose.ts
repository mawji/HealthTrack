// Composite (hybrid) food analysis: decompose a plate into component foods with
// the AI, then resolve each component against USDA FoodData Central for
// reference-grade macro density — falling back to the model's estimate for any
// component USDA can't match. The meal total is the sum of the components.
//
// This is the accuracy upgrade over the single-shot estimate in
// app/api/food/analyze: instead of the model guessing the whole plate's macros
// in one number, it guesses the PORTIONS (what it's good at) and a nutrition
// database supplies the DENSITY (what it's bad at). Shared by the food-page
// analyzer and the coach's logFood path.

import { completeWithFallback, parseJsonReply } from "./ai-provider";
import { searchFoods } from "./usda";
import { resolveGi, glycemicLoad } from "./glycemic-index";
import { FoodAnalysis, FoodComponent, NutritionSource } from "./types";

const round = (n: number) => Math.round(n * 10) / 10;
const int = (n: unknown) => Math.max(0, Math.round(Number(n) || 0));

// When a single high-confidence item is detected we skip USDA entirely — there's
// no accuracy to gain decomposing "a banana", and we save the lookups.
const SKIP_USDA_WHEN_SINGLE_HIGH_CONFIDENCE = true;

const DECOMPOSE_SHAPE = `Reply with ONLY a JSON object, no prose:
{
  "name": "short name for the whole meal",
  "confidence": "low" | "medium" | "high",
  "components": [
    {
      "name": "ONE food/ingredient, generic and database-friendly (e.g. 'white rice, cooked', 'chicken breast, grilled', 'olive oil') — NOT a brand name",
      "portionG": <integer grams of THIS component eaten>,
      "calories": <integer kcal for this portion>,
      "proteinG": <number grams>,
      "carbsG": <number grams>,
      "fatG": <number grams>,
      "glycemicLoad": <integer glycemic load for THIS portion — ALWAYS provide it: estimate the food's typical glycemic index from your nutrition knowledge and apply GI × net carbs ÷ 100. Use 0 ONLY for essentially carb-free foods (oils, butter, meat, eggs). Never omit this field.>
    }
  ]
}
Break the meal into its distinct ingredients/foods. Use generic ingredient names (no brands) so each can be matched to a nutrition database. Estimate each component's as-eaten portion in grams. "confidence" is how sure you are of the overall identification and portions.`;

interface RawComponent {
  name?: string;
  portionG?: number;
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  glycemicLoad?: number;
}

export interface DecomposeResult {
  analysis: FoodAnalysis;
  usedSecondary: boolean; // the AI provider fallback fired (for the X-AI-Fallback header)
  servedLabel: string;
}

/**
 * Decompose a photo or description into components and resolve each against USDA.
 * Throws when the model returns no usable components, so callers can fall back to
 * a single-shot estimate.
 */
export async function decomposeAndResolve(input: {
  image?: string;
  note?: string;
}): Promise<DecomposeResult> {
  const hasImage = typeof input.image === "string" && input.image.startsWith("data:image/");
  const description = (input.note ?? "").trim();

  let prompt: string;
  if (hasImage) {
    prompt = `You are a nutrition analyst. Look at this photo and break the meal into its component foods, estimating each component's as-eaten portion and macros for the full visible portion.\n\n${DECOMPOSE_SHAPE}`;
    if (description) {
      prompt += `\n\nThe person who ate this added these details — treat them as authoritative and prefer them over what the photo alone suggests:\n"""${description}"""`;
    }
  } else {
    prompt = `You are a nutrition analyst. Break the meal described below into its component foods, estimating each component's portion and macros for the full portion. If a portion size isn't given, assume one typical serving.\n\nThe meal:\n"""${description}"""\n\n${DECOMPOSE_SHAPE}`;
  }

  const { text, usedSecondary, servedLabel } = await completeWithFallback(
    [
      {
        role: "user",
        content: hasImage
          ? [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: input.image } },
            ]
          : prompt,
      },
    ],
    { vision: hasImage }
  );

  const decoded = parseJsonReply<{ name?: string; confidence?: string; components?: RawComponent[] }>(text);
  const raw = Array.isArray(decoded.components) ? decoded.components.filter((c) => c && c.name) : [];
  if (raw.length === 0) throw new Error("decomposition returned no components");

  const confidence = (["low", "medium", "high"].includes(decoded.confidence as string)
    ? decoded.confidence
    : "medium") as "low" | "medium" | "high";
  const aiSource: NutritionSource = hasImage ? "photo" : "text";
  const mealName = String(decoded.name ?? raw[0].name ?? "Meal").trim() || "Meal";

  // Trivial single-item, high-confidence meals: keep the fast AI estimate.
  if (SKIP_USDA_WHEN_SINGLE_HIGH_CONFIDENCE && raw.length === 1 && confidence === "high") {
    const c = aiComponent(raw[0], aiSource);
    const analysis: FoodAnalysis = {
      name: mealName,
      calories: c.calories,
      proteinG: c.proteinG,
      carbsG: c.carbsG,
      fatG: c.fatG,
      glycemicLoad: c.glycemicLoad ?? 0,
      confidence: "high",
      notes: "Single-item AI estimate. Adjust the portion if it's off.",
      provenance: { source: aiSource, sourceLabel: "AI estimate", portionEstimated: true },
    };
    return { analysis, usedSecondary, servedLabel };
  }

  const components = await mapLimit(raw, 3, (c) => resolveComponent(c, aiSource));

  const total = components.reduce(
    (t, c) => ({
      calories: t.calories + c.calories,
      proteinG: round(t.proteinG + c.proteinG),
      carbsG: round(t.carbsG + c.carbsG),
      fatG: round(t.fatG + c.fatG),
      glycemicLoad: t.glycemicLoad + (c.glycemicLoad ?? 0),
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, glycemicLoad: 0 }
  );

  const matched = components.filter((c) => c.provenance.source === "fdc").length;
  const allFdc = matched === components.length;
  const anyFdc = matched > 0;
  const source: NutritionSource = allFdc ? "fdc" : anyFdc ? "composite" : aiSource;
  const sourceLabel = allFdc
    ? "USDA FoodData Central"
    : anyFdc
    ? "USDA + AI estimate"
    : "AI estimate";
  const notes = anyFdc
    ? `${matched} of ${components.length} item${components.length === 1 ? "" : "s"} matched to USDA FoodData Central; the rest are AI estimates. Portions are estimates — adjust per item.`
    : "AI estimate — no USDA matches found. Portions are estimates — adjust per item.";

  const analysis: FoodAnalysis = {
    name: mealName,
    calories: Math.round(total.calories),
    proteinG: round(total.proteinG),
    carbsG: round(total.carbsG),
    fatG: round(total.fatG),
    glycemicLoad: Math.round(total.glycemicLoad),
    confidence: allFdc ? "high" : "medium",
    notes,
    provenance: {
      source,
      sourceLabel,
      attribution: anyFdc ? "Source: USDA FoodData Central" : undefined,
      portionEstimated: true,
    },
    components,
  };
  return { analysis, usedSecondary, servedLabel };
}

/** Resolve one component against USDA FDC, falling back to its AI estimate. */
async function resolveComponent(c: RawComponent, aiSource: NutritionSource): Promise<FoodComponent> {
  const name = String(c.name ?? "item").trim() || "item";
  const portionG = int(c.portionG) || 100;

  let candidates: Awaited<ReturnType<typeof searchFoods>> = [];
  try {
    candidates = await searchFoods(name, 5);
  } catch {
    candidates = [];
  }
  const top = candidates[0];

  if (top?.per100g) {
    const f = portionG / 100;
    const carbsG = round(top.per100g.carbsG * f);
    // Prefer a curated-GI glycemic load; the candidate already resolved one if
    // its description matched the GI set, else try the component name directly.
    const gi = top.analysis.provenance?.gi ?? resolveGi(name)?.gi ?? null;
    const giSource = top.analysis.provenance?.giSource ?? resolveGi(name)?.source;
    return {
      name,
      portionG,
      calories: Math.round(top.per100g.calories * f),
      proteinG: round(top.per100g.proteinG * f),
      carbsG,
      fatG: round(top.per100g.fatG * f),
      // Curated-GI load when the food matches the GI set; otherwise the model's
      // per-component estimate (always present per the prompt). Never silently 0.
      glycemicLoad: gi != null ? glycemicLoad(gi, carbsG) : int(c.glycemicLoad),
      per100g: top.per100g,
      fdcId: top.fdcId,
      provenance: {
        source: "fdc",
        sourceLabel: "USDA FoodData Central",
        sourceUrl: top.analysis.provenance?.sourceUrl,
        attribution: "Source: USDA FoodData Central",
        portionEstimated: true,
        servingG: portionG,
        ...(gi != null ? { gi, giSource } : {}),
      },
    };
  }

  return aiComponent(c, aiSource);
}

/** Resolve with bounded concurrency — keeps a multi-ingredient meal from firing
 *  a burst of simultaneous USDA requests (which the API throttles), while
 *  preserving input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Build a model-estimate component (no USDA match). */
function aiComponent(c: RawComponent, aiSource: NutritionSource): FoodComponent {
  const name = String(c.name ?? "item").trim() || "item";
  const portionG = int(c.portionG) || 100;
  const carbsG = round(Number(c.carbsG) || 0);
  const gi = resolveGi(name)?.gi ?? null;
  return {
    name,
    portionG,
    calories: int(c.calories),
    proteinG: round(Number(c.proteinG) || 0),
    carbsG,
    fatG: round(Number(c.fatG) || 0),
    glycemicLoad: gi != null ? glycemicLoad(gi, carbsG) : int(c.glycemicLoad),
    provenance: {
      source: aiSource,
      sourceLabel: "AI estimate",
      portionEstimated: true,
      servingG: portionG,
      ...(gi != null ? { gi, giSource: resolveGi(name)!.source } : {}),
    },
  };
}
