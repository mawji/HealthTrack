// Speech-to-text endpoint shared by the in-app coach mic and the Telegram voice
// handler. Accepts a raw audio body (any container ffmpeg can read) and returns
// the transcript plus which engine produced it.

import { NextRequest, NextResponse } from "next/server";
import { transcribe } from "@/lib/transcribe";

export const maxDuration = 60; // local model load + decode can take a few seconds

export async function POST(req: NextRequest) {
  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length) return NextResponse.json({ error: "empty audio" }, { status: 400 });

  // Derive a filename hint from the content-type so the cloud path sends a
  // sensible extension (OpenAI uses it to detect the format).
  const ct = req.headers.get("content-type") || "";
  const ext = ct.includes("ogg") ? "ogg" : ct.includes("webm") ? "webm" : ct.includes("wav") ? "wav" : ct.includes("mp4") || ct.includes("m4a") ? "m4a" : "audio";

  try {
    const { text, engine } = await transcribe(buf, `audio.${ext}`);
    if (!text) return NextResponse.json({ error: "no speech detected", text: "", engine });
    return NextResponse.json({ text, engine });
  } catch (e: any) {
    console.error("Transcription failed:", e);
    return NextResponse.json({ error: String(e.message ?? e) }, { status: 500 });
  }
}
