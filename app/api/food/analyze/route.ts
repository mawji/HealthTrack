import { NextRequest, NextResponse } from "next/server";
import { hasAiKey, parseJsonReply } from "@/lib/openrouter";
import { completeWithFallback } from "@/lib/ai-provider";
import { FoodAnalysis } from "@/lib/types";

const JSON_SHAPE = `Reply with ONLY a JSON object, no prose:
{
  "name": "short dish name",
  "calories": <integer kcal>,
  "proteinG": <integer grams>,
  "carbsG": <integer grams>,
  "fatG": <integer grams>,
  "glycemicLoad": <integer — estimated glycemic load of the full portion (GI of the dish × net carbs ÷ 100)>,
  "confidence": "low" | "medium" | "high",
  "notes": "one sentence on portion assumptions"
}`;

export async function POST(req: NextRequest) {
  if (!hasAiKey()) {
    return NextResponse.json(
      { error: "Connect an AI provider in Settings to analyze food." },
      { status: 400 }
    );
  }
  const { image, note } = await req.json(); // image: "data:image/jpeg;base64,..."
  const hasImage = typeof image === "string" && image.startsWith("data:image/");
  const description = typeof note === "string" ? note.trim() : "";
  if (!hasImage && !description) {
    return NextResponse.json({ error: "Send a photo or a description." }, { status: 400 });
  }

  let prompt: string;
  if (hasImage) {
    prompt = `You are a nutrition analyst. Look at this photo of food and estimate what it is and its nutritional content for the full visible portion.\n\n${JSON_SHAPE}`;
    // Optional user-supplied context (dish name, ingredients, portion size) to
    // anchor the estimate when the photo alone is ambiguous.
    if (description) {
      prompt += `\n\nThe person who ate this added these details — treat them as authoritative and prefer them over what the photo alone suggests:\n"""${description}"""`;
    }
  } else {
    // Text-only: the description is the meal. No photo to look at.
    prompt = `You are a nutrition analyst. Estimate the nutritional content of the meal described below for the full portion. If a portion size isn't given, assume one typical serving and say so in the notes.\n\nThe meal:\n"""${description}"""\n\n${JSON_SHAPE}`;
  }

  try {
    const { text: reply, usedSecondary, servedLabel } = await completeWithFallback(
      [
        {
          role: "user",
          content: hasImage
            ? [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: image } },
              ]
            : prompt,
        },
      ],
      { vision: hasImage }
    );
    const analysis = parseJsonReply<FoodAnalysis>(reply);
    // Label the model estimate honestly as the fallback path (vs barcode/USDA),
    // so the composer shows an "AI estimate" provenance badge.
    analysis.provenance = {
      source: hasImage ? "photo" : "text",
      sourceLabel: "AI estimate",
    };
    return NextResponse.json(analysis, usedSecondary ? { headers: { "X-AI-Fallback": servedLabel } } : undefined);
  } catch (e: any) {
    console.error("Food analysis failed:", e);
    return NextResponse.json({ error: String(e.message ?? e) }, { status: 502 });
  }
}
