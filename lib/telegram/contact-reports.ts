// Scheduled per-contact reports (todo #24): e.g. a trainer's automatic morning
// activity/readiness summary. Each report is built through the SAME choke point
// (filterForContact via buildScopedReply) so a report can never exceed the
// contact's granted scopes, and every send is audited. The local scheduler calls
// this periodically; we track last-sent per subscription so each fires once.

import { readJson, writeJson, localDateStr, APP_TZ } from "@/lib/store";
import { listContacts, isContactUsable } from "@/lib/telegram/contacts";
import { buildScopedReply } from "@/lib/telegram/sharing";
import { sendMessage } from "@/lib/telegram/bot";

const STATE_FILE = "telegram/report-state.json";

function nowLocalMin(): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: APP_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return (h % 24) * 60 + m;
}

function hmToMin(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : 7 * 60;
}

export async function runDueContactReports(): Promise<{ sent: number }> {
  const state = readJson<Record<string, string>>(STATE_FILE, {}); // subId → last local date sent
  const today = localDateStr();
  const nowMin = nowLocalMin();
  let sent = 0;

  for (const contact of listContacts()) {
    if (!isContactUsable(contact) || contact.telegramChatId == null) continue;
    for (const sub of contact.reports) {
      if (state[sub.id] === today) continue; // already sent today
      if (nowMin < hmToMin(sub.timeLocal)) continue; // not yet its time
      // Weekly: only fire if at least 6 days have passed since the last send.
      if (sub.cadence === "weekly" && state[sub.id]) {
        const days = (Date.parse(today) - Date.parse(state[sub.id])) / 86400000;
        if (days < 6) continue;
      }
      const reply = await buildScopedReply(contact, sub.scopes, "report");
      if (reply.text) {
        const header = `📋 Your ${sub.cadence} update`;
        await sendMessage(contact.telegramChatId, `${header}\n\n${reply.text}`).catch(() => {});
        sent++;
      }
      state[sub.id] = today; // mark done regardless so we don't retry all day
    }
  }

  writeJson(STATE_FILE, state);
  return { sent };
}
