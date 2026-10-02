/**
 * One source of truth for the site's SEO + social metadata.
 *
 * `seo()` returns the `meta`/`links` arrays a route's `head()` spreads in. The
 * root route sets the site-wide baseline (brand title, description, Open Graph
 * + Twitter cards); individual routes call `seo({ ... })` to override only the
 * bits that are page-specific.
 *
 * TanStack Router dedupes meta by `name`/`property` (child route wins) and keeps
 * the first `title` it sees (child wins), so overriding from a route Just Works.
 * Canonical `<link>`s are NOT deduped, so we only emit one — pass `url` only on
 * pages that should declare a canonical (the homepage and public share pages),
 * never on transient in-app screens.
 */

export const SITE_URL = "https://whirl.chat";
export const SITE_NAME = "Whirl";

export const DEFAULT_TITLE =
  "Whirl — The AI chat app that actually cares about you";

export const DEFAULT_DESCRIPTION =
  "An AI chat app with memory that actually cares about you. Chat across the best models, create living documents and visualizations, and pick up right where you left off.";

/** Absolute URL to the 1200×630 social card in `public/`. */
export const OG_IMAGE = `${SITE_URL}/whirl-og.png`;

type SeoOptions = {
  /** Page title. Falls back to the brand title. */
  title?: string;
  /** Page description. Falls back to the brand description. */
  description?: string;
  /** Social card image (absolute URL). */
  image?: string;
  /**
   * Canonical path or absolute URL. When set, emits `<link rel="canonical">`
   * and `og:url`. Only pass this on pages meant to stand on their own in search
   * or social previews (the homepage, public share pages).
   */
  url?: string;
  /** Open Graph type. */
  type?: "website" | "article";
  /** Keep the page out of search results. */
  noindex?: boolean;
};

function toAbsolute(url: string) {
  return url.startsWith("http") ? url : `${SITE_URL}${url}`;
}

export function seo({
  title,
  description = DEFAULT_DESCRIPTION,
  image = OG_IMAGE,
  url,
  type = "website",
  noindex = false,
}: SeoOptions = {}) {
  const resolvedTitle = title ?? DEFAULT_TITLE;
  const canonical = url ? toAbsolute(url) : undefined;

  return {
    meta: [
      { title: resolvedTitle },
      { name: "description", content: description },
      { name: "robots", content: noindex ? "noindex, nofollow" : "index, follow" },

      { property: "og:type", content: type },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:title", content: resolvedTitle },
      { property: "og:description", content: description },
      { property: "og:image", content: image },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: resolvedTitle },

      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: resolvedTitle },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: image },
      { name: "twitter:image:alt", content: resolvedTitle },

      ...(canonical ? [{ property: "og:url", content: canonical }] : []),
    ],
    links: canonical ? [{ rel: "canonical", href: canonical }] : [],
  };
}
