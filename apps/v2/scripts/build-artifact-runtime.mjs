/* Bundles the artifact sandbox runtime into public/artifact-runtime.js.
 *
 * The sandbox has no network, so the host inlines this file's TEXT into the
 * iframe document. That means it can't be a Next chunk — it has to be one
 * self-contained IIFE with React, Recharts and the Tailwind browser engine
 * baked in. Run via `bun run build:runtime`; the app's `build` script runs it
 * first, and the committed output keeps `next dev` working without it.
 */

import { rm } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outdir = path.join(root, "public");
const outfile = path.join(outdir, "artifact-runtime.js");

await rm(outfile, { force: true });

const result = await Bun.build({
  entrypoints: [path.join(root, "artifact-runtime", "index.tsx")],
  outdir,
  naming: "artifact-runtime.js",
  target: "browser",
  format: "iife",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("artifact runtime build failed");
}

const bytes = (await Bun.file(outfile).arrayBuffer()).byteLength;
console.log(
  `artifact-runtime.js: ${(bytes / 1024).toFixed(0)} KB (${(bytes / 1024 / 1024).toFixed(2)} MB)`,
);
