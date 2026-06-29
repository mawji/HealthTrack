// Generated-once medication research note. The provider chain does TWO things:
//   1. map the user's brand/product name → active ingredient (AI is good at this,
//      and UAE brand names differ from US ones, so this is the bridge), and
//   2. distill a compact note STRICTLY from authoritative source text (openFDA
//      drug labels, the public DailyMed corpus) — never from model knowledge.
// If no reliable source is found we store an error note (no facts), per the
// product rule: the note quotes a real source or it says it couldn't find one.
// See plans/medications-tracking.md.

import { completeWithFallback, parseJsonReply } from "./ai-provider";
import { MedicationDefinition, MedicationInfo } from "./types";

const DISCLAIMER =
  "Educational summary from the cited source — not medical advice. Verify dosing and interactions with your doctor or pharmacist.";

interface DecodeResult {
  ingredients: string[]; // 1 for simple meds, several for combination products
  isSupplement: boolean;
}

/** Step 1 — map a brand/product name to its active ingredient(s). Handles
 *  combination products (e.g. "Xigduo XR" → dapagliflozin + metformin). */
async function decodeIngredient(med: MedicationDefinition): Promise<DecodeResult> {
  const prompt = `Identify the active ingredient(s) of this product so they can be looked up in a drug database.
Product name: ${med.name}${med.strength ? ` (${med.strength})` : ""}
User-labelled kind: ${med.kind}

Return ONLY JSON: {"ingredients": string[], "isSupplement": boolean}
- ingredients: the active ingredient(s) as lowercase generic/INN names. Most products have ONE (e.g. "Concor" -> ["bisoprolol"], "Glucophage" -> ["metformin"]). COMBINATION products have several (e.g. "Xigduo XR" -> ["dapagliflozin","metformin"], "Co-Amoxiclav" -> ["amoxicillin","clavulanate"]). For a vitamin/mineral/supplement, the nutrient(s) (e.g. ["vitamin d"]). Empty array if you cannot identify it.
- isSupplement: true for a vitamin/mineral/herbal/nutritional supplement, false for a pharmaceutical drug.`;
  try {
    const { text } = await completeWithFallback(
      [
        { role: "system", content: "You are a precise pharmacology name-resolver. Output only JSON." },
        { role: "user", content: prompt },
      ],
      { json: true }
    );
    const r = parseJsonReply<DecodeResult>(text);
    const list = Array.isArray(r.ingredients)
      ? r.ingredients.map((s) => String(s).trim().toLowerCase()).filter(Boolean)
      : [];
    return { ingredients: list, isSupplement: Boolean(r.isSupplement) };
  } catch {
    return { ingredients: [], isSupplement: med.kind === "supplement" };
  }
}

// ── openFDA drug-label fetch ─────────────────────────────────────────────────

interface FdaLabel {
  text: string; // assembled source text the AI is allowed to summarize
  sourceUrl: string; // human-viewable DailyMed page
  matchedName: string;
}

const FDA_FIELDS = [
  "purpose",
  "indications_and_usage",
  "dosage_and_administration",
  "warnings",
  "warnings_and_cautions",
  "adverse_reactions",
  "when_using",
  "do_not_use",
  "ask_doctor",
] as const;

async function fdaQuery(searchExpr: string): Promise<any | null> {
  const url = `https://api.fda.gov/drug/label.json?search=${encodeURIComponent(searchExpr)}&limit=1`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.results?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Fetch the first openFDA label matching any of `exprs` (priority order) and
 *  assemble its summarizable fields. `displayName` is the fallback label. */
async function fetchFdaByExprs(exprs: string[], displayName: string): Promise<FdaLabel | null> {
  let result: any = null;
  for (const e of exprs) {
    result = await fdaQuery(e);
    if (result) break;
  }
  if (!result) return null;

  const chunks: string[] = [];
  for (const f of FDA_FIELDS) {
    const v = result[f];
    if (Array.isArray(v) && v.length) chunks.push(`## ${f.replace(/_/g, " ")}\n${v.join("\n")}`);
  }
  if (!chunks.length) return null;

  const setId = result.openfda?.spl_set_id?.[0];
  const sourceUrl = setId
    ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setId}`
    : "https://dailymed.nlm.nih.gov/dailymed/";
  const matchedName =
    result.openfda?.generic_name?.[0] || result.openfda?.brand_name?.[0] || displayName;

  // Cap the source text so the distil call stays cheap.
  return { text: chunks.join("\n\n").slice(0, 7000), sourceUrl, matchedName };
}

/** Look a single generic name up in openFDA (generic → substance → brand). */
async function fetchFdaLabel(generic: string): Promise<FdaLabel | null> {
  const g = generic.replace(/"/g, "");
  return fetchFdaByExprs(
    [`openfda.generic_name:"${g}"`, `openfda.substance_name:"${g}"`, `openfda.brand_name:"${g}"`],
    generic
  );
}

// ── NIH/NLM MedlinePlus fetch (supplement-first source) ──────────────────────
// ODS fact sheets are WAF-blocked to server fetches (403), so we use NLM's
// MedlinePlus health-topics web service: a clean API that covers vitamins,
// minerals, and supplements as authoritative consumer-health topics, each with
// a real topic URL to cite.

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

function htmlToText(html: string): string {
  return decodeEntities(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface SourceDoc {
  text: string;
  sourceUrl: string;
  matchedName: string;
}

/** Look a nutrient/supplement up in MedlinePlus health topics, picking the
 *  best-matching topic and returning its summary text + canonical URL. */
async function fetchMedlinePlus(term: string): Promise<SourceDoc | null> {
  const url = `https://wsearch.nlm.nih.gov/ws/query?db=healthTopics&term=${encodeURIComponent(term)}&retmax=5`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/xml" } });
    if (!res.ok) return null;
    const xml = await res.text();
    const docs = [...xml.matchAll(/<document\b[^>]*\burl="([^"]*)"[^>]*>([\s\S]*?)<\/document>/g)]
      .map((m) => {
        const block = m[2];
        const titleRaw = /<content name="title">([\s\S]*?)<\/content>/.exec(block)?.[1] ?? "";
        const sumRaw = /<content name="FullSummary">([\s\S]*?)<\/content>/.exec(block)?.[1] ?? "";
        return { docUrl: decodeEntities(m[1]), title: htmlToText(titleRaw), text: htmlToText(sumRaw) };
      })
      .filter((d) => d.text.length > 120);
    if (!docs.length) return null;
    const t = term.toLowerCase();
    // Prefer a topic whose title actually names the nutrient over a generic
    // grouping (e.g. "Vitamin D" over "Minerals").
    const best =
      docs.find((d) => d.title.toLowerCase().includes(t) || t.includes(d.title.toLowerCase())) ?? docs[0];
    return { text: best.text.slice(0, 7000), sourceUrl: best.docUrl, matchedName: best.title };
  } catch {
    return null;
  }
}

// ── distillation (summarize ONLY the fetched source) ─────────────────────────

interface DistilledSections {
  purpose?: string;
  usage?: string;
  dosage?: string;
  sideEffects?: string;
  cautions?: string;
}

async function distil(
  generic: string,
  sourceText: string,
  kind: "drug" | "supplement"
): Promise<DistilledSections> {
  const sourceDesc =
    kind === "supplement"
      ? `authoritative consumer-health information about the supplement/nutrient "${generic}"`
      : `official drug-label text for "${generic}"`;
  const dosageHint =
    kind === "supplement"
      ? "dosage: typical recommended intake/amounts AS STATED (general guidance, not a personal prescription)."
      : "dosage: typical dosing ranges/forms AS STATED (label it as the label's general guidance, not a personal prescription).";
  const prompt = `Below is ${sourceDesc}. Write a brief patient-friendly note, using ONLY information present in this text. Do NOT add facts from your own knowledge. If the text does not cover a section, leave that field as an empty string.

Return ONLY JSON with these string fields (each 1-3 short sentences, plain language):
{"purpose": "...", "usage": "...", "dosage": "...", "sideEffects": "...", "cautions": "..."}
- purpose: what condition it treats / what it is for.
- usage: how it is generally taken (with/without food, timing) if stated.
- ${dosageHint}
- sideEffects: the most common or notable adverse effects mentioned.
- cautions: key warnings, contraindications, or interactions mentioned.

SOURCE TEXT:
${sourceText}`;
  const { text } = await completeWithFallback(
    [
      {
        role: "system",
        content:
          "You summarize official medication label text faithfully. You never invent facts not in the provided text. Output only JSON.",
      },
      { role: "user", content: prompt },
    ],
    { json: true }
  );
  const r = parseJsonReply<DistilledSections>(text);
  const clean = (s: unknown) => (typeof s === "string" && s.trim() ? s.trim() : undefined);
  return {
    purpose: clean(r.purpose),
    usage: clean(r.usage),
    dosage: clean(r.dosage),
    sideEffects: clean(r.sideEffects),
    cautions: clean(r.cautions),
  };
}

// ── public entry ──────────────────────────────────────────────────────────────

/** Generate (or regenerate) the research note for one medication. Always returns
 *  a MedicationInfo: on failure, `error` is set and `sections` is empty so the
 *  UI shows "couldn't find a reliable source" rather than fabricated facts. */
export async function generateMedicationInfo(med: MedicationDefinition): Promise<MedicationInfo> {
  const retrievedAt = new Date().toISOString();
  const base: MedicationInfo = {
    genericName: null,
    sections: {},
    sources: [],
    disclaimer: DISCLAIMER,
    retrievedAt,
  };

  // Prefer the user's structured ingredients (e.g. from the box scanner); else
  // ask the model to decode the brand → ingredient(s).
  const structured = med.ingredients?.map((i) => i.name.trim().toLowerCase()).filter(Boolean) ?? [];
  const decoded = structured.length
    ? { ingredients: structured, isSupplement: med.kind === "supplement" }
    : await decodeIngredient(med);
  const ingredients = decoded.ingredients;
  const display = ingredients.join(" + ");
  base.genericName = display || null;
  if (!ingredients.length) {
    return { ...base, error: "Couldn't identify the active ingredient to look up. Add details in notes." };
  }

  const isCombo = ingredients.length >= 2;
  const ing0 = ingredients[0].replace(/"/g, "");
  const brand = med.name.replace(/"/g, "");
  const brandBase = brand.replace(/\b(XR|ER|SR|CR|XL|MR|LA)\b/gi, "").trim(); // drop release-modifier suffixes

  // Pick the source: combos resolve best by BRAND in openFDA (one combo label);
  // single drugs by ingredient; supplements via MedlinePlus first. Each path
  // cross-falls-back. The note is distilled ONLY from the fetched source text.
  const FDA_NAME = "openFDA / DailyMed label";
  const MP_NAME = "MedlinePlus (NIH/NLM)";
  const tryFda = async (): Promise<{ doc: SourceDoc; name: string } | null> => {
    const exprs = isCombo
      ? [`openfda.brand_name:"${brand}"`, `openfda.brand_name:"${brandBase}"`, `openfda.generic_name:"${ing0}"`, `openfda.substance_name:"${ing0}"`]
      : [`openfda.generic_name:"${ing0}"`, `openfda.substance_name:"${ing0}"`, `openfda.brand_name:"${ing0}"`];
    const d = await fetchFdaByExprs(exprs, display);
    return d ? { doc: d, name: FDA_NAME } : null;
  };
  const tryMp = async (): Promise<{ doc: SourceDoc; name: string } | null> => {
    const d = await fetchMedlinePlus(ingredients[0]);
    return d ? { doc: d, name: MP_NAME } : null;
  };

  const order = decoded.isSupplement ? [tryMp, tryFda] : [tryFda, tryMp];
  let picked: { doc: SourceDoc; name: string } | null = null;
  for (const attempt of order) {
    picked = await attempt();
    if (picked) break;
  }

  if (!picked) {
    const searchUrl = decoded.isSupplement
      ? `https://medlineplus.gov/all_healthtopics.html`
      : `https://medlineplus.gov/druginformation.html`;
    return {
      ...base,
      error: `No authoritative source found for "${display}". Check ${searchUrl}.`,
      sources: [{ name: "MedlinePlus", url: searchUrl }],
    };
  }

  const { doc, name } = picked;
  // For a combination, describe the whole combo (not just the matched name).
  const distilName = isCombo ? display : doc.matchedName;
  try {
    const sections = await distil(distilName, doc.text, decoded.isSupplement ? "supplement" : "drug");
    const hasContent = Object.values(sections).some(Boolean);
    if (!hasContent) {
      return { ...base, genericName: distilName, error: "Source had no summarizable content.", sources: [{ name, url: doc.sourceUrl }] };
    }
    return {
      genericName: distilName,
      sections,
      sources: [{ name, url: doc.sourceUrl }],
      disclaimer: DISCLAIMER,
      retrievedAt,
    };
  } catch {
    return { ...base, genericName: distilName, error: "Couldn't summarize the source.", sources: [{ name, url: doc.sourceUrl }] };
  }
}
