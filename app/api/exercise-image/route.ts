import { NextRequest, NextResponse } from "next/server";
import { readLocalImage, remoteImageUrl } from "@/lib/exercise-library";

/** GET /api/exercise-image?uuid=… → the exercise's main image. Serves the
 *  downloaded local copy when present (offline), else redirects to the wger URL
 *  (lazy — needs internet). 404 if neither exists. */
export async function GET(req: NextRequest) {
  const uuid = req.nextUrl.searchParams.get("uuid") ?? "";
  if (!uuid) return NextResponse.json({ error: "missing uuid" }, { status: 400 });

  const local = readLocalImage(uuid);
  if (local) {
    return new NextResponse(new Uint8Array(local.buffer), {
      headers: { "Content-Type": local.contentType, "Cache-Control": "public, max-age=2592000" },
    });
  }
  const remote = remoteImageUrl(uuid);
  if (remote) return NextResponse.redirect(remote, 302);
  return new NextResponse(null, { status: 404 });
}
