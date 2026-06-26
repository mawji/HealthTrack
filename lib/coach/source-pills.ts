// Deterministic source detection for the coach chat. The persona already names
// the source when it grounds advice ("…— ODPHP", "USDA FoodData Central"); this
// scans the finished prose and surfaces a tappable provenance pill per source it
// referenced. No model-format change required — it reads what the coach already
// wrote. Client-safe (no server imports). See app/coach/page.tsx.

export interface SourcePill {
  id: string;
  label: string;
  url: string;
}

interface SourceDef extends SourcePill {
  patterns: RegExp[];
}

// Canonical sources the coach can cite (evidence guidelines) or log against
// (nutrition/exercise data provenance). Match on the short token the coach
// actually writes; render the descriptive label + a link to the source.
const SOURCES: SourceDef[] = [
  {
    id: "odphp",
    label: "ODPHP physical-activity guidelines",
    url: "https://health.gov/our-work/nutrition-physical-activity/physical-activity-guidelines",
    patterns: [/\bODPHP\b/i],
  },
  {
    id: "aha-cdc",
    label: "AHA/CDC blood-pressure categories",
    url: "https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings",
    patterns: [/\bAHA\b/i],
  },
  {
    // Plain CDC mention (A1C, sleep, BMI), but not the "AHA/CDC" pairing above.
    id: "cdc",
    label: "CDC public-health guidance",
    url: "https://www.cdc.gov/",
    patterns: [/(?<!AHA\/)\bCDC\b/i],
  },
  {
    id: "uspstf",
    label: "USPSTF screening guidance",
    url: "https://www.uspreventiveservicestaskforce.org/",
    patterns: [/\bUSPSTF\b/i],
  },
  {
    id: "usda",
    label: "USDA FoodData Central",
    url: "https://fdc.nal.usda.gov/",
    patterns: [/FoodData Central/i, /\bUSDA\b/i],
  },
  {
    id: "off",
    label: "Open Food Facts",
    url: "https://world.openfoodfacts.org/",
    patterns: [/Open Food Facts/i],
  },
  {
    id: "wger",
    label: "wger exercise library",
    url: "https://wger.de/en/dashboard",
    patterns: [/\bwger\b/i],
  },
  {
    id: "gi",
    label: "Intl. GI Tables",
    url: "https://glycemicindex.com/",
    patterns: [/glycemic index tables/i, /\bGI tables\b/i, /international gi/i],
  },
];

/** Sources referenced in `text`, in registry order, deduped. */
export function detectSources(text: string): SourcePill[] {
  if (!text) return [];
  const out: SourcePill[] = [];
  for (const s of SOURCES) {
    if (s.patterns.some((p) => p.test(text))) out.push({ id: s.id, label: s.label, url: s.url });
  }
  return out;
}
