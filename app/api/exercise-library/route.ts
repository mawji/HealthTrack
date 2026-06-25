import { NextRequest, NextResponse } from "next/server";
import {
  getLibraryMeta,
  searchLibrary,
  getExerciseByUuid,
  downloadLibrary,
  downloadImages,
  addCustomExercise,
  deleteCustomExercise,
  WGER_ATTRIBUTION,
} from "@/lib/exercise-library";

/** GET /api/exercise-library            → meta (downloaded?, counts) + attribution
 *  GET /api/exercise-library?q=bench     → matching exercises (wger + custom) */
export async function GET(req: NextRequest) {
  const uuid = req.nextUrl.searchParams.get("uuid");
  if (uuid) {
    const exercise = getExerciseByUuid(uuid);
    return exercise ? NextResponse.json({ exercise }) : NextResponse.json({ exercise: null }, { status: 404 });
  }
  const q = req.nextUrl.searchParams.get("q");
  if (q != null) {
    return NextResponse.json({ exercises: searchLibrary(q), attribution: WGER_ATTRIBUTION });
  }
  return NextResponse.json({ ...getLibraryMeta(), attribution: WGER_ATTRIBUTION });
}

/** POST { action: "download" }                       → one-time download / refresh
 *  POST { action: "addCustom", name, muscles?, ... } → create a user exercise */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (body.action === "download") {
    const result = await downloadLibrary();
    return NextResponse.json(result, result.ok ? undefined : { status: 502 });
  }
  if (body.action === "downloadImages") {
    const result = await downloadImages();
    return NextResponse.json(result, result.ok ? undefined : { status: 502 });
  }
  if (body.action === "addCustom") {
    const ex = addCustomExercise(body);
    return NextResponse.json(ex, "error" in ex ? { status: 400 } : undefined);
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

/** DELETE /api/exercise-library?uuid=custom-… → remove a user exercise. */
export async function DELETE(req: NextRequest) {
  const uuid = req.nextUrl.searchParams.get("uuid") ?? "";
  if (!uuid.startsWith("custom-")) return NextResponse.json({ error: "only custom exercises can be deleted" }, { status: 400 });
  return NextResponse.json({ ok: deleteCustomExercise(uuid) });
}
