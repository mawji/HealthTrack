// Server-side execution of the coach's ```log actions — the headless twin of
// the client ActionRunner in app/coach/page.tsx.
//
// On the web, the browser executes log blocks by POSTing to the app's own API
// routes. Telegram has no browser, so we do the same POSTs server-side against
// the app's fixed local origin. Routing through the real routes (not the lib
// functions directly) keeps Google-Health sync, dedup, and validation identical
// to the web path — there is exactly one logging implementation.

import { CoachAction } from "@/lib/coach/parse";
// Scratchpad notes are captured at the data-write route funnels (food/measurements/
// records), so they cover every front-end (web, Telegram, +Log) exactly once —
// no per-action hook here. See lib/coach/scratchpad.ts + Phase 4.

/** The app's own origin. The dev/prod server is pinned to 127.0.0.1:3210. */
export function appBaseUrl(): string {
  return process.env.APP_BASE_URL || "http://127.0.0.1:3210";
}

export type ActionOutcome = {
  action: string;
  ok: boolean;
  detail: string;
};

async function sendJson(method: "POST" | "PATCH", path: string, body: unknown): Promise<any> {
  const res = await fetch(`${appBaseUrl()}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`(${res.status})`);
  return res.json();
}

const postJson = (path: string, body: unknown) => sendJson("POST", path, body);
const patchJson = (path: string, body: unknown) => sendJson("PATCH", path, body);

async function deleteReq(path: string): Promise<any> {
  const res = await fetch(`${appBaseUrl()}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`(${res.status})`);
  return res.json();
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Short human description of a saved reminder (mirrors the web ActionRunner). */
function reminderLabel(r: any): string {
  if (r?.kind === "daily") return `${r.text} · daily ${r.atTime}`;
  if (r?.kind === "weekly") {
    const days = Array.isArray(r.days) ? r.days.map((d: number) => DOW[d]).join("/") : "";
    return `${r.text} · ${days} ${r.atTime}`;
  }
  const when = r?.dueAt
    ? new Date(r.dueAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })
    : "";
  return `${r?.text ?? "reminder"}${when ? ` · ${when}` : ""}`;
}

/** Execute a single parsed coach action, returning a short human confirmation
 *  string mirroring the wording the web ActionRunner shows. */
export async function runAction(spec: any): Promise<string> {
  if (!spec?.action) throw new Error("bad action");

  switch (spec.action) {
    case "logWorkout": {
      const saved = await postJson("/api/workouts", spec);
      if (saved.attachedTo) return `added to ${saved.name}`;
      return (
        `${saved.name} · ${saved.durationMin} min` +
        (saved.syncedToHealth ? " · synced to Google Health" : " · saved to journal")
      );
    }
    case "logWater": {
      const glasses = Math.max(1, Math.round(Number(spec.glasses) || 1));
      let last: any = null;
      for (let g = 0; g < glasses; g++) last = await postJson("/api/water", { delta: 1 });
      return `${glasses * 250} ml added · ${(last?.ml / 1000).toFixed(2)} L today`;
    }
    case "logFood": {
      const saved = await postJson("/api/food/log", {
        name: spec.name,
        mealType: spec.mealType,
        calories: spec.calories,
        proteinG: spec.proteinG,
        carbsG: spec.carbsG,
        fatG: spec.fatG,
        glycemicLoad: spec.glycemicLoad,
        loggedAt: spec.loggedAt,
        notes: spec.notes,
        // Upgrade the model's inline estimate via decompose + USDA resolution
        // server-side; the estimate stays as the fallback if no match.
        resolveComposite: true,
      });
      const usda = saved.provenance?.source === "fdc" || saved.provenance?.source === "composite";
      return (
        `${saved.name} · ${saved.calories} kcal` +
        (usda ? " · USDA-matched" : "") +
        (saved.syncedToHealth ? " · synced to Google Health" : " · saved")
      );
    }
    case "logHabit": {
      const { record, status } = await postJson("/api/habits/record", {
        habitId: spec.habitId,
        date: spec.date,
        value: spec.value,
        note: spec.note,
      });
      if (!record) throw new Error("no matching habit");
      const v =
        typeof record.value === "boolean" ? (record.value ? "yes" : "no") : record.value;
      return (
        `${spec.habitId} · ${v}` +
        (status?.completed ? " · on track" : "") +
        (status?.streak ? ` · streak ${status.streak}d` : "")
      );
    }
    case "planWorkout": {
      const saved = await postJson("/api/workout-plans", spec);
      return (
        `${saved.name} · ${saved.date} · ${saved.durationMin} min` +
        (saved.estCalories ? ` · ~${saved.estCalories} kcal (est.)` : "")
      );
    }
    case "logExerciseSnack": {
      const state = await postJson("/api/exercise-snacks", {
        routineId: spec.routineId,
        source: "coach",
      });
      return `snack ${state.completed.length} of ${state.target} today`;
    }
    case "logMedication": {
      const { record } = await postJson("/api/medications/record", {
        medicationId: spec.medicationId,
        date: spec.date,
        doseIndex: spec.doseIndex,
        status: spec.status === "skipped" ? "skipped" : "taken",
        note: spec.note,
      });
      if (!record) throw new Error("no matching medication");
      return `${spec.medicationId} · ${record.status}`;
    }
    case "setReminder": {
      const saved = await postJson("/api/reminders", {
        text: spec.text,
        kind: spec.kind,
        dueAt: spec.dueAt,
        atTime: spec.atTime,
        days: spec.days,
      });
      return `reminder set — ${reminderLabel(saved)}`;
    }
    case "cancelReminder": {
      const key = spec.id || spec.match || "";
      const rec = await deleteReq(`/api/reminders?id=${encodeURIComponent(key)}`);
      return `reminder cancelled — ${rec.text}`;
    }
    case "rememberFact": {
      const m = await postJson("/api/coach/memory", {
        text: spec.text,
        category: spec.category,
        source: "coach",
      });
      return `remembered — ${m.text}`;
    }
    case "updateMemory": {
      const m = await patchJson("/api/coach/memory", {
        id: spec.id,
        text: spec.text,
        category: spec.category,
      });
      return `updated — ${m.text}`;
    }
    case "forgetFact": {
      await deleteReq(`/api/coach/memory?id=${encodeURIComponent(spec.id)}`);
      return "removed from memory";
    }
    case "answerQuestion": {
      await postJson("/api/coach/questions/answer", {
        id: spec.id, action: "answer", answer: spec.answer,
        memoryText: spec.memoryText, category: spec.category, topic: spec.topic,
      });
      return `noted — ${spec.memoryText || spec.answer || "saved"}`;
    }
    case "declineTopic": {
      await postJson("/api/coach/questions/answer", { id: spec.id, action: "decline", topic: spec.topic });
      return "won't bring that up again";
    }
    default:
      throw new Error(`unknown action ${spec.action}`);
  }
}

/** Execute every action in a coach reply, in order. Never throws — each action's
 *  success/failure is captured so the caller can report exactly what landed. */
export async function executeCoachActions(actions: CoachAction[]): Promise<ActionOutcome[]> {
  const outcomes: ActionOutcome[] = [];
  for (const a of actions) {
    if (!a.spec) {
      outcomes.push({ action: "unknown", ok: false, detail: "unparseable action" });
      continue;
    }
    try {
      const detail = await runAction(a.spec);
      outcomes.push({ action: a.spec.action, ok: true, detail });
    } catch (e: any) {
      outcomes.push({ action: a.spec?.action ?? "unknown", ok: false, detail: String(e.message ?? e) });
    }
  }
  return outcomes;
}
