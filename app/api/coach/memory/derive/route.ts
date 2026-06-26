// Silent-watcher endpoint: derive durable "pattern" memories from the user's own
// data (labs, BP, weight) without asking. GET is a dry-run (what would be
// derived, no writes); POST runs the watchers and reconciles the derived
// memories. Called fire-and-forget from the measurement/record write paths, and
// available for a daily scheduler. See lib/memory-watchers.ts.

import { NextResponse } from "next/server";
import { collectDerivedCandidates, runMemoryWatchers } from "@/lib/memory-watchers";

export async function GET() {
  return NextResponse.json({ candidates: collectDerivedCandidates() });
}

export async function POST() {
  return NextResponse.json(runMemoryWatchers());
}
