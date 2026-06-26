// Shared parser for the coach's fenced protocols. The web chat (app/coach/page.tsx)
// and the Telegram handler both consume the same coach output, so the fence regex
// and the lenient JSON parse live here — one source of truth, no parallel logic.
//
//   ```viz  → a visual card spec (rendered as a chart on web, formatted as text on Telegram)
//   ```log  → an action the app executes on the user's behalf (logWorkout/logWater/...)

export const FENCE_RE = /```(viz|log)\s*([\s\S]*?)```/g;

/** Parse a fenced JSON payload, tolerating the single-quote / unquoted-key
 *  sloppiness smaller models sometimes emit. Returns null when unparseable. */
export function tryParseSpec(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    try {
      const relaxed = raw
        .replace(/([{,]\s*)([A-Za-z_]\w*)(\s*:)/g, '$1"$2"$3')
        .replace(/'/g, '"');
      return JSON.parse(relaxed);
    } catch {
      return null;
    }
  }
}

export type CoachAction = { spec: any; raw: string };

/** Split a *complete* coach reply into its prose (fences removed), the viz card
 *  specs, and the action specs. Unlike the web client's streaming splitParts,
 *  this assumes the full reply is in hand (Telegram has no incremental render). */
export function parseCoachReply(content: string): {
  prose: string;
  vizSpecs: any[];
  actions: CoachAction[];
} {
  const vizSpecs: any[] = [];
  const actions: CoachAction[] = [];
  for (const m of content.matchAll(FENCE_RE)) {
    if (m[1] === "log") actions.push({ spec: tryParseSpec(m[2]), raw: m[2].trim() });
    else vizSpecs.push(tryParseSpec(m[2]));
  }
  // Prose = everything with the fenced blocks stripped, tidied.
  const prose = content
    .replace(FENCE_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { prose, vizSpecs, actions };
}
