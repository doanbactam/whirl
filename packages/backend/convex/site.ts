/* Where this deployment's web app lives, and what it calls itself. Share
   links, OAuth returns, checkout redirects, emails and OpenRouter's app
   attribution all build on these, so a fork changes them in one place:
   `npx convex env set SITE_URL https://your-domain`. */

export const APP_NAME = "Whirl";

/* Older deployments set the origin under one of these names, one per
   feature that needed it. They still work, in this order, so nothing has
   to be renamed in a hurry. */
const LEGACY_SITE_URL_VARS = ["WHIRL_SITE_URL", "APP_ORIGIN", "CLIENT_ORIGIN"];

const LOCAL_SITE_URL = "http://localhost:3000";

/** The web app's public origin, without a trailing slash. */
export function siteUrl(): string {
  const configured = [process.env.SITE_URL]
    .concat(LEGACY_SITE_URL_VARS.map((name) => process.env[name]))
    .find((value) => value?.trim());
  return (configured?.trim() ?? LOCAL_SITE_URL).replace(/\/+$/, "");
}
