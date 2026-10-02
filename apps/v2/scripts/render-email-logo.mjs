/**
 * Rasterize the Whirl mark to a PNG for use in transactional email.
 *
 * Gmail and Outlook both refuse to render SVG in email bodies, so the mark
 * has to ship as a bitmap. Rendered at 3x and displayed at a third of that,
 * so it stays crisp on retina without shipping a large file.
 *
 * One-shot: run it again only if public/whirl.svg changes.
 *   node apps/v2/scripts/render-email-logo.mjs
 *
 * node, not bun: Playwright drives the browser over a pipe transport that
 * bun's child_process doesn't wire up on Windows, so the launch sits there
 * until it times out.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");

const SIZE = 96; // displayed at 32px
const svg = readFileSync(join(publicDir, "whirl.svg"), "utf8");

/* Use a browser that's already on the machine rather than making everyone
   download Playwright's bundled Chromium for one 96px sprite. */
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
const page = await browser.newPage({
  viewport: { width: SIZE, height: SIZE },
  deviceScaleFactor: 1,
});
await page.setContent(
  `<html><body style="margin:0;width:${SIZE}px;height:${SIZE}px">
     <div style="width:${SIZE}px;height:${SIZE}px">${svg.replace(
       /width="\d+"\s+height="\d+"/,
       `width="${SIZE}" height="${SIZE}"`,
     )}</div>
   </body></html>`,
);
const png = await page.screenshot({ omitBackground: true });
await browser.close();

const out = join(publicDir, "whirl-mark.png");
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes, ${SIZE}x${SIZE})`);
