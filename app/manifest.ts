import type { MetadataRoute } from "next";

// Next serves this at /manifest.webmanifest and auto-injects <link rel="manifest">.
// PNG icons (generated from the source SVGs via `node scripts/gen-icons.mjs`)
// give the broadest install support — iOS home screen, the desktop-Chrome
// omnibox install affordance, and browsers that reject SVG manifest icons. The
// scalable SVG is kept as an extra entry. The Apple touch icon is app/apple-icon.png
// (Next auto-emits the <link rel="apple-touch-icon">).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HealthTrack",
    short_name: "HealthTrack",
    description: "Your body, beautifully measured.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0d0f",
    theme_color: "#0b0d0f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
