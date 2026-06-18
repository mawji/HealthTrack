// Rasterize the app's SVG icons to PNG for broader install support (iOS home
// screen, desktop-Chrome omnibox install, any browser that won't accept SVG
// manifest icons). Source SVGs stay the source of truth; re-run after editing
// them: `node scripts/gen-icons.mjs`.
import sharp from "sharp";
import fs from "fs";
import path from "path";

const root = process.cwd();
const iconsDir = path.join(root, "public", "icons");
const appDir = path.join(root, "app");

const iconSvg = fs.readFileSync(path.join(iconsDir, "icon.svg"));
const maskableSvg = fs.readFileSync(path.join(iconsDir, "maskable.svg"));

const jobs = [
  // Standard "any" PNG icons for the manifest (rounded, transparent corners).
  { src: iconSvg, size: 192, out: path.join(iconsDir, "icon-192.png") },
  { src: iconSvg, size: 512, out: path.join(iconsDir, "icon-512.png") },
  // Maskable PNG (full-bleed opaque, safe padding) for Android adaptive icons.
  { src: maskableSvg, size: 512, out: path.join(iconsDir, "maskable-512.png") },
  // Apple touch icon: opaque, square, no rounding (iOS applies its own mask).
  { src: maskableSvg, size: 180, out: path.join(appDir, "apple-icon.png") },
];

const run = async () => {
  for (const j of jobs) {
    await sharp(j.src, { density: 384 })
      .resize(j.size, j.size, { fit: "contain" })
      .png()
      .toFile(j.out);
    console.log(`wrote ${path.relative(root, j.out)} (${j.size}x${j.size})`);
  }
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
