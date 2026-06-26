// Deterministic text formatting of metric summaries for Telegram. These render
// the SAME data the Daily/Trends views read (via lib/context helpers) into a
// clean HTML message — no separate query path, no AI. The owner asking
// "show today" gets reliable numbers even if the model is unavailable.

import { getRecentDays, readinessForDate } from "@/lib/context";
import { escapeHtml } from "@/lib/telegram/bot";
import { DaySummary } from "@/lib/types";

function hours(min: number): string {
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

/** "Show today" — today's headline metrics as an HTML message. */
export async function formatToday(): Promise<string> {
  const { days, demo } = await getRecentDays(7);
  const today = days[days.length - 1];
  if (!today) return "No data for today yet.";

  const lines: string[] = [`<b>Today · ${today.date}</b>`];

  const stepPct = today.stepsGoal ? Math.round((today.steps / today.stepsGoal) * 100) : null;
  lines.push(
    `👣 Steps: <b>${today.steps.toLocaleString()}</b>` +
      (today.stepsGoal ? ` / ${today.stepsGoal.toLocaleString()}${stepPct != null ? ` (${stepPct}%)` : ""}` : "")
  );
  lines.push(
    `🏃 Active-zone: <b>${today.activeZoneMinutes}</b> min` +
      (today.azmGoal ? ` / ${today.azmGoal}` : "")
  );
  if (today.restingHeartRate) lines.push(`❤️ Resting HR: <b>${today.restingHeartRate}</b> bpm`);
  if (today.sleep) {
    lines.push(`😴 Sleep: <b>${hours(today.sleep.durationMin)}</b> · eff ${today.sleep.efficiency}%`);
  }
  lines.push(`🔥 Energy: <b>${today.caloriesOut}</b> out` + (today.caloriesIn ? ` · ${today.caloriesIn} in` : ""));

  const readiness = await readinessForDate().catch(() => null);
  if (readiness) {
    lines.push(`🧭 Readiness: <b>${readiness.score}/100</b> (${escapeHtml(readiness.band)})`);
  }

  if (demo) lines.push("", "<i>Demo data — Google Health isn't connected.</i>");
  return lines.join("\n");
}

/** "Weekly steps / week summary" — last 7 days, oldest first. */
export async function formatWeek(): Promise<string> {
  const { days, demo } = await getRecentDays(7);
  if (!days.length) return "No data this week yet.";

  const stepVals = days.map((d) => d.steps);
  const total = stepVals.reduce((s, v) => s + v, 0);
  const avg = Math.round(total / days.length);
  const activeDays = days.filter((d) => d.activeZoneMinutes > 0 || d.steps >= (d.stepsGoal || 8000)).length;
  const azmTotal = days.reduce((s, d) => s + d.activeZoneMinutes, 0);

  const lines: string[] = ["<b>This week (last 7 days)</b>"];
  lines.push(`👣 Steps: <b>${total.toLocaleString()}</b> total · ${avg.toLocaleString()}/day avg`);
  lines.push(`🏃 Active-zone: <b>${azmTotal}</b> min · active ${activeDays}/${days.length} days`);
  lines.push("", "<b>Daily steps</b>");
  for (const d of days) {
    const wd = new Date(d.date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short" });
    lines.push(`${wd} ${escapeHtml(sparkBar(d.steps, Math.max(...stepVals)))} ${d.steps.toLocaleString()}`);
  }

  if (demo) lines.push("", "<i>Demo data — Google Health isn't connected.</i>");
  return lines.join("\n");
}

/** A tiny unicode bar for at-a-glance weekly comparison. */
function sparkBar(value: number, max: number): string {
  const width = 10;
  const filled = max > 0 ? Math.round((value / max) * width) : 0;
  return "█".repeat(filled) + "░".repeat(width - filled);
}
