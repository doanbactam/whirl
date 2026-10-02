import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";

const nextConfig: NextConfig = {
  /* Turbopack keeps a filesystem cache in .next between dev sessions, on by
     default since Next 16.1. It is not bounded, and it does not prune: over
     about two and a half weeks this one reached 21GB across 13,000 files,
     with another 90,000 stale HMR chunks beside it. Every compile then does
     its I/O across all of that — and on Windows, through the antivirus
     scanning it — which is how the dev server ends up wedged on "compiling"
     until it gets restarted.

     Recompiling from source instead costs a slower first load and nothing
     after that. Deleting the cache alone doesn't hold: it grows straight
     back. Run `bun run clean` if .next ever needs resetting anyway. */
  experimental: {
    turbopackFileSystemCacheForDev: false,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.VERCEL_DEPLOYMENT_ID ??
      process.env.GIT_COMMIT_SHA ??
      `dev-${Date.now()}`,
    NEXT_PUBLIC_APP_ENV: process.env.VERCEL_ENV ?? "development",
    /* The public origin behind canonical URLs, the sitemap and share
       metadata (lib/site.ts). Set it explicitly anywhere but Vercel, where
       the production domain fills in for it. */
    NEXT_PUBLIC_SITE_URL:
      process.env.NEXT_PUBLIC_SITE_URL ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "http://localhost:3000"),
  },
  /* Next blocks cross-origin requests to dev assets, which kills HMR and
     the overlay when browsing through a proxy or another device. List those
     hosts, comma-separated, in DEV_ALLOWED_ORIGINS. */
  allowedDevOrigins: (process.env.DEV_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};

/* BotID proxies its challenge script through this origin (see the rewrites
   withBotId adds), so an ad blocker can't strip it. */
export default withBotId(nextConfig);
