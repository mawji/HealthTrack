import { NextRequest, NextResponse } from "next/server";
import { searchFoods, usingDemoKey } from "@/lib/usda";

/** GET /api/food/search?q=<food name> → USDA FoodData Central candidates, each
 *  shaped like the barcode result (analysis + per100g + servingG) so the food
 *  composer reuses the same fill + serving-rescale path. */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ error: "query too short" }, { status: 400 });

  const candidates = await searchFoods(q);
  return NextResponse.json({ candidates, demoKey: usingDemoKey() });
}
