import { FoodProvenance } from "@/lib/types";

const CONFIDENCE_COLOR: Record<string, string> = {
  high: "var(--activity)",
  medium: "var(--food)",
  low: "var(--heart)",
};

/**
 * Compact "where this came from + how sure we are" pill. Built for Track A
 * (barcode → Open Food Facts) and reused by the USDA/label/model food paths.
 * Shows the source label, a confidence dot, and links out to the source when
 * one is available. Honest by default: a confidence dot never implies a
 * measurement the app doesn't have.
 */
export default function ProvenanceBadge({
  provenance,
  confidence,
  showAttribution = false,
}: {
  provenance?: FoodProvenance;
  confidence?: "low" | "medium" | "high";
  showAttribution?: boolean;
}) {
  if (!provenance) return null;
  const dot = confidence ? CONFIDENCE_COLOR[confidence] : "var(--ink-soft)";
  const label = provenance.sourceLabel ?? provenance.source;

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
      <span
        className="badge"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "var(--bg-inset)",
          color: "var(--ink-soft)",
          fontWeight: 600,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flex: "none" }} />
        {provenance.sourceUrl ? (
          <a href={provenance.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
            {label} ↗
          </a>
        ) : (
          label
        )}
        {confidence && <span style={{ color: "var(--ink-faint)" }}>· {confidence}</span>}
        {provenance.nova != null && <span style={{ color: "var(--ink-faint)" }}>· NOVA {provenance.nova}</span>}
      </span>
      {showAttribution && provenance.attribution && (
        <span style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>{provenance.attribution}</span>
      )}
    </span>
  );
}
