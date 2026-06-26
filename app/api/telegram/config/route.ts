// Settings-facing Telegram control surface: read status, save the bot token,
// generate a pairing code, unpair, and toggle confirm-before-log.

import { NextRequest, NextResponse } from "next/server";
import {
  isBotConfigured,
  setBotToken,
  getConfirmBeforeLog,
  setConfirmBeforeLog,
} from "@/lib/telegram/config";
import { getOwner, isPaired, startPairing, unpair, setOwnerName } from "@/lib/telegram/owner";
import { setMyCommands } from "@/lib/telegram/bot";

const COMMANDS = [
  { command: "today", description: "Today's metrics" },
  { command: "week", description: "Last 7 days" },
  { command: "report", description: "Your daily digest" },
  { command: "reset", description: "Start a fresh conversation" },
  { command: "help", description: "What I can do" },
];

function status() {
  const owner = getOwner();
  return {
    configured: isBotConfigured(),
    paired: isPaired(),
    ownerUsername: owner.username ?? null,
    ownerName: owner.ownerName ?? "",
    pairedAt: owner.pairedAt ?? null,
    confirmBeforeLog: getConfirmBeforeLog(),
  };
}

export async function GET() {
  return NextResponse.json(status());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = body?.action as string;

  switch (action) {
    case "saveToken": {
      const token = String(body.token ?? "").trim();
      if (!token) return NextResponse.json({ error: "Token required" }, { status: 400 });
      setBotToken(token);
      // Best-effort: register the slash-command menu in the Telegram client.
      await setMyCommands(COMMANDS).catch(() => {});
      return NextResponse.json(status());
    }
    case "clearToken":
      setBotToken(undefined);
      return NextResponse.json(status());
    case "pair": {
      if (!isBotConfigured()) return NextResponse.json({ error: "Save a bot token first" }, { status: 400 });
      const pairing = startPairing();
      return NextResponse.json({ ...status(), pairing });
    }
    case "unpair":
      unpair();
      return NextResponse.json(status());
    case "setConfirm":
      setConfirmBeforeLog(Boolean(body.value));
      return NextResponse.json(status());
    case "setOwnerName":
      setOwnerName(String(body.name ?? ""));
      return NextResponse.json(status());
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
