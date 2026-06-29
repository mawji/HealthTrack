// The owner's self-report digest — deterministic, reused by both the on-demand
// /report Telegram command and the scheduled morning report. Same data path as
// the Daily/Trends views (via the metric formatters).

import { formatToday, formatWeek } from "@/lib/telegram/format";
import { missedCriticalToday } from "@/lib/medication-reminders";
import { escapeHtml } from "@/lib/telegram/bot";

export async function buildDailyReport(): Promise<string> {
  const [today, week] = await Promise.all([formatToday(), formatWeek()]);
  let meds = "";
  try {
    const missed = missedCriticalToday();
    if (missed.length) {
      const list = missed.map((m) => `${escapeHtml(m.name)} (${m.time})`).join(", ");
      meds = `\n\n⚠️ <b>Critical doses not yet marked taken:</b> ${list}`;
    }
  } catch {
    // medications are optional
  }
  return `📋 <b>Your daily report</b>\n\n${today}\n\n${week}${meds}`;
}
