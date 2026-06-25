"use client";

import { useState } from "react";
import type { LibraryExercise } from "@/lib/exercise-library";

/** Full-screen image switcher for an exercise: a large enlarged image plus a
 *  thumbnail strip — clicking a thumbnail enlarges it and shrinks the previous.
 *  The main image (slot 0) is served locally (offline); secondary images come
 *  lazily from wger. Closing this view only closes the lightbox (stops the click
 *  from bubbling to a parent picker), so in-progress work isn't lost. */
export default function ImageLightbox({ exercise, onClose }: { exercise: LibraryExercise; onClose: () => void }) {
  // Slot 0 = main (local route, offline-capable); the rest = secondary remote URLs.
  const remote = exercise.images?.length ? exercise.images : exercise.image ? [exercise.image] : [];
  const slots: { src: string; local: boolean }[] = exercise.image
    ? [{ src: `/api/exercise-image?uuid=${exercise.uuid}`, local: true }, ...remote.slice(1).map((url) => ({ src: url, local: false }))]
    : [];
  const [sel, setSel] = useState(0);
  const close = (e: React.MouseEvent) => { e.stopPropagation(); onClose(); };

  return (
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "color-mix(in srgb, var(--ink) 80%, #000)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        gap: 14,
      }}
    >
      <button aria-label="close" onClick={close} style={{ position: "absolute", top: "max(14px, env(safe-area-inset-top))", right: 16, background: "rgba(0,0,0,0.4)", color: "#fff", border: "none", borderRadius: 999, width: 38, height: 38, fontSize: 18, cursor: "pointer" }}>
        ✕
      </button>

      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, maxWidth: 560, width: "100%" }}>
        {slots.length > 0 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={slots[Math.min(sel, slots.length - 1)].src} alt={exercise.name} style={{ maxWidth: "100%", maxHeight: "58vh", borderRadius: 14, objectFit: "contain", background: "#fff" }} />
        ) : (
          <div style={{ color: "#fff", opacity: 0.7 }}>No image for this exercise.</div>
        )}

        {slots.length > 1 && (
          <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            {slots.map((s, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={s.src}
                src={s.src}
                alt=""
                loading="lazy"
                onClick={() => setSel(i)}
                style={{ width: 64, height: 64, borderRadius: 8, objectFit: "cover", background: "#fff", cursor: "pointer", outline: i === sel ? "2px solid var(--activity)" : "none", outlineOffset: 2, opacity: i === sel ? 1 : 0.7 }}
              />
            ))}
          </div>
        )}

        <div style={{ color: "#fff", textAlign: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{exercise.name}</div>
          {exercise.muscles.length > 0 && <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>{exercise.muscles.join(" · ")}</div>}
          {exercise.equipment.length > 0 && <div style={{ fontSize: 12, opacity: 0.65, marginTop: 3 }}>Equipment: {exercise.equipment.join(", ")}</div>}
          {exercise.category && <div style={{ fontSize: 11.5, opacity: 0.55, marginTop: 3 }}>{exercise.category}</div>}
        </div>
      </div>
    </div>
  );
}
