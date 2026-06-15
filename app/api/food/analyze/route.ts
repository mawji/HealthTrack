import { NextRequest, NextResponse } from "next/server";
import { complete, hasAiKey, parseJsonReply } from "@/lib/openrouter";
import { FoodAnalysis } from "@/lib/types";

const PROMPT = `You are a nutrition analyst. Look at this photo of food and estimate what it is and its nutritional content for the full visible portion.

Reply with ONLY a JSON object, no prose:
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
      { error: "Connect an AI provider in Settings to analyze food photos." },
      { status: 400 }
    );
  }
  const { image, note } = await req.json(); // data URL: "data:image/jpeg;base64,..."
  if (!image?.startsWith("data:image/")) {
    return NextResponse.json({ error: "Send { image: dataUrl }" }, { status: 400 });
  }

  // Optional user-supplied context (dish name, ingredients, portion size, etc.)
  // to anchor the estimate when the photo alone is ambiguous.
  const context = typeof note === "string" && note.trim()
    ? `\n\nThe person who ate this added these details — treat them as authoritative and prefer them over what the photo alone suggests:\n"""${note.trim()}"""`
    : "";

  try {
    const reply = await complete(
      [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT + context },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
      { vision: true }
    );
    const analysis = parseJsonReply<FoodAnalysis>(reply);
    return NextResponse.json(analysis);
  } catch (e: any) {
    console.error("Food analysis failed:", e);
    return NextResponse.json({ error: String(e.message ?? e) }, { status: 502 });
  }
}
