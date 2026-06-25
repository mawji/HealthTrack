"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Barcode capture for the Food logger. Uses the native web BarcodeDetector
 * (Chrome/Android) for live camera scanning, and always offers manual entry as
 * a fallback for browsers without it (notably iOS Safari). Camera access mirrors
 * the food-photo flow. On a successful read it calls onResult with the digits.
 */
export default function BarcodeScanner({
  onResult,
  onClose,
}: {
  onResult: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const doneRef = useRef(false);
  const [manual, setManual] = useState("");
  const [status, setStatus] = useState<"starting" | "scanning" | "unsupported" | "error">("starting");

  useEffect(() => {
    const Detector = (window as any).BarcodeDetector;
    if (!Detector) {
      setStatus("unsupported");
      return;
    }

    let detector: any;
    try {
      detector = new Detector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"] });
    } catch {
      setStatus("unsupported");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setStatus("scanning");

        const tick = async () => {
          if (doneRef.current || cancelled) return;
          try {
            const codes = await detector.detect(video);
            const raw = codes?.[0]?.rawValue;
            if (raw) {
              const digits = String(raw).replace(/\D/g, "");
              if (digits.length >= 6) {
                finish(digits);
                return;
              }
            }
          } catch {
            // transient decode error — keep polling
          }
          rafRef.current = window.setTimeout(() => tick(), 350) as unknown as number;
        };
        tick();
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cleanup() {
    if (rafRef.current) clearTimeout(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function finish(code: string) {
    if (doneRef.current) return;
    doneRef.current = true;
    cleanup();
    onResult(code);
  }

  const liveScan = status === "starting" || status === "scanning";

  return (
    <div
      onClick={() => { cleanup(); onClose(); }}
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in srgb, var(--ink) 45%, transparent)",
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
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
          <h2 style={{ fontSize: 19, fontWeight: 700 }}>Scan a barcode</h2>
          <button className="icon-btn" aria-label="close" onClick={() => { cleanup(); onClose(); }}>✕</button>
        </div>

        {liveScan && (
          <div style={{ position: "relative", borderRadius: 14, overflow: "hidden", background: "#000", aspectRatio: "4 / 3" }}>
            <video ref={videoRef} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <div
              style={{
                position: "absolute",
                inset: "28% 12%",
                border: "2px solid var(--food)",
                borderRadius: 12,
                boxShadow: "0 0 0 2000px color-mix(in srgb, #000 28%, transparent)",
              }}
            />
            <p style={{ position: "absolute", bottom: 8, left: 0, right: 0, textAlign: "center", color: "#fff", fontSize: 12.5 }}>
              {status === "starting" ? "Starting camera…" : "Point at the barcode"}
            </p>
          </div>
        )}

        {status === "unsupported" && (
          <p style={{ fontSize: 13, color: "var(--ink-soft)", marginBottom: 12 }}>
            Live scanning isn&apos;t supported in this browser. Type the barcode number printed under the bars instead.
          </p>
        )}
        {status === "error" && (
          <p style={{ fontSize: 13, color: "var(--heart)", marginBottom: 12 }}>
            Couldn&apos;t open the camera. Check permissions, or enter the barcode manually.
          </p>
        )}

        <div style={{ marginTop: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Or enter the number
          </span>
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <input
              className="field"
              inputMode="numeric"
              placeholder="e.g. 5000159484695"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && manual.replace(/\D/g, "").length >= 6) finish(manual.replace(/\D/g, "")); }}
              style={{ flex: 1 }}
            />
            <button
              className="btn"
              style={{ background: "var(--food)" }}
              disabled={manual.replace(/\D/g, "").length < 6}
              onClick={() => finish(manual.replace(/\D/g, ""))}
            >
              Look up
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
