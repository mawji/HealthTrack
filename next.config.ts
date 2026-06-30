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
  // NEXT_DIST_DIR lets a second instance build into its own dir (e.g. .next-demo)
  // so a disconnected demo server can run alongside the primary dev server
  // without clobbering its .next cache. Defaults to the standard ".next".
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
