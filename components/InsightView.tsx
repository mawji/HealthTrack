import { CoachInsight, DaySummary } from "@/lib/types";
import { VizCard } from "@/components/ChatVisuals";

/** Renders **bold** spans — gpt-oss likes markdown emphasis. */
function renderInline(text: string) {
  const pieces = text.split(/\*\*([^*]+)\*\*/g);
  return pieces.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : p));
}

/**
 * Renders a CoachInsight (headline + body + viz card + focus areas).
 * Lifted from the old coach page; insights never carry actions, so the chat
 * fence/action machinery isn't needed here. `focusAreas` is empty for
 * retrospective long-range summaries, so that block self-hides.
 */
export function InsightView({
  insight,
  week = [],
  accent = "var(--breath)",
}: {
  insight: CoachInsight;
  week?: DaySummary[];
  accent?: string;
}) {
  return (
    <>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 560, lineHeight: 1.25, paddingRight: 8 }}>
        {insight.headline}
      </h2>
      {insight.body && (
        <p style={{ fontSize: 14, color: "var(--ink-soft)", marginTop: 8, lineHeight: 1.5 }}>
          {renderInline(insight.body)}
        </p>
      )}
      {insight.viz && <VizCard spec={insight.viz} week={week} />}
      {insight.vizCards && insight.vizCards.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 360px))",
            gap: 12,
            marginTop: 12,
          }}
        >
          {insight.vizCards.map((spec, i) => (
            <VizCard key={i} spec={spec} week={week} />
          ))}
        </div>
      )}
      {insight.focusAreas?.length > 0 && (
        <div className="stack" style={{ gap: 8, marginTop: 12 }}>
          {insight.focusAreas.map((f, i) => (
            <div key={i} className="row" style={{ gap: 10, alignItems: "flex-start" }}>
              <span className="dot" style={{ width: 7, height: 7, borderRadius: "50%", background: accent, marginTop: 7, flex: "none" }} />
              <div>
                <strong style={{ fontSize: 13.5 }}>{f.title}</strong>
                <span style={{ fontSize: 11.5, color: accent, marginLeft: 7 }}>{f.metric}</span>
                <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>{f.detail}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
