// Curated glycemic index (GI) values for common foods, used to compute a real,
// source-backed glycemic load (GL = GI × available carbs ÷ 100) instead of a
// model guess. Per the restricted-source policy: GI values are FACTS we cite —
// we do NOT scrape or embed the University of Sydney database. Values are
// representative published medians from the International Tables of Glycemic
// Index and Glycemic Load Values (Atkinson FS, Foster-Powell K, Brand-Miller JC;
// Diabetes Care 2008, updated 2021). Glucose = 100 reference.
//
// This is a small common-food set on purpose; anything not matched here keeps GL
// estimated/unavailable rather than pretending precision.

export const GI_SOURCE = "Intl. GI Tables (Atkinson 2008 / 2021)";
export const GI_SOURCE_URL = "https://doi.org/10.2337/dc08-1239";

interface GiEntry {
  gi: number;
  match: string[]; // normalized keywords; the most specific (longest) wins
  label: string;
}

// Order doesn't matter — resolve() sorts by keyword specificity.
const TABLE: GiEntry[] = [
  { gi: 100, label: "glucose", match: ["glucose"] },
  { gi: 65, label: "sucrose (table sugar)", match: ["sucrose", "table sugar", "white sugar"] },
  { gi: 61, label: "honey", match: ["honey"] },
  // grains & starches
  { gi: 73, label: "white rice, boiled", match: ["white rice"] },
  { gi: 68, label: "brown rice", match: ["brown rice"] },
  { gi: 57, label: "basmati rice", match: ["basmati"] },
  { gi: 64, label: "rice (generic)", match: ["rice"] },
  { gi: 75, label: "white bread", match: ["white bread"] },
  { gi: 74, label: "whole wheat bread", match: ["whole wheat bread", "wholemeal bread"] },
  { gi: 54, label: "sourdough bread", match: ["sourdough"] },
  { gi: 69, label: "bagel", match: ["bagel"] },
  { gi: 57, label: "pita bread", match: ["pita"] },
  { gi: 70, label: "bread (generic)", match: ["bread"] },
  { gi: 49, label: "spaghetti / pasta, boiled", match: ["spaghetti", "pasta", "macaroni"] },
  { gi: 53, label: "quinoa", match: ["quinoa"] },
  { gi: 65, label: "couscous", match: ["couscous"] },
  { gi: 28, label: "pearl barley", match: ["barley"] },
  { gi: 55, label: "rolled oats / oatmeal", match: ["rolled oats", "oatmeal", "porridge", "oats"] },
  { gi: 79, label: "instant oats", match: ["instant oat"] },
  { gi: 81, label: "cornflakes", match: ["cornflakes", "corn flakes"] },
  { gi: 52, label: "sweet corn", match: ["sweet corn", "corn"] },
  { gi: 65, label: "popcorn", match: ["popcorn"] },
  // potatoes
  { gi: 85, label: "baked potato", match: ["baked potato"] },
  { gi: 87, label: "mashed potato", match: ["mashed potato"] },
  { gi: 63, label: "french fries", match: ["french fries", "fries", "chips"] },
  { gi: 78, label: "boiled potato", match: ["potato"] },
  { gi: 63, label: "sweet potato", match: ["sweet potato"] },
  // legumes
  { gi: 28, label: "chickpeas", match: ["chickpea", "chick pea", "hummus"] },
  { gi: 32, label: "lentils", match: ["lentil"] },
  { gi: 24, label: "kidney beans", match: ["kidney bean"] },
  { gi: 31, label: "beans (generic)", match: ["beans"] },
  // fruit
  { gi: 51, label: "banana", match: ["banana"] },
  { gi: 36, label: "apple", match: ["apple"] },
  { gi: 43, label: "orange", match: ["orange"] },
  { gi: 59, label: "grapes", match: ["grape"] },
  { gi: 76, label: "watermelon", match: ["watermelon"] },
  { gi: 51, label: "mango", match: ["mango"] },
  { gi: 59, label: "pineapple", match: ["pineapple"] },
  { gi: 42, label: "dates", match: ["date", "dates"] },
  { gi: 39, label: "carrots, boiled", match: ["carrot"] },
  // dairy & drinks
  { gi: 39, label: "milk, whole", match: ["whole milk", "milk"] },
  { gi: 51, label: "ice cream", match: ["ice cream"] },
  { gi: 63, label: "cola / soft drink", match: ["cola", "soft drink", "soda"] },
  { gi: 50, label: "orange juice", match: ["orange juice"] },
];

function normalize(name: string): string {
  return ` ${name.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

export interface GiMatch {
  gi: number;
  label: string;
  source: string;
}

/** Resolve a food name to a published GI, preferring the most specific keyword
 *  match. Returns null when nothing in the curated set applies. */
export function resolveGi(name: string): GiMatch | null {
  const hay = normalize(name);
  let best: { entry: GiEntry; kwLen: number } | null = null;
  for (const entry of TABLE) {
    for (const kw of entry.match) {
      if (hay.includes(` ${kw} `) || hay.includes(`${kw} `) || hay.includes(` ${kw}`)) {
        if (!best || kw.length > best.kwLen) best = { entry, kwLen: kw.length };
      }
    }
  }
  return best ? { gi: best.entry.gi, label: best.entry.label, source: GI_SOURCE } : null;
}

/** Glycemic load from a source-backed GI and the portion's available carbs. */
export function glycemicLoad(gi: number, carbsG: number): number {
  if (!Number.isFinite(gi) || !Number.isFinite(carbsG) || carbsG <= 0) return 0;
  return Math.round((gi * carbsG) / 100);
}
