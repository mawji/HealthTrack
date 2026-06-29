// Extract medication details from a photo of the box/packaging via the vision
// model — name, active ingredient(s) + strengths (handles combination meds),
// form, pack count. The client prefills the add-medication form for review;
// nothing is saved here. Mirrors the food-photo vision path.

import { NextRequest, NextResponse } from "next/server";
import { hasAiKey } from "@/lib/ai-provider";
import { completeWithFallback, parseJsonReply } from "@/lib/ai-provider";

const JSON_SHAPE = `Reply with ONLY a JSON object, no prose:
{
  "name": "product/brand name as printed (e.g. Xigduo XR)",
  "kind": "medication" | "supplement",
  "form": "tablet" | "capsule" | "syrup" | "drops" | "injection" | "other" | "",
  "unit": "tablet" | "capsule" | "ml" | "IU" | "" ,
  "ingredients": [ { "name": "active ingredient generic name", "strength": "e.g. 5 mg" } ],
  "packCount": <integer total units in the pack, or null if not shown>,
  "confidence": "low" | "medium" | "high",
  "notes": "anything notable (e.g. extended-release), short"
}`;

interface ScanResult {
  name?: string;
  kind?: string;
  form?: string;
  unit?: string;
  ingredients?: { name?: string; strength?: string }[];
  packCount?: number | null;
  confidence?: string;
  notes?: string;
}

export async function POST(req: NextRequest) {
  if (!hasAiKey()) {
    return NextResponse.json({ error: "Connect an AI provider in Settings to scan a box." }, { status: 400 });
  }
  const { image } = await req.json().catch(() => ({}));
  if (typeof image !== "string" || !image.startsWith("data:image/")) {
    return NextResponse.json({ error: "Send a photo of the medication box." }, { status: 400 });
  }

  const prompt = `You are reading a photo of a medication or supplement box/packaging. Extract the printed details.
- ingredients: list EVERY active ingredient with its strength. Combination products list several (e.g. dapagliflozin 5 mg AND metformin 1000 mg). Use the generic ingredient names, not the brand.
- packCount: the total number of tablets/capsules/units in the pack if printed (e.g. "60 Tablets" -> 60).
- Only report what is visible on the box; use "" or null if a field isn't shown. Do NOT guess dosing schedule.

${JSON_SHAPE}`;

  try {
    const { text, usedSecondary, servedLabel } = await completeWithFallback(
      [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
      { vision: true, json: true }
    );
    const raw = parseJsonReply<ScanResult>(text);
    const ingredients = Array.isArray(raw.ingredients)
      ? raw.ingredients
          .map((i) => ({ name: String(i?.name ?? "").trim(), strength: String(i?.strength ?? "").trim() }))
          .filter((i) => i.name)
          .slice(0, 6)
      : [];
    const result = {
      name: String(raw.name ?? "").trim(),
      kind: raw.kind === "supplement" ? "supplement" : "medication",
      form: String(raw.form ?? "").trim(),
      unit: String(raw.unit ?? "").trim() || (raw.form ? String(raw.form).trim() : ""),
      ingredients,
      packCount: typeof raw.packCount === "number" && raw.packCount > 0 ? Math.round(raw.packCount) : null,
      confidence: ["low", "medium", "high"].includes(String(raw.confidence)) ? raw.confidence : "medium",
      notes: String(raw.notes ?? "").trim(),
    };
    return NextResponse.json(result, usedSecondary ? { headers: { "X-AI-Fallback": servedLabel } } : undefined);
  } catch (e: any) {
    console.error("Medication scan failed:", e);
    return NextResponse.json({ error: String(e.message ?? e) }, { status: 502 });
  }
}
