// Append-only delivery log. Cooldowns, the daily cap, and the minimum gap are
// all derived from this one record — no separate cooldown file to drift.

import { readJson, writeJson } from "@/lib/store";
import { DeliveryRecord, GuidanceCandidate } from "@/lib/proactive/types";

const LOG_FILE = "proactive/delivery-log.json";
const KEEP = 200; // bounded history

export function getLog(): DeliveryRecord[] {
  return readJson<DeliveryRecord[]>(LOG_FILE, []);
}

export function recordDelivery(c: GuidanceCandidate, date: string): DeliveryRecord {
  const rec: DeliveryRecord = {
    at: new Date().toISOString(),
    date,
    candidateId: c.id,
    category: c.category,
    cooldownKey: c.cooldownKey,
    title: c.title,
    reason: c.reason,
  };
  const log = getLog();
  log.push(rec);
  writeJson(LOG_FILE, log.slice(-KEEP));
  return rec;
}

export function deliveriesOn(date: string): DeliveryRecord[] {
  return getLog().filter((r) => r.date === date);
}

/** Most recent delivery for a cooldown key, or null. */
export function lastDeliveryForKey(key: string): DeliveryRecord | null {
  const matches = getLog().filter((r) => r.cooldownKey === key);
  return matches.length ? matches[matches.length - 1] : null;
}

export function lastDeliveryAt(): number | null {
  const log = getLog();
  return log.length ? Date.parse(log[log.length - 1].at) : null;
}
