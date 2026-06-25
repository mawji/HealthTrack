"use client";

import { useEffect, useState } from "react";
import {
  ActivityLevel,
  BiologicalSex,
  ProfileDerived,
  UserProfile,
  WeightGoal,
} from "@/lib/types";
import { NutritionTargets, TargetsUnavailable } from "@/lib/coach/nutrition-targets";

const ACTIVITY_OPTIONS: { value: ActivityLevel; label: string }[] = [
  { value: "sedentary", label: "Sedentary (little exercise)" },
  { value: "light", label: "Light (1–3 days/week)" },
  { value: "moderate", label: "Moderate (3–5 days/week)" },
  { value: "active", label: "Active (6–7 days/week)" },
  { value: "very_active", label: "Very active (hard daily / physical job)" },
];

const GOAL_OPTIONS: { value: WeightGoal; label: string }[] = [
  { value: "lose", label: "Lose weight" },
  { value: "maintain", label: "Maintain weight" },
  { value: "gain", label: "Gain weight" },
];

const BMI_LABEL: Record<string, string> = {
  underweight: "Underweight",
  normal: "Healthy weight",
  overweight: "Overweight",
  obese: "Obese",
};

type Form = {
  sex: BiologicalSex | "";
  birthDate: string;
  heightCm: string;
  weightKg: string;
  activityLevel: ActivityLevel | "";
  goal: WeightGoal | "";
  targetRateKgPerWeek: string;
  pregnantOrLactating: boolean;
  conditions: string;
};

function toForm(p: UserProfile): Form {
  return {
    sex: p.sex ?? "",
    birthDate: p.birthDate ?? "",
    heightCm: p.heightCm != null ? String(p.heightCm) : "",
    weightKg: p.weightKg != null ? String(p.weightKg) : "",
    activityLevel: p.activityLevel ?? "",
    goal: p.goal ?? "",
    targetRateKgPerWeek: p.targetRateKgPerWeek != null ? String(p.targetRateKgPerWeek) : "",
    pregnantOrLactating: p.pregnantOrLactating,
    conditions: p.conditions ?? "",
  };
}

export default function ProfilePage() {
  const [form, setForm] = useState<Form | null>(null);
  const [derived, setDerived] = useState<ProfileDerived | null>(null);
  const [targets, setTargets] = useState<NutritionTargets | TargetsUnavailable | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const apply = (payload: { profile: UserProfile; derived: ProfileDerived }) => {
    setForm(toForm(payload.profile));
    setDerived(payload.derived);
  };

  const loadTargets = () =>
    fetch("/api/nutrition/targets")
      .then((r) => r.json())
      .then(setTargets)
      .catch(() => {});

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then(apply)
      .catch(() => {});
    loadTargets();
  }, []);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setSaved(false);
  };

  async function save() {
    if (!form) return;
    setSaving(true);
    setSaved(false);
    try {
      const body = {
        sex: form.sex || null,
        birthDate: form.birthDate || null,
        heightCm: form.heightCm !== "" ? Number(form.heightCm) : null,
        weightKg: form.weightKg !== "" ? Number(form.weightKg) : null,
        activityLevel: form.activityLevel || null,
        goal: form.goal || null,
        targetRateKgPerWeek: form.goal === "maintain" || form.targetRateKgPerWeek === "" ? null : Number(form.targetRateKgPerWeek),
        pregnantOrLactating: form.pregnantOrLactating,
        conditions: form.conditions.trim() || null,
      };
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        apply(await res.json());
        loadTargets();
        setSaved(true);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page">
      <header className="rise rise-1" style={{ marginBottom: 14 }}>
        <h1 className="page-title">Profile.</h1>
        <p className="page-sub">
          Used to personalize coaching and calorie targets. Stored locally and never sent to Google. BMI and ranges are
          general wellness references, not medical advice.
        </p>
      </header>

      {!form ? (
        <p style={{ color: "var(--ink-soft)" }}>Loading…</p>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          {derived && <DerivedCard derived={derived} />}
          {targets && <TargetsCard targets={targets} />}

          <section className="card">
            <div className="stack" style={{ gap: 16 }}>
              <Field label="Biological sex" hint="Used only for metabolic estimates.">
                <select className="field" value={form.sex} onChange={(e) => set("sex", e.target.value as Form["sex"])}>
                  <option value="">—</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                </select>
              </Field>

              <div className="grid-2">
                <Field label="Date of birth">
                  <input className="field" type="date" value={form.birthDate} onChange={(e) => set("birthDate", e.target.value)} />
                </Field>
                <Field label="Height (cm)">
                  <input className="field" type="number" inputMode="decimal" value={form.heightCm} onChange={(e) => set("heightCm", e.target.value)} />
                </Field>
              </div>

              <Field
                label="Current weight (kg)"
                hint={derived?.weightSource === "device" ? "Your synced device weight is used for BMI; this manual figure is a fallback." : "Used for BMI when no synced weight is available."}
              >
                <input className="field" type="number" inputMode="decimal" value={form.weightKg} onChange={(e) => set("weightKg", e.target.value)} />
              </Field>

              <Field label="Activity level">
                <select className="field" value={form.activityLevel} onChange={(e) => set("activityLevel", e.target.value as Form["activityLevel"])}>
                  <option value="">—</option>
                  {ACTIVITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid-2">
                <Field label="Goal">
                  <select className="field" value={form.goal} onChange={(e) => set("goal", e.target.value as Form["goal"])}>
                    <option value="">—</option>
                    {GOAL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {form.goal && form.goal !== "maintain" && (
                  <Field label="Target rate (kg/week)" hint="0.25–0.5 is a sustainable pace.">
                    <input
                      className="field"
                      type="number"
                      inputMode="decimal"
                      step="0.05"
                      value={form.targetRateKgPerWeek}
                      onChange={(e) => set("targetRateKgPerWeek", e.target.value)}
                    />
                  </Field>
                )}
              </div>

              <Toggle
                label="Pregnant or lactating"
                checked={form.pregnantOrLactating}
                onChange={(v) => set("pregnantOrLactating", v)}
              />

              <Field label="Conditions or limitations (optional)" hint="Anything the coach should keep in mind — injuries, chronic conditions. Voluntary.">
                <input className="field" value={form.conditions} onChange={(e) => set("conditions", e.target.value)} placeholder="e.g. knee injury, lactose intolerant" />
              </Field>

              <div className="row" style={{ justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
                {saved && <span style={{ fontSize: 12.5, color: "var(--activity)" }}>Saved</span>}
                <button className="btn" disabled={saving} onClick={save}>
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function DerivedCard({ derived }: { derived: ProfileDerived }) {
  const hasAny = derived.age != null || derived.bmi != null || derived.healthyWeightRangeKg;
  return (
    <section className="card" style={{ background: "var(--bg-inset)" }}>
      {hasAny ? (
        <div className="row" style={{ gap: 22, flexWrap: "wrap" }}>
          {derived.age != null && <Stat label="Age" value={`${derived.age}`} />}
          {derived.bmi != null && (
            <Stat
              label="BMI"
              value={`${derived.bmi}`}
              sub={derived.bmiCategory ? BMI_LABEL[derived.bmiCategory] : undefined}
            />
          )}
          {derived.healthyWeightRangeKg && (
            <Stat
              label="Healthy-weight range"
              value={`${derived.healthyWeightRangeKg.min}–${derived.healthyWeightRangeKg.max} kg`}
              sub={derived.weightSource ? `weight from ${derived.weightSource}` : undefined}
            />
          )}
        </div>
      ) : (
        <p style={{ color: "var(--ink-soft)", fontSize: 13 }}>Add your height, weight, and date of birth to see BMI and your healthy-weight range.</p>
      )}

      {derived.missingForTargets.length > 0 && (
        <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: hasAny ? 14 : 10, lineHeight: 1.5 }}>
          Add {derived.missingForTargets.join(", ")} so the coach can give you precise calorie and macro targets.
        </p>
      )}
    </section>
  );
}

function TargetsCard({ targets }: { targets: NutritionTargets | TargetsUnavailable }) {
  if (!targets.ok) {
    return (
      <section className="card">
        <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Daily targets</h2>
        <p style={{ fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.5 }}>
          Add {targets.missing.join(", ")} to see your deterministic calorie, macro, and hydration targets.
        </p>
      </section>
    );
  }
  const t = targets;
  const range = (r: { min: number; max: number }) => `${r.min}–${r.max}`;
  const goalText =
    t.dailyDeltaKcal === 0
      ? "at maintenance"
      : `${t.dailyDeltaKcal > 0 ? "+" : ""}${t.dailyDeltaKcal} kcal vs maintenance (~${t.maintenanceKcal})`;
  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700 }}>Daily targets</h2>
        <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>Mifflin-St Jeor · estimates</span>
      </div>
      <div className="row" style={{ gap: 22, flexWrap: "wrap" }}>
        <Stat label="Calories" value={`${t.calorieTarget}`} sub={goalText} />
        <Stat label="Protein" value={`${range(t.proteinG)} g`} />
        <Stat label="Fat" value={`${range(t.fatG)} g`} />
        <Stat label="Carbs" value={`${range(t.carbsG)} g`} />
        <Stat label="Water" value={`${(t.waterMl.min / 1000).toFixed(1)}–${(t.waterMl.max / 1000).toFixed(1)} L`} sub="food covers ~20%" />
      </div>
      {t.safetyNotes.length > 0 && (
        <p style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 14, lineHeight: 1.5, background: "var(--bg-inset)", borderRadius: 10, padding: "9px 11px" }}>
          {t.safetyNotes.join(" ")}
        </p>
      )}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="display-num" style={{ fontSize: 24 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>{sub}</div>}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-soft)", display: "block", marginBottom: 6 }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11.5, color: "var(--ink-faint)", display: "block", marginTop: 5, lineHeight: 1.4 }}>{hint}</span>}
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
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
