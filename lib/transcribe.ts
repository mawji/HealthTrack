// Speech-to-text provider layer. Mirrors the app's AI-provider pattern:
// local-first (private), with an optional cloud upgrade.
//
//   local  → Transformers.js whisper-small.en (ONNX, on-device, no audio leaves
//            the machine, no key, no per-minute cost). The default.
//   cloud  → OpenAI gpt-4o-mini-transcribe (higher accuracy, ~$0.003/min) — used
//            as a fallback when local fails, or when explicitly selected.
//
// One entry point (`transcribe`) serves both the in-app coach mic and Telegram
// voice notes. Audio is decoded to 16 kHz mono PCM with ffmpeg-static first, so
// any container (OGG/Opus, WebM/Opus, m4a, wav) works.

import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { readJson, writeJson, dataPath } from "@/lib/store";
import { getStore } from "@/lib/ai-provider";

const LOCAL_MODEL = "onnx-community/whisper-small.en";
const CONFIG_FILE = "transcribe.json";

export type TranscribeMode = "auto" | "local" | "cloud";
export type TranscribeConfig = { mode: TranscribeMode };

export function getTranscribeConfig(): TranscribeConfig {
  return { mode: readJson<TranscribeConfig>(CONFIG_FILE, { mode: "auto" }).mode ?? "auto" };
}
export function setTranscribeMode(mode: TranscribeMode) {
  writeJson(CONFIG_FILE, { mode });
}

/** OpenAI API key for the cloud path: the configured openai-key provider, else env. */
function openAiKey(): string | undefined {
  return getStore()?.providers?.["openai-key"]?.apiKey || process.env.OPENAI_API_KEY || undefined;
}

export function cloudAvailable(): boolean {
  return Boolean(openAiKey());
}

// ── ffmpeg decode → 16 kHz mono float32 PCM ──────────────────────────────────
function decodePcm(audio: Buffer): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg-static binary not found"));
    const ff = spawn(ffmpegPath, ["-i", "pipe:0", "-ar", "16000", "-ac", "1", "-f", "f32le", "pipe:1"]);
    const chunks: Buffer[] = [];
    let errBuf = "";
    ff.stdout.on("data", (d) => chunks.push(d));
    ff.stderr.on("data", (d) => { errBuf += d.toString(); });
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg failed (${code}): ${errBuf.slice(-200)}`));
      const buf = Buffer.concat(chunks);
      resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4)));
    });
    ff.stdin.on("error", () => {}); // ignore EPIPE if ffmpeg rejects early
    ff.stdin.end(audio);
  });
}

// ── Local engine (Transformers.js) — loaded once, reused across requests ─────
let asrPromise: Promise<any> | null = null;
async function getAsr(): Promise<any> {
  if (!asrPromise) {
    asrPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = dataPath("models"); // model cached locally, gitignored
      env.allowRemoteModels = true; // allow the one-time model download
      return pipeline("automatic-speech-recognition", LOCAL_MODEL, { dtype: "q8" });
    })();
  }
  return asrPromise;
}

export async function transcribeLocal(audio: Buffer): Promise<string> {
  const pcm = await decodePcm(audio);
  if (pcm.length < 1600) throw new Error("clip too short"); // < 0.1s ⇒ nothing said
  const asr = await getAsr();
  // whisper-small.en is English-only — do NOT pass language/task (it errors).
  const out = await asr(pcm, { chunk_length_s: 30 });
  return String(out?.text ?? "").trim();
}

// ── Cloud engine (OpenAI gpt-4o-mini-transcribe) ─────────────────────────────
export async function transcribeCloud(audio: Buffer, filename = "audio.ogg"): Promise<string> {
  const key = openAiKey();
  if (!key) throw new Error("No OpenAI API key configured for cloud transcription");
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(audio)]), filename);
  form.append("model", "gpt-4o-mini-transcribe");
  form.append("response_format", "text");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI transcription failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return (await res.text()).trim();
}

export interface TranscribeResult {
  text: string;
  engine: "local" | "cloud";
}

/** Transcribe per the configured mode. `auto` tries local first, then cloud. */
export async function transcribe(audio: Buffer, filename = "audio.ogg"): Promise<TranscribeResult> {
  const { mode } = getTranscribeConfig();

  if (mode === "cloud") return { text: await transcribeCloud(audio, filename), engine: "cloud" };
  if (mode === "local") return { text: await transcribeLocal(audio), engine: "local" };

  // auto: local first; on failure, fall back to cloud when a key is available.
  try {
    return { text: await transcribeLocal(audio), engine: "local" };
  } catch (e) {
    if (cloudAvailable()) {
      console.warn("Local transcription failed, falling back to cloud:", e);
      return { text: await transcribeCloud(audio, filename), engine: "cloud" };
    }
    throw e;
  }
}
