import { NextResponse } from "next/server";
import { fetchExerciseTypes } from "@/lib/exercise-catalog";

// Live exercise-type catalog for the picker's search menu (cached server-side).
export async function GET() {
  const types = await fetchExerciseTypes();
  return NextResponse.json({ types });
}
