import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/server-only deps that must not be bundled: pdf-parse, and the local
  // speech-to-text stack (onnxruntime-node ships a native binding loaded at runtime).
  serverExternalPackages: ["pdf-parse", "@huggingface/transformers", "onnxruntime-node", "ffmpeg-static"],
  // hide the floating Next.js dev-tools button ("N") in development
  devIndicators: false,
};

export default nextConfig;
