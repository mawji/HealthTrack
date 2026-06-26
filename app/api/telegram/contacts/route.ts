// Owner-facing CRUD for shared contacts + the scope catalog, presets, and audit
// trail for the in-app Sharing surface. All visibility decisions are made here
// and persisted locally; enforcement happens server-side in the bot handler via
// filterForContact (never trusted to the UI).

import { NextRequest, NextResponse } from "next/server";
import {
  listContacts,
  createContact,
  updateContact,
  deleteContact,
  revokeContact,
  startContactPairing,
} from "@/lib/telegram/contacts";
import { SCOPE_CATALOG, PRESET_SCOPES, PresetName } from "@/lib/telegram/scopes";
import { getAudit } from "@/lib/telegram/audit";
import { getBotToken } from "@/lib/telegram/config";

const CATALOG = SCOPE_CATALOG.map((s) => ({
  key: s.key,
  label: s.label,
  category: s.category,
  leaderboardEligible: s.leaderboardEligible,
}));

function payload() {
  return {
    contacts: listContacts(),
    catalog: CATALOG,
    presets: PRESET_SCOPES,
    audit: getAudit().slice(-50).reverse(),
    botToken: Boolean(getBotToken()),
  };
}

export async function GET() {
  return NextResponse.json(payload());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = body?.action as string;

  switch (action) {
    case "create": {
      if (!body.name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });
      const c = createContact({
        name: body.name,
        phone: body.phone,
        preset: body.preset as PresetName,
        scopes: body.scopes,
        leaderboard: body.leaderboard,
      });
      return NextResponse.json({ ...payload(), created: c.id });
    }
    case "update": {
      const c = updateContact(body.id, {
        name: body.name,
        phone: body.phone,
        preset: body.preset,
        scopes: body.scopes,
        leaderboard: body.leaderboard,
        expiresAt: body.expiresAt,
        reports: body.reports,
      });
      if (!c) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
      return NextResponse.json(payload());
    }
    case "pair": {
      const p = startContactPairing(body.id);
      if (!p) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
      return NextResponse.json({ ...payload(), pairing: p });
    }
    case "revoke": {
      const c = revokeContact(body.id);
      if (!c) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
      return NextResponse.json(payload());
    }
    case "delete": {
      if (!deleteContact(body.id)) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
      return NextResponse.json(payload());
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
