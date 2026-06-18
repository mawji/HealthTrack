"use client";

import { useEffect, useState } from "react";
import { IconChip, habitIcon } from "@/components/icons";
import { GoalDefinition, GoalProgress, GoalStatus } from "@/lib/types";

interface GoalsData {
  goals: GoalDefinition[];
  progress: GoalProgress[];
  demo: boolean;
  meta: Record<string, { whyNote?: string }>;
}

const STATUS_META: Record<GoalStatus, { label: string; color: string }> = {
  met: { label: "Met", color: "var(--activity)" },
  on_track: { label: "On track", color: "var(--food)" },
  needs_attention: { label: "Needs attention", color: "var(--heart)" },
  no_data: { label: "No data yet", color: "var(--ink-soft)" },
};

function targetText(g: GoalDefinition): string {
  const u = g.unit ? ` ${g.unit}` : "";
  if (g.direction === "lower_is_better") return g.targetMax != null ? `≤ ${g.targetMax}${u}` : "set a target";
  if (g.direction === "higher_is_better") return g.targetMin != null ? `≥ ${g.targetMin}${u}` : "set a target";
  return g.targetMin != null && g.targetMax != null ? `${g.targetMin}–${g.targetMax}${u}` : "set a target";
}

/** Human "X to go / over" copy from the signed delta. */
function deltaText(g: GoalDefinition, p: GoalProgress): string | null {
  if (p.delta == null || p.delta === 0) return null;
  const u = g.unit ? ` ${g.unit}` : "";
  const v = Math.abs(p.delta);
  if (g.direction === "lower_is_better") return `${v}${u} over`;
  if (g.direction === "higher_is_better") return `${v}${u} to go`;
  return `${v}${u} out of range`;
}

export default function GoalsPage() {
  const [data, setData] = useState<GoalsData | null>(null);
  const [editing, setEditing] = useState<GoalDefinition | null>(null);
  const [adding, setAdding] = useState(false);
  const [defaults, setDefaults] = useState<GoalDefinition[] | null>(null);

  const load = () =>
    fetch("/api/goals")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});

  useEffect(() => {
    load();
  }, []);

  const progressFor = (id: string) => data?.progress.find((p) => p.goalId === id);
  const active = (data?.goals ?? []).filter((g) => g.active);
  const archived = (data?.goals ?? []).filter((g) => !g.active);

  async function openAdd() {
    if (!defaults) {
      const d = await fetch("/api/goals?defaults=1").then((r) => r.json());
      setDefaults(d.defaults ?? []);
    }
    setAdding(true);
  }

  async function addDefault(id: string) {
    await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromDefault: id }),
    });
    setAdding(false);
    load();
  }

  // Defaults the user doesn't currently have active → re-addable.
  const activeIds = new Set(active.map((g) => g.id));
  const addable = (defaults ?? []).filter((d) => !activeIds.has(d.id));

  return (
    <main className="page">
      <header className="rise rise-1" style={{ marginBottom: 14 }}>
        <h1 className="page-title">Goals.</h1>
        <p className="page-sub">Targets you're working toward — general wellbeing references, not medical advice. Edit any target.</p>
      </header>

      <div className="row" style={{ justifyContent: "flex-end", marginBottom: 14 }}>
        <button className="btn" onClick={openAdd}>
          + Add a goal
        </button>
      </div>

      {!data ? (
        <p style={{ color: "var(--ink-soft)" }}>Loading…</p>
      ) : active.length === 0 ? (
        <section className="card">
          <p style={{ color: "var(--ink-soft)" }}>No active goals. Add one to start tracking.</p>
        </section>
      ) : (
        <div className="stack">
          {active.map((g) => (
            <GoalCard key={g.id} goal={g} progress={progressFor(g.id)} onEdit={() => setEditing(g)} />
          ))}
        </div>
      )}

      {data?.demo && (
        <p style={{ color: "var(--ink-soft)", fontSize: 12, marginTop: 12 }}>
          Device values are demo data — connect Google Health for your real numbers.
        </p>
      )}

      <p style={{ color: "var(--ink-soft)", fontSize: 12, marginTop: 16 }}>
        Looking for other bloodwork? See your lab reference ranges in Records.
      </p>

      {archived.length > 0 && (
        <>
          <h2 className="section-title" style={{ marginTop: 26 }}>
            Inactive
          </h2>
          <div className="stack">
            {archived.map((g) => (
              <section key={g.id} className="card row" style={{ justifyContent: "space-between", opacity: 0.75 }}>
                <div className="card-label">
                  <IconChip icon={habitIcon(g.iconKey)} color="var(--ink-soft)" />
                  {g.label}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button
                    className="btn btn-ghost"
                    onClick={async () => {
                      await fetch("/api/goals", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ fromDefault: g.id }),
                      }).catch(() => {});
                      // Custom (non-default) goals re-activate via PATCH instead.
                      if (!g.isDefault)
                        await fetch(`/api/goals?id=${encodeURIComponent(g.id)}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ active: true }),
                        });
                      load();
                    }}
                  >
                    Restore
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ color: "var(--heart)" }}
                    onClick={async () => {
                      if (!confirm(`Permanently delete "${g.label}"?`)) return;
                      await fetch(`/api/goals?id=${encodeURIComponent(g.id)}&hard=1`, { method: "DELETE" });
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

      {adding && (
        <Sheet title="Add a goal" onClose={() => setAdding(false)}>
          {addable.length === 0 ? (
            <p style={{ color: "var(--ink-soft)" }}>All goals are already active.</p>
          ) : (
            <div className="stack">
              {addable.map((d) => (
                <button
                  key={d.id}
                  className="card row"
                  style={{ justifyContent: "space-between", cursor: "pointer", textAlign: "left", width: "100%" }}
                  onClick={() => addDefault(d.id)}
                >
                  <span className="card-label">
                    <IconChip icon={habitIcon(d.iconKey)} color="var(--activity)" />
                    {d.label}
                  </span>
                  <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>{targetText(d)}</span>
                </button>
              ))}
            </div>
          )}
        </Sheet>
      )}

      {editing && (
        <GoalEditor
          goal={editing}
          whyNote={data?.meta?.[editing.metricKey]?.whyNote}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
          onDeactivate={async () => {
            await fetch(`/api/goals?id=${encodeURIComponent(editing.id)}`, { method: "DELETE" });
            setEditing(null);
            load();
          }}
        />
      )}
    </main>
  );
}

// ── goal card ────────────────────────────────────────────────────────────────

function GoalCard({ goal, progress, onEdit }: { goal: GoalDefinition; progress?: GoalProgress; onEdit: () => void }) {
  const p = progress;
  const hasValue = p?.latestValue != null;
  const noTarget = goal.direction === "lower_is_better" ? goal.targetMax == null : goal.direction === "higher_is_better" ? goal.targetMin == null : goal.targetMin == null || goal.targetMax == null;
  const status: GoalStatus = !hasValue ? "no_data" : noTarget ? "no_data" : p!.status;
  const meta = STATUS_META[status];
  const barColor = status === "no_data" ? "var(--hairline)" : meta.color;
  const pct = Math.round((p?.progress ?? 0) * 100);
  const dt = p ? deltaText(goal, p) : null;

  return (
    <section className="card">
      <button
        className="row"
        onClick={onEdit}
        style={{ justifyContent: "space-between", gap: 12, width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left", color: "var(--ink)" }}
      >
        <span className="card-label">
          <IconChip icon={habitIcon(goal.iconKey)} color={meta.color} />
          <span>
            {goal.label}
            <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 400 }}>
              Target {targetText(goal)}
            </span>
          </span>
        </span>
        <span style={{ textAlign: "right" }}>
          <span className="display-num" style={{ fontSize: 22, color: meta.color }}>
            {hasValue ? p!.latestValue : "—"}
          </span>
          {goal.unit && hasValue && <span style={{ fontSize: 11, color: "var(--ink-soft)", display: "block" }}>{goal.unit}</span>}
        </span>
      </button>

      <div style={{ marginTop: 12, height: 6, borderRadius: 999, background: "var(--bg-inset)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 999, background: barColor, transition: "width 0.3s" }} />
      </div>

      <div className="row" style={{ justifyContent: "space-between", marginTop: 10, gap: 8 }}>
        <span className="badge" style={{ background: `color-mix(in srgb, ${meta.color} 16%, transparent)`, color: meta.color }}>
          {hasValue && noTarget ? "Set a target" : meta.label}
        </span>
        <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
          {hasValue && !noTarget && dt ? dt : p?.latestDate ? `as of ${p.latestDate}` : ""}
        </span>
      </div>
    </section>
  );
}

// ── editor ───────────────────────────────────────────────────────────────────

type FormState = {
  label: string;
  unit: string;
  targetMin: string;
  targetMax: string;
  tolerancePct: string;
  note: string;
  showOnDaily: boolean;
  showOnTrends: boolean;
  coachVisible: boolean;
};

function GoalEditor({
  goal,
  whyNote,
  onClose,
  onSaved,
  onDeactivate,
}: {
  goal: GoalDefinition;
  whyNote?: string;
  onClose: () => void;
  onSaved: () => void;
  onDeactivate: () => void;
}) {
  const [f, setF] = useState<FormState>(() => ({
    label: goal.label,
    unit: goal.unit,
    targetMin: goal.targetMin != null ? String(goal.targetMin) : "",
    targetMax: goal.targetMax != null ? String(goal.targetMax) : "",
    tolerancePct: goal.tolerancePct != null ? String(goal.tolerancePct) : "",
    note: goal.note ?? "",
    showOnDaily: goal.showOnDaily,
    showOnTrends: goal.showOnTrends,
    coachVisible: goal.coachVisible,
  }));
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));

  const needsMin = goal.direction === "higher_is_better" || goal.direction === "target_range";
  const needsMax = goal.direction === "lower_is_better" || goal.direction === "target_range";

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        label: f.label.trim() || goal.label,
        unit: f.unit.trim() || undefined,
        targetMin: needsMin && f.targetMin !== "" ? Number(f.targetMin) : undefined,
        targetMax: needsMax && f.targetMax !== "" ? Number(f.targetMax) : undefined,
        tolerancePct: f.tolerancePct !== "" ? Number(f.tolerancePct) : undefined,
        note: f.note.trim() || undefined,
        showOnDaily: f.showOnDaily,
        showOnTrends: f.showOnTrends,
        coachVisible: f.coachVisible,
        active: true,
      };
      const res = await fetch(`/api/goals?id=${encodeURIComponent(goal.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) onSaved();
    } finally {
      setSaving(false);
    }
  }

  const dirLabel =
    goal.direction === "lower_is_better" ? "Lower is better" : goal.direction === "higher_is_better" ? "Higher is better" : "Target range";

  return (
    <Sheet title={`Edit ${goal.label}`} onClose={onClose}>
      <div className="stack" style={{ gap: 16 }}>
        <Field label="Name">
          <input className="field" value={f.label} onChange={(e) => set("label", e.target.value)} />
        </Field>

        <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>
          {dirLabel} · {goal.source === "lab" ? "from your lab records" : "from Google Health"}
        </div>

        <div className="grid-2">
          {needsMin && (
            <Field label={goal.direction === "higher_is_better" ? "Target (minimum)" : "Minimum"}>
              <input className="field" type="number" inputMode="decimal" value={f.targetMin} onChange={(e) => set("targetMin", e.target.value)} />
            </Field>
          )}
          {needsMax && (
            <Field label={goal.direction === "lower_is_better" ? "Target (ceiling)" : "Maximum"}>
              <input className="field" type="number" inputMode="decimal" value={f.targetMax} onChange={(e) => set("targetMax", e.target.value)} />
            </Field>
          )}
          <Field label="Unit">
            <input className="field" value={f.unit} onChange={(e) => set("unit", e.target.value)} />
          </Field>
        </div>

        {whyNote && (
          <p style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.5, background: "var(--bg-inset)", borderRadius: 12, padding: "10px 12px" }}>
            {whyNote}
          </p>
        )}

        <Field label="Note (optional)">
          <input className="field" value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="e.g. doctor wants this under 2.0" />
        </Field>

        <div className="stack" style={{ gap: 10 }}>
          <Toggle label="Show on Daily screen" checked={f.showOnDaily} onChange={(v) => set("showOnDaily", v)} />
          <Toggle label="Show on Trends" checked={f.showOnTrends} onChange={(v) => set("showOnTrends", v)} />
          <Toggle label="Visible to AI coach" checked={f.coachVisible} onChange={(v) => set("coachVisible", v)} />
        </div>

        <div className="row" style={{ justifyContent: "space-between", gap: 10, marginTop: 4 }}>
          <button className="btn btn-ghost" style={{ color: "var(--ink-soft)" }} onClick={onDeactivate}>
            Deactivate
          </button>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn" disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

// ── shared bits ──────────────────────────────────────────────────────────────

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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
        zIndex: 100,
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
          paddingBottom: "max(18px, env(safe-area-inset-bottom))",
        }}
      >
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ fontSize: 19, fontWeight: 700 }}>{title}</h2>
          <button className="icon-btn" aria-label="close" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-soft)", display: "block", marginBottom: 6 }}>{label}</span>
      {children}
    </label>
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
      <span style={{ width: 40, height: 23, borderRadius: 999, background: checked ? "var(--activity)" : "var(--hairline)", position: "relative", transition: "background 0.2s", flex: "none" }}>
        <span style={{ position: "absolute", top: 2, left: checked ? 19 : 2, width: 19, height: 19, borderRadius: "50%", background: "var(--bg)", transition: "left 0.2s" }} />
      </span>
    </button>
  );
}
