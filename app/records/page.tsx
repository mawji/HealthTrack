"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LabFlag, LabMetric, MedicalRecord } from "@/lib/types";

// Metrics surfaced by default in the Trends tab; everything else is behind "All".
const KEY_METRICS = [
  "glucose-fasting",
  "hba1c",
  "total-cholesterol",
  "ldl-cholesterol",
  "hdl-cholesterol",
  "triglycerides",
  "chol-hdl-ratio",
  "creatinine",
  "egfr",
  "alt",
  "ast",
  "tsh",
  "ferritin",
  "vitamin-d",
  "crp",
  "hemoglobin",
];

function flagColor(flag: LabFlag): string | null {
  if (flag === "high" || flag === "abnormal" || flag === "critical") return "var(--heart)";
  if (flag === "low") return "var(--food)";
  return null;
}

function flagLabel(flag: LabFlag): string {
  return flag === "high" ? "H" : flag === "low" ? "L" : flag === "critical" ? "C" : flag === "abnormal" ? "!" : "";
}

/** Effective date of a record: specimen collection date, else upload day. */
function recordDate(r: MedicalRecord): string {
  return r.reportDate || r.uploadedAt.slice(0, 10);
}

function fmtDate(d: string): string {
  return new Date(d + (d.length === 10 ? "T12:00:00" : "")).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 0.2s ease",
        color: "var(--ink-faint)",
        flex: "none",
      }}
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

interface SeriesPoint {
  date: string;
  value: number;
  valueText: string;
  flag: LabFlag;
  unit: string;
}

interface Series {
  key: string;
  name: string;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
  refText: string;
  points: SeriesPoint[]; // ascending by date
}

/** Groups numeric metrics by canonical key across all records. */
function buildSeries(records: MedicalRecord[]): Series[] {
  const byKey = new Map<string, Series>();
  const sorted = records
    .filter((r) => r.metrics?.length)
    .slice()
    .sort((a, b) => recordDate(a).localeCompare(recordDate(b)));
  for (const r of sorted) {
    for (const m of r.metrics!) {
      if (m.value === null) continue;
      let s = byKey.get(m.key);
      if (!s) {
        s = { key: m.key, name: m.name, unit: m.unit, refLow: m.refLow, refHigh: m.refHigh, refText: m.refText, points: [] };
        byKey.set(m.key, s);
      }
      // Latest report wins for display metadata (names/ranges can drift between labs).
      s.name = m.name;
      s.unit = m.unit || s.unit;
      if (m.refLow !== null || m.refHigh !== null) {
        s.refLow = m.refLow;
        s.refHigh = m.refHigh;
        s.refText = m.refText;
      }
      s.points.push({ date: recordDate(r), value: m.value, valueText: m.valueText, flag: m.flag, unit: m.unit || "" });
    }
  }

  // Deduplicate points per date, favoring matching units to avoid visual spikes
  for (const s of byKey.values()) {
    const pointsByDate = new Map<string, SeriesPoint[]>();
    for (const p of s.points) {
      let list = pointsByDate.get(p.date);
      if (!list) {
        list = [];
        pointsByDate.set(p.date, list);
      }
      list.push(p);
    }

    const deduplicatedPoints: SeriesPoint[] = [];
    for (const [date, list] of pointsByDate.entries()) {
      const matchingUnit = list.filter((p) => p.unit === s.unit);
      if (matchingUnit.length > 0) {
        deduplicatedPoints.push(matchingUnit[matchingUnit.length - 1]);
      } else {
        deduplicatedPoints.push(list[list.length - 1]);
      }
    }
    s.points = deduplicatedPoints.sort((a, b) => a.date.localeCompare(b.date));
  }

  return [...byKey.values()];
}

function Sparkline({ s }: { s: Series }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const W = 200;
  const H = 56;
  const PX = 8;
  const PY = 10;
  const vals = s.points.map((p) => p.value);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  // Widen the scale to keep the reference band in frame when it's nearby.
  if (s.refLow !== null) lo = Math.min(lo, s.refLow);
  if (s.refHigh !== null) hi = Math.max(hi, s.refHigh);
  if (hi === lo) {
    hi += Math.abs(hi) * 0.1 || 1;
    lo -= Math.abs(lo) * 0.1 || 1;
  }
  const x = (i: number) => (s.points.length === 1 ? W / 2 : PX + (i * (W - 2 * PX)) / (s.points.length - 1));
  const y = (v: number) => PY + (H - 2 * PY) * (1 - (v - lo) / (hi - lo));
  const bandTop = y(s.refHigh ?? hi);
  const bandBot = y(s.refLow ?? lo);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const svgX = (clientX / rect.width) * W;
    let bestIdx = 0;
    let minDist = Infinity;
    s.points.forEach((p, i) => {
      const px = x(i);
      const dist = Math.abs(px - svgX);
      if (dist < minDist) {
        minDist = dist;
        bestIdx = i;
      }
    });
    setHoveredIdx(bestIdx);
  }

  return (
    <div className="chart-wrap" style={{ position: "relative" }}>
      {hoveredIdx !== null && (
        <div
          className="chart-tip"
          style={{
            left: `${Math.min(Math.max((x(hoveredIdx) / W) * 100, 8), 92)}%`,
            top: "-4px"
          }}
        >
          {fmtDate(s.points[hoveredIdx].date)} · {s.points[hoveredIdx].valueText || s.points[hoveredIdx].value}
        </div>
      )}
      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ display: "block" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHoveredIdx(null)}
      >
        {(s.refLow !== null || s.refHigh !== null) && (
          <rect
            x={0}
            y={Math.min(bandTop, bandBot)}
            width={W}
            height={Math.abs(bandBot - bandTop)}
            fill="var(--sleep)"
            opacity={0.12}
            rx={3}
          />
        )}
        {s.points.length > 1 && (
          <polyline
            points={s.points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")}
            fill="none"
            stroke="var(--sleep)"
            strokeWidth={1.8}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {s.points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r={3} fill={flagColor(p.flag) ?? "var(--sleep)"} />
        ))}
        {hoveredIdx !== null && (
          <circle
            cx={x(hoveredIdx)}
            cy={y(s.points[hoveredIdx].value)}
            r={5}
            fill={flagColor(s.points[hoveredIdx].flag) ?? "var(--sleep)"}
            stroke="var(--bg-raised)"
            strokeWidth={1.5}
          />
        )}
      </svg>
    </div>
  );
}

function TrendCard({ s }: { s: Series }) {
  const latest = s.points[s.points.length - 1];
  const prev = s.points.length > 1 ? s.points[s.points.length - 2] : null;
  const delta = prev ? latest.value - prev.value : null;
  const color = flagColor(latest.flag);
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <strong style={{ fontSize: 13.5 }}>{s.name}</strong>
        {s.refText && <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>ref {s.refText}</span>}
      </div>
      <div className="row" style={{ gap: 10, alignItems: "baseline", marginTop: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: color ?? "var(--ink)" }}>
          {latest.valueText || latest.value}
        </span>
        <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>{s.unit}</span>
        {color && (
          <span style={{ fontSize: 11, fontWeight: 700, color }}>{flagLabel(latest.flag)}</span>
        )}
        {delta !== null && (
          <span style={{ fontSize: 12, color: "var(--ink-soft)", marginLeft: "auto" }}>
            {delta > 0 ? "▲" : delta < 0 ? "▼" : "—"}{" "}
            {Math.abs(delta) < 10 ? Math.abs(delta).toFixed(2).replace(/\.?0+$/, "") : Math.round(Math.abs(delta))}{" "}
            vs {fmtDate(prev!.date)}
          </span>
        )}
      </div>
      <div style={{ marginTop: 8 }}>
        <Sparkline s={s} />
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 2 }}>
        <span style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>{fmtDate(s.points[0].date)}</span>
        {s.points.length > 1 && (
          <span style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>{fmtDate(latest.date)}</span>
        )}
      </div>
    </div>
  );
}

function MetricsTable({ metrics }: { metrics: LabMetric[] }) {
  // Preserve report order while grouping rows under their panel headings.
  const panels: { panel: string; rows: LabMetric[] }[] = [];
  for (const m of metrics) {
    const last = panels[panels.length - 1];
    if (last && last.panel === m.panel) last.rows.push(m);
    else panels.push({ panel: m.panel, rows: [m] });
  }
  return (
    <div style={{ marginTop: 10 }}>
      {panels.map((p, pi) => (
        <div key={pi} style={{ marginTop: pi === 0 ? 0 : 12 }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--ink-faint)", marginBottom: 4 }}>
            {p.panel}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", columnGap: 12, rowGap: 0 }}>
            {p.rows.map((m, i) => {
              const color = flagColor(m.flag);
              return (
                <div key={i} style={{ display: "contents" }}>
                  <span style={{ fontSize: 12.5, padding: "4px 0", borderTop: i ? "1px solid var(--border)" : "none", color: "var(--ink-soft)" }}>
                    {m.name}
                  </span>
                  <span style={{ fontSize: 12.5, padding: "4px 0", borderTop: i ? "1px solid var(--border)" : "none", textAlign: "right", fontWeight: 600, color: color ?? "var(--ink)", whiteSpace: "nowrap" }}>
                    {m.valueText || m.value} {m.unit && <span style={{ fontWeight: 400, color: "var(--ink-faint)" }}>{m.unit}</span>}
                    {color && <span style={{ marginLeft: 5, fontSize: 10.5, fontWeight: 700, color }}>{flagLabel(m.flag)}</span>}
                  </span>
                  <span style={{ fontSize: 11.5, padding: "4px 0", borderTop: i ? "1px solid var(--border)" : "none", textAlign: "right", color: "var(--ink-faint)", whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" }}>
                    {m.refText}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Records() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [openText, setOpenText] = useState<string | null>(null);
  const [openSummary, setOpenSummary] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pdfPassword, setPdfPassword] = useState("");
  const [wrongPassword, setWrongPassword] = useState(false);
  const [tab, setTab] = useState<"reports" | "trends">("reports");
  const [reparsing, setReparsing] = useState<string | null>(null);
  const [reparsePw, setReparsePw] = useState<{ id: string; wrong: boolean } | null>(null);
  const [showAllTrends, setShowAllTrends] = useState(false);
  const [expandedRecords, setExpandedRecords] = useState<Record<string, boolean>>({});

  const load = () =>
    fetch("/api/records").then((r) => r.json()).then(setRecords).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  async function upload(f: File, password?: string) {
    setError("");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", f);
      if (password) form.append("password", password);
      const res = await fetch("/api/records", { method: "POST", body: form });
      const json = await res.json();
      if (res.status === 422 && json.error === "PDF_PASSWORD_REQUIRED") {
        setPendingFile(f);
        setWrongPassword(json.wrong ?? false);
        return;
      }
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setPendingFile(null);
      setPdfPassword("");
      setWrongPassword(false);
      await load();
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function reparse(id: string, password?: string) {
    setError("");
    setReparsing(id);
    try {
      const res = await fetch("/api/records", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, password }),
      });
      const json = await res.json();
      if (res.status === 422 && json.error === "PDF_PASSWORD_REQUIRED") {
        setReparsePw({ id, wrong: json.wrong ?? false });
        return;
      }
      if (!res.ok) throw new Error(json.error ?? "Re-analysis failed");
      setReparsePw(null);
      setPdfPassword("");
      await load();
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setReparsing(null);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/records?id=${id}`, { method: "DELETE" });
    await load();
  }

  const { groupedRecords, sortedDates, recordIndexMap } = useMemo(() => {
    const groups: Record<string, MedicalRecord[]> = {};
    const sorted = [...records].sort((a, b) => recordDate(b).localeCompare(recordDate(a)));
    
    const indexMap: Record<string, number> = {};
    sorted.forEach((r, idx) => {
      indexMap[r.id] = idx;
      const d = recordDate(r);
      if (!groups[d]) groups[d] = [];
      groups[d].push(r);
    });

    const dates = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    return { groupedRecords: groups, sortedDates: dates, recordIndexMap: indexMap };
  }, [records]);

  const toggleRecord = (id: string) => {
    setExpandedRecords((prev) => ({ ...prev, [id]: !(prev[id] ?? (recordIndexMap[id] === 0)) }));
  };

  const series = useMemo(() => buildSeries(records), [records]);
  const trendSeries = useMemo(() => {
    const filtered = showAllTrends ? series : series.filter((s) => KEY_METRICS.includes(s.key));
    // Out-of-range and multi-point metrics first, then alphabetical.
    return filtered.slice().sort((a, b) => {
      const aFlag = a.points[a.points.length - 1].flag !== "normal" ? 0 : 1;
      const bFlag = b.points[b.points.length - 1].flag !== "normal" ? 0 : 1;
      if (aFlag !== bFlag) return aFlag - bFlag;
      if (a.points.length !== b.points.length) return b.points.length - a.points.length;
      return a.name.localeCompare(b.name);
    });
  }, [series, showAllTrends]);
  const reportCount = records.filter((r) => r.metrics?.length).length;

  return (
    <main className="page" style={{ maxWidth: 720 }}>
      <header className="rise rise-1" style={{ marginBottom: 16 }}>
        <h1 className="page-title">Records.</h1>
        <p className="page-sub">
          Lab results, prescriptions, reports. The AI coach reads these to personalize its guidance.
        </p>
      </header>

      <section
        className="card rise rise-2"
        onClick={() => !uploading && fileRef.current?.click()}
        style={{
          border: "1.5px dashed var(--sleep)",
          background: "var(--sleep-soft)",
          textAlign: "center",
          padding: "32px 20px",
          cursor: "pointer",
          boxShadow: "none",
        }}
      >
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="var(--sleep)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 16V5M7.5 9.5L12 5l4.5 4.5" />
          <path d="M5 16v3h14v-3" />
        </svg>
        <p style={{ fontWeight: 600, color: "var(--sleep)", marginTop: 6 }}>
          {uploading ? "Analyzing document…" : "Upload a medical record"}
        </p>
        <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginTop: 3 }}>PDF, photo, or text — stored only on this device</p>
        {uploading && <p className="pulsing" style={{ marginTop: 8, color: "var(--sleep)" }}>●●●</p>}
      </section>
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.txt,.md,.csv,image/*"
        hidden
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
      />
      {(pendingFile || reparsePw) && (
        <div className="card rise" style={{ marginTop: 12, padding: 16, boxShadow: "none", border: "1px solid var(--border)" }}>
          <p style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>
            {(pendingFile ? wrongPassword : reparsePw?.wrong) ? "Incorrect password — try again" : "This PDF is password-protected"}
          </p>
          <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 12 }}>
            Enter the document password to unlock and analyze{" "}
            <strong>{pendingFile?.name ?? records.find((r) => r.id === reparsePw?.id)?.filename}</strong>.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <input
              type="password"
              placeholder="PDF password"
              value={pdfPassword}
              onChange={(e) => setPdfPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || uploading || reparsing || !pdfPassword) return;
                if (pendingFile) upload(pendingFile, pdfPassword);
                else if (reparsePw) reparse(reparsePw.id, pdfPassword);
              }}
              autoFocus
              style={{
                flex: 1, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)",
                background: "var(--bg)", color: "var(--ink)", fontSize: 13.5, outline: "none",
              }}
            />
            <button
              className="btn"
              onClick={() => (pendingFile ? upload(pendingFile, pdfPassword) : reparsePw && reparse(reparsePw.id, pdfPassword))}
              disabled={uploading || Boolean(reparsing) || !pdfPassword}
            >
              {uploading || reparsing ? "Unlocking…" : "Unlock"}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => { setPendingFile(null); setReparsePw(null); setPdfPassword(""); setWrongPassword(false); }}
              disabled={uploading || Boolean(reparsing)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p style={{ marginTop: 10, color: "var(--heart)", fontSize: 13.5 }}>{error}</p>}

      <div className="row rise rise-3" style={{ gap: 6, marginTop: 20 }}>
        <button
          className={tab === "reports" ? "btn" : "btn btn-ghost"}
          style={{ fontSize: 12.5, padding: "6px 14px" }}
          onClick={() => setTab("reports")}
        >
          Reports
        </button>
        <button
          className={tab === "trends" ? "btn" : "btn btn-ghost"}
          style={{ fontSize: 12.5, padding: "6px 14px" }}
          onClick={() => setTab("trends")}
        >
          Trends
        </button>
      </div>

      {tab === "trends" ? (
        <section style={{ marginTop: 14 }}>
          {series.length === 0 ? (
            <p style={{ color: "var(--ink-soft)", fontSize: 13.5, textAlign: "center", marginTop: 20 }}>
              No structured results yet. Upload a lab report, or open Reports and tap “Extract metrics” on an existing one.
            </p>
          ) : (
            <>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <p style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                  {reportCount === 1
                    ? "1 report so far — trends appear once you upload a follow-up."
                    : `Comparing ${reportCount} reports. Dots are colored when out of range.`}
                </p>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 11.5, padding: "4px 10px", flex: "none" }}
                  onClick={() => setShowAllTrends(!showAllTrends)}
                >
                  {showAllTrends ? "Key metrics" : `All metrics (${series.length})`}
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                {trendSeries.map((s) => (
                  <TrendCard key={s.key} s={s} />
                ))}
              </div>
            </>
          )}
        </section>
      ) : (
        <section style={{ marginTop: 14 }}>
          {records.length === 0 ? (
            <p style={{ color: "var(--ink-soft)", fontSize: 13.5, textAlign: "center" }}>
              No records yet.
            </p>
          ) : (
            <div className="stack" style={{ gap: 20 }}>
              {sortedDates.map((date) => {
                const groupRecords = groupedRecords[date];
                return (
                  <div key={date} className="stack" style={{ gap: 10 }}>
                    <div style={{ paddingLeft: 4, marginTop: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-soft)" }}>
                        {fmtDate(date)}
                      </span>
                    </div>
                    {groupRecords.map((r) => {
                      const expanded = expandedRecords[r.id] ?? (recordIndexMap[r.id] === 0);
                      return (
                        <div key={r.id} className="card" style={{ padding: 16 }}>
                          <div
                            style={{ cursor: "pointer", userSelect: "none" }}
                            onClick={() => toggleRecord(r.id)}
                          >
                            <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                              <div className="row" style={{ gap: 8, flex: 1, minWidth: 0 }}>
                                <ChevronIcon expanded={expanded} />
                                <strong style={{ fontSize: 14.5, overflowWrap: "anywhere" }}>
                                  {r.docType || r.filename}
                                </strong>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  remove(r.id);
                                }}
                                style={{ background: "none", border: "none", color: "var(--ink-faint)", cursor: "pointer", fontSize: 16, flex: "none" }}
                                aria-label="delete"
                              >
                                ✕
                              </button>
                            </div>
                            
                            <p style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 2, overflowWrap: "anywhere", wordBreak: "break-word", paddingLeft: 24 }}>
                              {r.reportDate ? `Collected ${fmtDate(r.reportDate)}` : `Uploaded ${fmtDate(r.uploadedAt.slice(0, 10))}`}
                              {r.labName ? ` · ${r.labName}` : ""}
                              {r.docType ? ` · ${r.filename}` : ""}
                            </p>
                          </div>

                          {expanded && (
                            <div style={{ marginTop: 12 }}>
                              {r.metrics?.length ? (
                                <MetricsTable metrics={r.metrics} />
                              ) : (
                                <p style={{ fontSize: 13.5, color: "var(--ink-soft)", marginTop: 8 }}>{r.summary}</p>
                              )}

                              <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                                {r.metrics?.length ? (
                                  <button
                                    className="btn btn-ghost"
                                    style={{ fontSize: 12, padding: "6px 12px" }}
                                    onClick={() => setOpenSummary(openSummary === r.id ? null : r.id)}
                                  >
                                    {openSummary === r.id ? "Hide summary" : "AI summary"}
                                  </button>
                                ) : null}
                                <button
                                  className="btn btn-ghost"
                                  style={{ fontSize: 12, padding: "6px 12px" }}
                                  onClick={() => reparse(r.id)}
                                  disabled={reparsing === r.id}
                                >
                                  {reparsing === r.id ? "Analyzing…" : r.metrics?.length ? "Re-analyze" : "Extract metrics"}
                                </button>
                                {r.textExcerpt && (
                                  <button
                                    className="btn btn-ghost"
                                    style={{ fontSize: 12, padding: "6px 12px" }}
                                    onClick={() => setOpenText(openText === r.id ? null : r.id)}
                                  >
                                    {openText === r.id ? "Hide extracted text" : "Extracted text"}
                                  </button>
                                )}
                              </div>
                              {openSummary === r.id && (
                                <p style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 8, whiteSpace: "pre-wrap" }}>{r.summary}</p>
                              )}
                              {openText === r.id && (
                                <pre style={{ fontSize: 11.5, whiteSpace: "pre-wrap", marginTop: 8, color: "var(--ink-soft)", fontFamily: "var(--font-ui)", background: "var(--bg)", padding: 10, borderRadius: 10 }}>
                                  {r.textExcerpt}
                                </pre>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
