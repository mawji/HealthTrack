"use client";

import { useEffect, useState } from "react";
import { IconChip, habitIcon, HABIT_ICON_KEYS } from "@/components/icons";
import {
  HabitDefinition,
  HabitComputedStatus,
  HabitsPayload,
  HabitKind,
  HabitTargetType,
  HabitGoalMode,
} from "@/lib/types";

const COLORS = [
  "var(--activity)",
  "var(--heart)",
  "var(--sleep)",
  "var(--breath)",
  "var(--food)",
];

function targetLabel(h: HabitDefinition): string {
  const unit = h.unit ? ` ${h.unit}` : "";
  if (h.targetType === "yes_no") return h.kind === "boost" ? "do daily" : "avoid";
  switch (h.goalMode) {
    case "at_least":
      return `≥ ${h.targetMin ?? 0}${unit}`;
    case "at_most":
      return `≤ ${h.targetMax ?? 0}${unit}`;
    case "between":
      return `${h.targetMin ?? 0}–${h.targetMax ?? 0}${unit}`;
    case "exactly":
      return `= ${h.targetMin ?? 0}${unit}`;
    default:
      return h.unit ? `track${unit}` : "track";
  }
}

export default function HabitsPage() {
  const [payload, setPayload] = useState<HabitsPayload | null>(null);
  const [editing, setEditing] = useState<HabitDefinition | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // habitId being mutated

  const date = payload?.date;

  const load = () =>
    fetch("/api/habits")
      .then((r) => r.json())
      .then(setPayload)
      .catch(() => {});

  useEffect(() => {
    load();
  }, []);

  const statusFor = (id: string): HabitComputedStatus | undefined =>
    payload?.status.find((s) => s.habitId === id);
  const valueFor = (id: string): boolean | number | null =>
    statusFor(id)?.value ?? null;

  async function logValue(habit: HabitDefinition, value: boolean | number | null) {
    if (!date) return;
    setBusy(habit.id);
    try {
      await fetch("/api/habits/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ habitId: habit.id, date, value }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  const active = (payload?.habits ?? []).filter((h) => h.active);
  const archived = (payload?.habits ?? []).filter((h) => !h.active);

  return (
    <main className="page">
      <header className="rise rise-1" style={{ marginBottom: 14 }}>
        <h1 className="page-title">Habits.</h1>
        <p className="page-sub">Build the good ones, stay within limits on the rest.</p>
      </header>

      <div className="row" style={{ justifyContent: "flex-end", marginBottom: 14 }}>
        <button className="btn" onClick={() => setEditing("new")}>
          + New habit
        </button>
      </div>

      {!payload ? (
        <p style={{ color: "var(--ink-soft)" }}>Loading…</p>
      ) : active.length === 0 ? (
        <section className="card">
          <p style={{ color: "var(--ink-soft)" }}>
            No active habits yet. Create one to start tracking.
          </p>
        </section>
      ) : (
        <div className="stack">
          {active.map((h) => (
            <HabitRow
              key={h.id}
              habit={h}
              status={statusFor(h.id)}
              value={valueFor(h.id)}
              busy={busy === h.id}
              onLog={(v) => logValue(h, v)}
              onEdit={() => setEditing(h)}
            />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <>
          <h2 className="section-title" style={{ marginTop: 26 }}>
            Archived
          </h2>
          <div className="stack">
            {archived.map((h) => (
              <section
                key={h.id}
                className="card row"
                style={{ justifyContent: "space-between", opacity: 0.75 }}
              >
                <div className="card-label">
                  <IconChip icon={habitIcon(h.iconKey)} color={h.color ?? "var(--ink-soft)"} />
                  {h.name}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn-ghost" onClick={() => setEditing(h)}>
                    Restore
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ color: "var(--heart)" }}
                    onClick={async () => {
                      if (!confirm(`Permanently delete "${h.name}"? History is kept.`)) return;
                      await fetch(`/api/habits?id=${encodeURIComponent(h.id)}&hard=1`, {
                        method: "DELETE",
                      });
                      load();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {editing && (
        <HabitEditor
          habit={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
          onArchive={
            editing === "new"
              ? undefined
              : async () => {
                  await fetch(`/api/habits?id=${encodeURIComponent(editing.id)}`, {
                    method: "DELETE",
                  });
                  setEditing(null);
                  load();
                }
          }
        />
      )}
    </main>
  );
}

// ── Active habit row with today's logging control ──────────────────────────

function HabitRow({
  habit,
  status,
  value,
  busy,
  onLog,
  onEdit,
}: {
  habit: HabitDefinition;
  status?: HabitComputedStatus;
  value: boolean | number | null;
  busy: boolean;
  onLog: (v: boolean | number | null) => void;
  onEdit: () => void;
}) {
  const color = habit.color ?? "var(--activity)";
  const completed = status?.completed ?? false;
  const streak = status?.streak ?? 0;
  const stateLabel =
    value == null
      ? "not logged"
      : habit.kind === "boost"
        ? completed
          ? "target met"
          : "in progress"
        : completed
          ? "within limit"
          : "limit exceeded";
  const stateColor = completed
    ? "var(--activity)"
    : value == null
      ? "var(--ink-soft)"
      : habit.kind === "avoid"
        ? "var(--heart)"
        : "var(--ink-soft)";

  return (
    <section className="card" style={{ opacity: busy ? 0.6 : 1, transition: "opacity 0.2s" }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
        <button
          className="card-label"
          onClick={onEdit}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}
        >
          <IconChip icon={habitIcon(habit.iconKey)} color={color} />
          <span>
            {habit.name}
            <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 400 }}>
              {habit.kind === "boost" ? "Boost · " : "Avoid · "}
              {targetLabel(habit)}
            </span>
          </span>
        </button>
        {streak > 0 && (
          <span
            className="badge"
            title={`Best streak ${status?.bestStreak ?? streak} days`}
            style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
          >
            🔥 {streak}d
          </span>
        )}
      </div>

      <div className="row" style={{ justifyContent: "space-between", marginTop: 14, gap: 12, flexWrap: "wrap" }}>
        <HabitControl habit={habit} value={value} busy={busy} onLog={onLog} />
        <span style={{ fontSize: 12, fontWeight: 600, color: stateColor, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span aria-hidden style={{ fontSize: 22 }}>{completed ? "😊" : value == null ? "" : "😕"}</span>
          {stateLabel}
        </span>
      </div>
    </section>
  );
}

/** Per-target-type "today" logging control. */
function HabitControl({
  habit,
  value,
  busy,
  onLog,
}: {
  habit: HabitDefinition;
  value: boolean | number | null;
  busy: boolean;
  onLog: (v: boolean | number | null) => void;
}) {
  const color = habit.color ?? "var(--activity)";

  if (habit.targetType === "yes_no") {
    const ghost = { background: "transparent", color: "var(--ink)", border: "1px solid var(--hairline)" } as const;
    if (habit.kind === "avoid") {
      // value false = avoided (nailed it / met); value true = the behavior happened (slipped).
      const nailed = value === false;
      const slipped = value === true;
      return (
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" disabled={busy} onClick={() => onLog(nailed ? null : false)} style={nailed ? { background: "var(--activity)", color: "var(--bg)", borderColor: "var(--activity)" } : ghost}>
            ✓ Nailed it
          </button>
          <button className="btn" disabled={busy} onClick={() => onLog(slipped ? null : true)} style={slipped ? { background: "var(--heart)", color: "var(--bg)", borderColor: "var(--heart)" } : ghost}>
            ✗ I slipped
          </button>
        </div>
      );
    }
    // boost: value true = done.
    const isGood = value === true;
    return (
      <button className="btn" disabled={busy} onClick={() => onLog(isGood ? null : true)} style={isGood ? { background: color, color: "var(--bg)" } : ghost}>
        {isGood ? "Nailed it ✓" : "Mark done"}
      </button>
    );
  }

  // numeric — stepper for count, quick buttons for duration, input for quantity
  const current = typeof value === "number" ? value : 0;
  const step = habit.defaultValue && habit.defaultValue > 0 ? habit.defaultValue : 1;

  if (habit.targetType === "duration") {
    const quicks = [5, 10, 30];
    return (
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <span className="display-num" style={{ fontSize: 22, color }}>
          {current}
        </span>
        <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{habit.unit ?? "min"}</span>
        {quicks.map((q) => (
          <button key={q} className="btn btn-ghost" disabled={busy} onClick={() => onLog(current + q)} style={{ padding: "9px 14px" }}>
            +{q}
          </button>
        ))}
        {current > 0 && (
          <button className="icon-btn" disabled={busy} aria-label="reset" onClick={() => onLog(null)}>
            ↺
          </button>
        )}
      </div>
    );
  }

  if (habit.targetType === "count") {
    return (
      <div className="row" style={{ gap: 10 }}>
        <button
          className="icon-btn"
          disabled={busy || current <= 0}
          aria-label="decrease"
          onClick={() => onLog(Math.max(0, current - step) || null)}
          style={{ opacity: current <= 0 ? 0.4 : 1 }}
        >
          −
        </button>
        <div style={{ textAlign: "center", minWidth: 46 }}>
          <span className="display-num" style={{ fontSize: 22, color }}>
            {current}
          </span>
          {habit.unit && <span style={{ fontSize: 11, color: "var(--ink-soft)", display: "block" }}>{habit.unit}</span>}
        </div>
        <button
          className="icon-btn"
          disabled={busy}
          aria-label="increase"
          onClick={() => onLog(current + step)}
          style={{ background: color, color: "var(--bg)", borderColor: color, fontSize: 18 }}
        >
          +
        </button>
      </div>
    );
  }

  // quantity — free numeric entry
  return (
    <div className="row" style={{ gap: 8 }}>
      <input
        className="field"
        type="number"
        inputMode="decimal"
        defaultValue={current || ""}
        disabled={busy}
        style={{ width: 110 }}
        onBlur={(e) => {
          const v = e.target.value === "" ? null : Number(e.target.value);
          if (v !== current) onLog(v);
        }}
      />
      {habit.unit && <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>{habit.unit}</span>}
    </div>
  );
}

// ── Create / edit modal ────────────────────────────────────────────────────

type FormState = {
  name: string;
  description: string;
  iconKey: string;
  color: string;
  kind: HabitKind;
  targetType: HabitTargetType;
  goalMode: HabitGoalMode;
  unit: string;
  targetMin: string;
  targetMax: string;
  defaultValue: string;
  active: boolean;
  showOnDaily: boolean;
  coachVisible: boolean;
  nudgeEnabled: boolean;
};

function toForm(h: HabitDefinition | null): FormState {
  return {
    name: h?.name ?? "",
    description: h?.description ?? "",
    iconKey: h?.iconKey ?? "check",
    color: h?.color ?? COLORS[0],
    kind: h?.kind ?? "boost",
    targetType: h?.targetType ?? "yes_no",
    goalMode: h?.goalMode ?? "at_least",
    unit: h?.unit ?? "",
    targetMin: h?.targetMin != null ? String(h.targetMin) : "",
    targetMax: h?.targetMax != null ? String(h.targetMax) : "",
    defaultValue: h?.defaultValue != null ? String(h.defaultValue) : "",
    active: h?.active ?? true,
    showOnDaily: h?.showOnDaily ?? true,
    coachVisible: h?.coachVisible ?? true,
    nudgeEnabled: h?.nudgeEnabled ?? false,
  };
}

function HabitEditor({
  habit,
  onClose,
  onSaved,
  onArchive,
}: {
  habit: HabitDefinition | null;
  onClose: () => void;
  onSaved: () => void;
  onArchive?: () => void;
}) {
  const [f, setF] = useState<FormState>(() => toForm(habit));
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));

  const numeric = f.targetType !== "yes_no";
  const goalModes: HabitGoalMode[] =
    f.kind === "boost"
      ? ["at_least", "between", "exactly", "none"]
      : ["at_most", "between", "exactly", "none"];
  const needsMin = numeric && (f.goalMode === "at_least" || f.goalMode === "between" || f.goalMode === "exactly");
  const needsMax = numeric && (f.goalMode === "at_most" || f.goalMode === "between");

  async function save() {
    if (!f.name.trim()) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: f.name.trim(),
        description: f.description.trim() || undefined,
        iconKey: f.iconKey,
        color: f.color,
        kind: f.kind,
        targetType: f.targetType,
        goalMode: numeric ? f.goalMode : "none",
        unit: f.unit.trim() || undefined,
        targetMin: needsMin && f.targetMin !== "" ? Number(f.targetMin) : undefined,
        targetMax: needsMax && f.targetMax !== "" ? Number(f.targetMax) : undefined,
        defaultValue: f.defaultValue !== "" ? Number(f.defaultValue) : undefined,
        active: true, // saving from the editor always reactivates
        showOnDaily: f.showOnDaily,
        coachVisible: f.coachVisible,
        nudgeEnabled: f.nudgeEnabled,
      };
      const url = habit ? `/api/habits?id=${encodeURIComponent(habit.id)}` : "/api/habits";
      const res = await fetch(url, {
        method: habit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in srgb, var(--ink) 38%, transparent)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 100, // above the floating bottom nav (z-index 50)
        padding: 0,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          width: "min(560px, 100%)",
          maxHeight: "92vh",
          overflowY: "auto",
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          // clear the home-indicator / safe area so the action row isn't flush to the edge
          paddingBottom: "max(18px, env(safe-area-inset-bottom))",
        }}
      >
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ fontSize: 19, fontWeight: 700 }}>{habit ? "Edit habit" : "New habit"}</h2>
          <button className="icon-btn" aria-label="close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <Field label="Name">
            <input className="field" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Read, Coffee, Stretch" />
          </Field>

          <Field label="Description (optional)">
            <input className="field" value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="What and why" />
          </Field>

          <Field label="Type">
            <Segmented
              options={[
                { value: "boost", label: "Boost — do more" },
                { value: "avoid", label: "Avoid — stay under" },
              ]}
              value={f.kind}
              onChange={(v) => {
                set("kind", v as HabitKind);
                set("goalMode", v === "avoid" ? "at_most" : "at_least");
              }}
            />
          </Field>

          <Field label="Icon">
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {HABIT_ICON_KEYS.map((k) => (
                <button
                  key={k}
                  aria-label={k}
                  onClick={() => set("iconKey", k)}
                  style={{
                    border: f.iconKey === k ? `2px solid ${f.color}` : "1px solid var(--hairline)",
                    borderRadius: 12,
                    padding: 5,
                    background: "var(--bg-inset)",
                    cursor: "pointer",
                    display: "flex",
                  }}
                >
                  <IconChip icon={habitIcon(k)} color={f.color} size={24} />
                </button>
              ))}
            </div>
          </Field>

          <Field label="Color">
            <div className="row" style={{ gap: 10 }}>
              {COLORS.map((c) => (
                <button
                  key={c}
                  aria-label={c}
                  onClick={() => set("color", c)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: c,
                    border: f.color === c ? "3px solid var(--ink)" : "2px solid var(--hairline)",
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>
          </Field>

          <Field label="Tracking">
            <select className="field" value={f.targetType} onChange={(e) => set("targetType", e.target.value as HabitTargetType)}>
              <option value="yes_no">Yes / no (did it or not)</option>
              <option value="count">Count (cups, glasses, times)</option>
              <option value="duration">Duration (minutes)</option>
              <option value="quantity">Quantity (grams, pages, …)</option>
            </select>
          </Field>

          {numeric && (
            <>
              <Field label="Goal">
                <select className="field" value={f.goalMode} onChange={(e) => set("goalMode", e.target.value as HabitGoalMode)}>
                  {goalModes.map((g) => (
                    <option key={g} value={g}>
                      {GOAL_LABELS[g]}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid-2">
                {needsMin && (
                  <Field label={f.goalMode === "exactly" ? "Target" : "Minimum"}>
                    <input className="field" type="number" value={f.targetMin} onChange={(e) => set("targetMin", e.target.value)} />
                  </Field>
                )}
                {needsMax && (
                  <Field label="Maximum">
                    <input className="field" type="number" value={f.targetMax} onChange={(e) => set("targetMax", e.target.value)} />
                  </Field>
                )}
                <Field label="Unit">
                  <input className="field" value={f.unit} onChange={(e) => set("unit", e.target.value)} placeholder="min, cups, pages" />
                </Field>
                <Field label="Step / default">
                  <input className="field" type="number" value={f.defaultValue} onChange={(e) => set("defaultValue", e.target.value)} placeholder="1" />
                </Field>
              </div>
            </>
          )}

          <div className="stack" style={{ gap: 10 }}>
            <Toggle label="Show on Daily screen" checked={f.showOnDaily} onChange={(v) => set("showOnDaily", v)} />
            <Toggle label="Visible to AI coach" checked={f.coachVisible} onChange={(v) => set("coachVisible", v)} />
            <Toggle label="Enable nudges (coming soon)" checked={f.nudgeEnabled} onChange={(v) => set("nudgeEnabled", v)} />
          </div>

          <div className="row" style={{ justifyContent: "space-between", gap: 10, marginTop: 4 }}>
            {onArchive ? (
              <button className="btn btn-ghost" style={{ color: "var(--ink-soft)" }} onClick={onArchive}>
                Archive
              </button>
            ) : (
              <span />
            )}
            <div className="row" style={{ gap: 10 }}>
              <button className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button className="btn" disabled={saving || !f.name.trim()} onClick={save}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const GOAL_LABELS: Record<HabitGoalMode, string> = {
  at_least: "At least",
  at_most: "At most",
  between: "Between",
  exactly: "Exactly",
  none: "Just track it",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-soft)", display: "block", marginBottom: 6 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="row" style={{ gap: 8 }}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className="btn"
          style={
            value === o.value
              ? { flex: 1 }
              : { flex: 1, background: "transparent", color: "var(--ink)", border: "1px solid var(--hairline)" }
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="row"
      style={{
        justifyContent: "space-between",
        width: "100%",
        background: "var(--bg-inset)",
        border: "1px solid var(--hairline)",
        borderRadius: 12,
        padding: "11px 14px",
        cursor: "pointer",
        color: "var(--ink)",
      }}
    >
      <span style={{ fontSize: 14 }}>{label}</span>
      <span
        style={{
          width: 40,
          height: 23,
          borderRadius: 999,
          background: checked ? "var(--activity)" : "var(--hairline)",
          position: "relative",
          transition: "background 0.2s",
          flex: "none",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 19 : 2,
            width: 19,
            height: 19,
            borderRadius: "50%",
            background: "var(--bg)",
            transition: "left 0.2s",
          }}
        />
      </span>
    </button>
  );
}
