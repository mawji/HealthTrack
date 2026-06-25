import { NextRequest, NextResponse } from "next/server";
import { lookupBarcode } from "@/lib/openfoodfacts";

/** GET /api/food/barcode?code=<ean/upc> → Open Food Facts product mapped to a
 *  FoodAnalysis + provenance, or 404 when the product isn't found. Results are
 *  cached locally (see lib/openfoodfacts.ts). */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code") ?? "";
  if (!code.trim()) return NextResponse.json({ error: "missing code" }, { status: 400 });

  const result = await lookupBarcode(code);
  if (!result) {
    return NextResponse.json(
      { error: "not_found", message: "No match in Open Food Facts. Try a photo or describe the food instead." },
      { status: 404 }
    );
  }
  return NextResponse.json(result);
}
