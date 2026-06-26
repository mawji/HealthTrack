// The owner's self-report digest — deterministic, reused by both the on-demand
// /report Telegram command and the scheduled morning report. Same data path as
// the Daily/Trends views (via the metric formatters).

import { formatToday, formatWeek } from "@/lib/telegram/format";

export async function buildDailyReport(): Promise<string> {
  const [today, week] = await Promise.all([formatToday(), formatWeek()]);
  return `📋 <b>Your daily report</b>\n\n${today}\n\n${week}`;
}
