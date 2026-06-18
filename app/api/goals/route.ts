import { NextRequest, NextResponse } from "next/server";
import { newId } from "@/lib/store";
import {
  getGoals,
  saveGoals,
  goalDefaults,
  sanitizeGoal,
  buildAllProgress,
  GOAL_META,
} from "@/lib/goals";
import { GoalsPayload } from "@/lib/types";

/** GET /api/goals → definitions + computed progress. ?defaults=1 → the macro
 *  default set (for the add/restore picker). */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("defaults") === "1") {
    return NextResponse.json({ defaults: goalDefaults() });
  }
  const goals = getGoals();
  const { progress, demo } = await buildAllProgress(goals);
  const payload: GoalsPayload = { goals, progress, demo };
  // meta carries the editor's conservative "why a personal target may differ"
  // copy, keyed by metricKey (static, lives next to the defaults in lib/goals.ts).
  return NextResponse.json({ ...payload, meta: GOAL_META });
}

/** POST /api/goals → create a goal, either re-adding a macro default
 *  ({ fromDefault: "<id>" }) or a custom one (a full goal body). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const goals = getGoals();

  if (typeof body.fromDefault === "string") {
    const def = goalDefaults().find((d) => d.id === body.fromDefault);
    if (!def) return NextResponse.json({ error: "unknown default" }, { status: 400 });
    const existing = goals.find((g) => g.id === def.id);
    if (existing) {
      existing.active = true;
      existing.updatedAt = new Date().toISOString();
      saveGoals(goals);
      return NextResponse.json(existing);
    }
    goals.push(def);
    saveGoals(goals);
    return NextResponse.json(def);
  }

  const sanitized = sanitizeGoal(body);
  if ("error" in sanitized) return NextResponse.json(sanitized, { status: 400 });
  const taken = new Set(goals.map((g) => g.id));
  const base = sanitized.metricKey.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "goal";
  sanitized.id = taken.has(base) ? `${base}-${newId().slice(0, 4)}` : base;
  goals.push(sanitized);
  saveGoals(goals);
  return NextResponse.json(sanitized);
}

/** PATCH /api/goals?id=... → edit targets / visibility / active. */
export async function PATCH(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const goals = getGoals();
  const idx = goals.findIndex((g) => g.id === id);
  if (idx === -1) return NextResponse.json({ error: "not found" }, { status: 404 });

  const sanitized = sanitizeGoal(body, goals[idx]);
  if ("error" in sanitized) return NextResponse.json(sanitized, { status: 400 });
  goals[idx] = sanitized;
  saveGoals(goals);
  return NextResponse.json(sanitized);
}

/** DELETE /api/goals?id=... → deactivate (active:false); ?hard=1 hard-deletes. */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const hard = req.nextUrl.searchParams.get("hard") === "1";
  let goals = getGoals();
  if (hard) {
    goals = goals.filter((g) => g.id !== id);
  } else {
    const g = goals.find((x) => x.id === id);
    if (g) {
      g.active = false;
      g.updatedAt = new Date().toISOString();
    }
  }
  saveGoals(goals);
  return NextResponse.json({ ok: true });
}
