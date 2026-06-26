// The Telegram message brain. Receives a single parsed Bot API update (pumped
// in by the long-poll bridge), enforces the owner gate, and routes to either a
// slash command or a full coach turn. All coaching/logging reuses the same
// pipeline as the web app (runCoachTurn + executeCoachActions) — no parallel
// brain. Item 24 will widen the gate to scoped contacts; everything here that
// assumes "owner" stays behind authorize().

import { authorize, completePairing, isPaired, ownerLabel } from "@/lib/telegram/owner";
import { resolveContact, completeContactPairing, SharedContact } from "@/lib/telegram/contacts";
import { buildScopedReply, requestedScopesFromText } from "@/lib/telegram/sharing";
import { getConfirmBeforeLog } from "@/lib/telegram/config";
import {
  sendMessage,
  answerCallback,
  clearButtons,
  escapeHtml,
  downloadFile,
  InlineButton,
} from "@/lib/telegram/bot";
import { transcribe } from "@/lib/transcribe";
import { appendTurn, getThread, resetThread } from "@/lib/telegram/thread";
import { formatToday, formatWeek } from "@/lib/telegram/format";
import { createDraft, takeDraft } from "@/lib/telegram/drafts";
import { runCoachTurn } from "@/lib/coach/run";
import { parseCoachReply, CoachAction } from "@/lib/coach/parse";
import { executeCoachActions, ActionOutcome } from "@/lib/coach/actions";
import { buildDailyReport } from "@/lib/proactive/report";

// ── Minimal Bot API update shapes (only the fields we read) ──────────────────
type TgUser = { id: number; username?: string; first_name?: string };
type TgChat = { id: number };
type TgVoice = { file_id: string; duration?: number; mime_type?: string };
type TgMessage = { message_id: number; chat: TgChat; from?: TgUser; text?: string; voice?: TgVoice; audio?: TgVoice };
type TgCallback = { id: string; data?: string; from: TgUser; message?: TgMessage };
export type TgUpdate = { message?: TgMessage; callback_query?: TgCallback };

const HELP = [
  "<b>HealthTrack coach</b> — I'm your coach, here on Telegram.",
  "",
  "Just talk to me: ask about your sleep, readiness, training, or nutrition, or tell me what you did (\"ran 5k this morning\") and I'll log it.",
  "",
  "<b>Commands</b>",
  "/today — today's metrics",
  "/week — last 7 days",
  "/report — your daily digest",
  "/reset — start a fresh conversation",
  "/help — this message",
].join("\n");

/** Entry point — never throws; logs and swallows so the bridge stays alive. */
export async function handleUpdate(update: TgUpdate): Promise<void> {
  try {
    if (update.callback_query) return await handleCallback(update.callback_query);
    if (update.message) return await handleMessage(update.message);
  } catch (e) {
    console.error("Telegram handler error:", e);
  }
}

async function handleMessage(msg: TgMessage): Promise<void> {
  const chatId = msg.chat.id;
  const fromId = msg.from?.id;
  let text = (msg.text ?? "").trim();

  // Voice note / audio → transcribe locally (whisper) and treat as the message.
  // Only paired/allow-listed users reach a transcript that does anything; we
  // gate below exactly as for text. (We don't transcribe before knowing the
  // sender to avoid doing work for strangers.)
  const voice = msg.voice ?? msg.audio;
  if (!text && voice) {
    if (authorize(chatId) !== "owner" && (fromId == null || !resolveContact(fromId))) return; // ignore strangers
    try {
      const audio = await downloadFile(voice.file_id);
      const r = await transcribe(audio, "voice.ogg");
      text = r.text.trim();
    } catch (e) {
      console.error("voice transcription failed:", e);
      return void (await sendMessage(chatId, "⚠ Couldn't transcribe that voice note. Try again, or type it."));
    }
    if (!text) return void (await sendMessage(chatId, "🎤 I couldn't make out any words — try again?"));
    // Echo what was heard so a mis-transcription is visible before it's acted on.
    await sendMessage(chatId, `🎤 Heard: “${escapeHtml(text)}”`);
  }

  if (!text) return;

  // ── Pairing: the ONLY thing an unverified chat may do ──────────────────────
  const startMatch = text.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
  if (startMatch) {
    const code = startMatch[1]?.trim();
    if (authorize(chatId) === "owner") {
      return void (await sendMessage(chatId, "You're already paired. " + HELP));
    }
    // Owner pairing first (code from Settings → Telegram).
    if (code && completePairing(code, chatId, msg.from?.username)) {
      return void (await sendMessage(chatId, "✅ Paired! I'm your HealthTrack coach now.\n\n" + HELP));
    }
    // Contact pairing: bind this Telegram user id to an owner-created contact.
    if (code && fromId != null) {
      const bound = completeContactPairing(code, fromId, chatId);
      if (bound) return void (await welcomeContact(bound, chatId));
    }
    // No valid code → say how to pair, but reveal nothing about the owner.
    return void (await sendMessage(
      chatId,
      "To connect, send the pairing code you were given as <code>/start &lt;code&gt;</code>."
    ));
  }

  // ── Allow-list gate ────────────────────────────────────────────────────────
  // Owner → full coach. Bound active contact → scoped, read-only. Else: silence.
  if (authorize(chatId) !== "owner") {
    const contact = fromId != null ? resolveContact(fromId) : null;
    if (contact) return await handleContactMessage(contact, chatId, text);
    return; // unknown / revoked / expired sender — ignored silently
  }

  // ── Slash commands ─────────────────────────────────────────────────────────
  if (text.startsWith("/")) {
    const cmd = text.slice(1).split(/\s+/)[0].toLowerCase().replace(/@\w+$/, "");
    const rest = text.slice(text.indexOf(cmd) + cmd.length).trim();
    switch (cmd) {
      case "help":
        return void (await sendMessage(chatId, HELP));
      case "reset":
        resetThread();
        return void (await sendMessage(chatId, "🧹 Fresh start — previous conversation cleared."));
      case "today":
        return void (await sendMessage(chatId, await formatToday()));
      case "week":
        return void (await sendMessage(chatId, await formatWeek()));
      case "report":
        return void (await sendMessage(chatId, await buildDailyReport()));
      case "log":
        // Force a coach turn on the remaining text (or prompt if empty).
        if (!rest) return void (await sendMessage(chatId, "What should I log? e.g. <code>/log ran 5k this morning</code>"));
        return await coachTurn(chatId, rest);
      default:
        return void (await sendMessage(chatId, "Unknown command. " + HELP));
    }
  }

  // ── Free-form → coach ──────────────────────────────────────────────────────
  await coachTurn(chatId, text);
}

/** Run a coach turn over the owner's Telegram thread and reply. */
async function coachTurn(chatId: number, userText: string): Promise<void> {
  appendTurn("user", userText);
  const history = getThread();

  let result;
  try {
    result = await runCoachTurn(history);
  } catch (e: any) {
    return void (await sendMessage(chatId, `⚠ Coach unavailable: ${escapeHtml(String(e.message ?? e))}`));
  }

  const { prose, vizSpecs, actions } = parseCoachReply(result.text);
  appendTurn("assistant", prose || result.text);

  // Compose the visible reply: prose + any card data rendered as text.
  const segments: string[] = [];
  if (prose) segments.push(escapeHtml(prose));
  for (const spec of vizSpecs) {
    const line = vizToText(spec);
    if (line) segments.push(line);
  }
  let body = segments.join("\n\n") || "…";
  if (result.usedSecondary) body += `\n\n<i>(${escapeHtml(result.servedLabel)} fallback)</i>`;

  const realActions = actions.filter((a) => a.spec);
  if (realActions.length && getConfirmBeforeLog()) {
    // Hold for confirmation — nothing is written until the owner taps Confirm.
    const id = createDraft(chatId, realActions);
    body += "\n\n" + describePending(realActions);
    const buttons: InlineButton[][] = [
      [
        { text: "✅ Confirm", callback_data: `confirm:${id}` },
        { text: "✖ Cancel", callback_data: `cancel:${id}` },
      ],
    ];
    return void (await sendMessage(chatId, body, { buttons }));
  }

  if (realActions.length) {
    const outcomes = await executeCoachActions(realActions);
    body += "\n\n" + describeOutcomes(outcomes);
  }
  await sendMessage(chatId, body);
}

// ── Contact (third-party) flow: read-only, scope-limited, no coach/logging ────

async function welcomeContact(contact: SharedContact, chatId: number): Promise<void> {
  const reply = await buildScopedReply(contact, null);
  const intro =
    `👋 You're connected to <b>${escapeHtml(ownerLabel())}</b>. ` +
    `You'll only ever see what they've chosen to share — just ask (e.g. "how's training this week?").`;
  await sendMessage(chatId, reply.text ? `${intro}\n\n${reply.text}` : intro);
}

async function handleContactMessage(contact: SharedContact, chatId: number, text: string): Promise<void> {
  // Contacts are pure consumers: no logging, no coach actions, no AI advice.
  // Map their question to specific scopes (or null = their full allowed summary),
  // then enforce via the choke point in buildScopedReply.
  const requested = requestedScopesFromText(text);
  const reply = await buildScopedReply(contact, requested);

  if (reply.deniedRequest) {
    return void (await sendMessage(chatId, "That isn't shared with you. You can ask about what the owner has chosen to share."));
  }
  if (!reply.text) {
    return void (await sendMessage(chatId, "Nothing to show right now."));
  }
  await sendMessage(chatId, reply.text);
}

async function handleCallback(cb: TgCallback): Promise<void> {
  const chatId = cb.message?.chat.id;
  if (chatId == null || authorize(chatId) !== "owner") {
    return void (await answerCallback(cb.id));
  }
  const [verb, id] = (cb.data ?? "").split(":");
  const draft = id ? takeDraft(id) : null;

  if (cb.message) await clearButtons(chatId, cb.message.message_id);

  if (!draft) {
    await answerCallback(cb.id, "That request expired.");
    return void (await sendMessage(chatId, "⌛ That log request expired — send it again if you still want it."));
  }
  if (verb === "cancel") {
    await answerCallback(cb.id, "Cancelled");
    return void (await sendMessage(chatId, "✖ Cancelled — nothing was logged."));
  }
  // confirm
  await answerCallback(cb.id, "Logging…");
  const outcomes = await executeCoachActions(draft.actions);
  await sendMessage(chatId, describeOutcomes(outcomes));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function describePending(actions: CoachAction[]): string {
  const names = actions.map((a) => labelFor(a.spec)).join(", ");
  return `📝 Ready to log: <b>${escapeHtml(names)}</b> — confirm?`;
}

function describeOutcomes(outcomes: ActionOutcome[]): string {
  return outcomes
    .map((o) => (o.ok ? `✅ ${escapeHtml(o.detail)}` : `⚠ ${escapeHtml(o.action)} failed: ${escapeHtml(o.detail)}`))
    .join("\n");
}

function labelFor(spec: any): string {
  switch (spec?.action) {
    case "logWorkout": return `${spec.name ?? "workout"} (${spec.durationMin ?? "?"} min)`;
    case "logWater": return `${(spec.glasses ?? 1)} glass(es) water`;
    case "logFood": return `${spec.name ?? "meal"} (${spec.calories ?? "?"} kcal)`;
    case "logHabit": return `habit ${spec.habitId ?? "?"}`;
    case "planWorkout": return `plan: ${spec.name ?? "workout"} on ${spec.date ?? "?"}`;
    default: return spec?.action ?? "action";
  }
}

/** Compact text rendering of a viz card for Telegram (no canvas). */
function vizToText(spec: any): string | null {
  if (!spec?.type) return null;
  switch (spec.type) {
    case "steps":
      return `📊 Steps ${spec.steps?.toLocaleString?.() ?? spec.steps}${spec.goal ? ` / ${spec.goal.toLocaleString?.() ?? spec.goal}` : ""}`;
    case "sleep":
      return `📊 Sleep ${Math.floor((spec.durationMin ?? 0) / 60)}h ${(spec.durationMin ?? 0) % 60}m · eff ${spec.efficiency ?? "?"}%`;
    case "energy":
      return `📊 Energy ${spec.caloriesIn ?? "?"} in / ${spec.caloriesOut ?? "?"} out`;
    case "vitals":
      return `📊 ${["spo2", "hrv", "breathing", "weight"].filter((k) => spec[k] != null).map((k) => `${k} ${spec[k]}`).join(" · ")}`;
    case "metric":
      return `📊 ${escapeHtml(spec.title ?? "metric")}: ${escapeHtml(String(spec.value ?? ""))}`;
    default:
      return null;
  }
}
