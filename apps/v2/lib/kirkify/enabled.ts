import "server-only";

/* Kirkify is an optional extra: it only exists on a deployment that has set
   KIRKIFY_SECRET (shared with Convex). Without it the page 404s and nothing
   links to it. Server-only, because the secret is. */
export function kirkifyEnabled(): boolean {
  return Boolean(process.env.KIRKIFY_SECRET);
}
