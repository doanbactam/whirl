export function convexHttpOrigin(): string {
  const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
  const siteUrl = import.meta.env.VITE_CONVEX_SITE_URL as string | undefined;

  if (siteUrl) return siteUrl.replace(/\/$/, "");
  if (!convexUrl) return "";

  return convexUrl
    .replace(/\/$/, "")
    .replace(/\.convex\.cloud$/i, ".convex.site")
    .replace("://api.cloud.", "://api.");
}
