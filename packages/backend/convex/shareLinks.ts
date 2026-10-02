/* Absolute public share links for whirl artifacts, built backend-side so
   the model can hand them out in replies. The tokens are minted at
   creation (documents.ts, html.ts); these pages are served by the main
   app, at the origin convex/site.ts resolves. */

import { siteUrl } from "./site";

/** {origin}/doc/{shortId} — a document's public share page. */
export function documentShareLink(shortId: string): string {
  return `${siteUrl()}/doc/${shortId}`;
}

/** {origin}/visual/{shortId} — a visualization/page's public share page. */
export function visualShareLink(shortId: string): string {
  return `${siteUrl()}/visual/${shortId}`;
}
