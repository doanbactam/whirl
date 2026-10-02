/**
 * Rasterize the Whirl mark into the home-screen icon set.
 *
 * Install prompts and app switchers want bitmaps at fixed sizes, so the
 * mark ships as PNGs: two plain icons for the manifest, one maskable (the
 * mark pulled in far enough that Android can crop it to a circle, a squircle
 * or anything between without clipping a petal), and one for iOS, which
 * applies its own rounded-rect mask and renders transparency as black.
 *
 * All four are opaque and dark — the mark reads on any wallpaper, and it
 * matches the black pill the app's primary action already wears.
 *
 * One-shot: run it again only if public/whirl.svg changes.
 *   node apps/v2/scripts/render-app-icons.mjs
 *
 * node, not bun: Playwright drives the browser over a pipe transport that
 * bun's child_process doesn't wire up on Windows, so the launch sits there
 * until it times out.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");
const appRoot = join(here, "..");

const BACKGROUND = "#141414";
const MARK = "#ffffff";

/* `scale` is the mark's share of the canvas. Android's maskable safe zone
   is the middle 80%, and the crop it applies is unknown at build time, so
   that one sits well inside it; the rest are sized to look right whole. */
const ICONS = [
  { out: "public/icons/icon-192.png", size: 192, scale: 0.64 },
  { out: "public/icons/icon-512.png", size: 512, scale: 0.64 },
  { out: "public/icons/icon-maskable-512.png", size: 512, scale: 0.46 },
  /* Next's app-icon file convention, not public/: sitting here is what emits
     the <link rel="apple-touch-icon"> that iOS goes looking for. */
  { out: "app/apple-icon.png", size: 180, scale: 0.6 },
];

const svg = readFileSync(join(publicDir, "whirl.svg"), "utf8")
  .replace(/\s(width|height)="\d+"/g, "")
  .replaceAll('fill="black"', `fill="${MARK}"`);

/* Use a browser that's already on the machine rather than making everyone
   download Playwright's bundled Chromium for four sprites. */
const CANDIDATES = [
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
];

async function launch() {
  for (const executablePath of CANDIDATES) {
    if (!existsSync(executablePath)) continue;
    return await chromium.launch({ executablePath, timeout: 60_000 });
  }
  // Falls back to Playwright's own browser, if it's been downloaded.
  return await chromium.launch({ timeout: 60_000 });
}

const browser = await launch();

for (const { out, size, scale } of ICONS) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  /* The mark is 180x182 — taller than it is wide. Sizing by height keeps it
     from overflowing the safe zone, and the flex centering does the rest. */
  const markHeight = Math.round(size * scale);
  await page.setContent(
    `<html><body style="margin:0">
       <div style="width:${size}px;height:${size}px;background:${BACKGROUND};
                   display:flex;align-items:center;justify-content:center">
         <div style="height:${markHeight}px;display:flex">${svg}</div>
       </div>
     </body></html>`,
  );
  const png = await page.screenshot();
  await page.close();
  const path = join(appRoot, out);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
  console.log(`wrote ${out} (${size}x${size}, ${png.length} bytes)`);
}

await browser.close();
