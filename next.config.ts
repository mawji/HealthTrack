import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server output for the Docker production image (`.next/standalone/server.js`).
  // Harmless to `next dev`; only affects `next build`. See plans/simplified-install-and-deploy.md.
  output: "standalone",
  // Native/server-only deps that must not be bundled: pdf-parse, and the local
  // speech-to-text stack (onnxruntime-node ships a native binding loaded at runtime).
  serverExternalPackages: ["pdf-parse", "@huggingface/transformers", "onnxruntime-node", "ffmpeg-static"],
  // hide the floating Next.js dev-tools button ("N") in development
  devIndicators: false,
};

export default nextConfig;
