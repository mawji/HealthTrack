// Non-streaming coach turn — the server-side twin of app/api/chat/route.ts.
//
// The web chat streams tokens to the browser; Telegram (and any other headless
// caller) needs the *whole* reply in one shot. Both share the exact same brain:
// buildCoachContext + COACH_PERSONA + the provider boundary. Do NOT fork the
// persona or context here — that's the whole point of this extraction.

import { buildCoachContext, COACH_PERSONA } from "@/lib/context";
import { completeWithFallback } from "@/lib/ai-provider";
import { ChatMessage } from "@/lib/types";
import { localDateTimeStr } from "@/lib/store";

export type CoachTurnResult = {
  /** The full assistant reply, including any ```viz / ```log fences. */
  text: string;
  /** True when the primary provider failed and the secondary served. */
  usedSecondary: boolean;
  servedLabel: string;
};

/**
 * Run one coach turn over the given history (most recent last) and return the
 * complete reply text. `contextDays` mirrors the web route's 14-day window.
 */
export async function runCoachTurn(
  messages: ChatMessage[],
  contextDays = 14
): Promise<CoachTurnResult> {
  const { text: context } = await buildCoachContext(contextDays);
  const system = `${COACH_PERSONA}\n\nCurrent date & time: ${localDateTimeStr()}\n\n${context}`;

  const { text, usedSecondary, servedLabel } = await completeWithFallback([
    { role: "system", content: system },
    ...messages.slice(-20).map((m) => ({ role: m.role, content: m.content })),
  ]);

  return { text, usedSecondary, servedLabel };
}
