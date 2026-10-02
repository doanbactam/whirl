/**
 * The technical contract handed to the model when it builds an HTML artifact.
 * This is deliberately NOT part of the always-on system prompt — it's embedded
 * in the HTML tools' input-schema descriptions, so the model only spends context
 * on it in the moment it's actually writing HTML.
 *
 * Intentionally NO style guidelines: the model has full creative freedom over
 * the look. We only state the hard rules the artifact must obey to render inside
 * the sandboxed iframe at all. The host document (see app/lib/html-frame.ts)
 * still injects --whirl-* theme tokens and a base reset, so an artifact can opt
 * into matching the app, but nothing here requires it.
 */

/**
 * The reference block embedded in the HTML tools' schema descriptions. Tells the
 * model the hard, functional rules for a sandbox-safe artifact — and nothing
 * about how it should look.
 */
export const HTML_THEME_REFERENCE = `Sandbox rules:
- Return a body fragment with inline style/script only; no doctype, html, head, or body.
- No network access: no fetch/XHR, external scripts, stylesheets, fonts, CDNs, or nested iframes. Use HTML/CSS/SVG/canvas, vanilla JS, and data URIs.
- Exception: <img> and CSS background-image MAY use an https image URL that appears in this conversation (a user attachment or a whirl-generated image). Never invent or hotlink any other external URL.
- Do not set a fixed body height or assume a viewport.
- JavaScript may only control local interactivity or animation.`;
