import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

// A unique identifier for this build. On Vercel every deployment gets a
// distinct git SHA; locally we fall back to a per-build timestamp. The client
// compares this against the live production version pushed via Convex to detect
// when a newer deployment has shipped (see ~/lib/version-check).
const APP_VERSION =
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.VERCEL_DEPLOYMENT_ID ??
  `dev-${Date.now()}`;

// Vercel environment ("production" | "preview" | "development"). The update
// prompt only runs in production so previews don't read as a perpetual mismatch.
const APP_ENV = process.env.VERCEL_ENV ?? "development";

export default defineConfig({
  server: {
    // Extra hosts allowed to reach the dev server, comma-separated.
    allowedHosts: (process.env.DEV_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
  },
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __APP_ENV__: JSON.stringify(APP_ENV),
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      srcDirectory: "app",
    }),
    viteReact(),
    nitro(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  optimizeDeps: {
    // These document parsers load lazily when someone attaches a file.
    // Pre-bundling keeps the dev server from choking on CommonJS interop the
    // first time extraction runs.
    include: ["jszip", "mammoth/mammoth.browser.js"],
  },
});
