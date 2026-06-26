// Adversarial self-test for the sharing choke point. There's no unit-test
// runner in this project, so this endpoint exercises filterForContact through
// the real TypeScript in the real runtime against in-memory fixtures (no store
// writes, no Telegram). It asserts the privacy invariants: default-deny,
// out-of-scope rejection, revoked/expired/unbound contacts get nothing, and an
// unknown sender resolves to no contact. GET it after touching sharing code.

import { NextResponse } from "next/server";
import { filterForContact } from "@/lib/telegram/sharing";
import { resolveContact, SharedContact } from "@/lib/telegram/contacts";

function contact(over: Partial<SharedContact>): SharedContact {
  return {
    id: "fixture",
    name: "Fixture",
    status: "active",
    telegramUserId: 111,
    scopes: [],
    leaderboard: false,
    reports: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

export async function GET() {
  const now = Date.UTC(2026, 5, 25);
  const results: { name: string; ok: boolean; got: unknown }[] = [];
  const expect = (name: string, got: unknown, want: unknown) =>
    results.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got });

  const trainer = contact({ scopes: ["steps", "workout_duration"] });

  // 1. Default-deny: a usable contact with no granted scopes shares nothing.
  expect("default-deny (no scopes)", filterForContact(contact({ scopes: [] }), undefined, now), []);

  // 2. Full allowed set when no specific request.
  expect("full set (no request)", filterForContact(trainer, undefined, now), ["steps", "workout_duration"]);

  // 3. In-scope request is honored.
  expect("in-scope request", filterForContact(trainer, ["steps"], now), ["steps"]);

  // 4. Out-of-scope request yields nothing (no leak of what exists).
  expect("out-of-scope request", filterForContact(trainer, ["bp", "glucose"], now), []);

  // 5. Mixed request returns only the granted intersection.
  expect("mixed request → intersection", filterForContact(trainer, ["steps", "bp"], now), ["steps"]);

  // 6. Revoked contact gets nothing even with scopes.
  expect("revoked → none", filterForContact(contact({ status: "revoked", scopes: ["steps"] }), undefined, now), []);

  // 7. Pending (unbound) contact gets nothing.
  expect("pending → none", filterForContact(contact({ status: "pending", telegramUserId: undefined, scopes: ["steps"] }), undefined, now), []);

  // 8. Expired share gets nothing.
  expect("expired → none", filterForContact(contact({ scopes: ["steps"], expiresAt: "2026-06-01T00:00:00Z" }), undefined, now), []);

  // 9. Unbound (no telegramUserId) gets nothing.
  expect("unbound → none", filterForContact(contact({ telegramUserId: undefined, scopes: ["steps"] }), undefined, now), []);

  // 10. Unknown inbound sender resolves to no contact (store-based).
  expect("unknown sender → no contact", resolveContact(-999999999) === null, true);

  // 11. Unknown scope keys are dropped (sanitized).
  expect("unknown scope key dropped", filterForContact(contact({ scopes: ["steps", "not_a_scope"] }), undefined, now), ["steps"]);

  const pass = results.every((r) => r.ok);
  return NextResponse.json({ pass, total: results.length, failed: results.filter((r) => !r.ok), results }, { status: pass ? 200 : 500 });
}
