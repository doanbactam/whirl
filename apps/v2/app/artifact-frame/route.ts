/* The document a React artifact runs inside.
 *
 * Served from our own origin — but embedded with `sandbox="allow-scripts"` and
 * NO `allow-same-origin`, so it still lands in an opaque origin with no access
 * to cookies, storage, or the host page. Being a real URL instead of a srcdoc
 * buys two things worth having:
 *
 *  1. the 1MB runtime loads as a normal cached subresource, once, instead of
 *     being inlined as text into every iframe, and
 *  2. it can carry response headers — specifically a CSP.
 *
 * The CSP is the part that matters. An artifact with data bindings has real
 * integration data in the frame, and `connect-src 'none'` plus a closed
 * `img-src` means there is no way to send it anywhere: no fetch, no
 * websocket, no beacon, no pixel to an attacker's host. The model is told not
 * to try; this is what makes it true.
 */

/** Convex storage serves conversation images; nothing else may be loaded. */
function imageSources(): string {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return "'self' data: blob:";
  try {
    return `'self' data: blob: ${new URL(convexUrl).origin}`;
  } catch {
    return "'self' data: blob:";
  }
}

const CSP = [
  "default-src 'none'",
  // 'unsafe-eval' is required twice over: the compiled module runs through
  // `new Function`, and the Tailwind browser engine compiles at runtime.
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
  // Tailwind injects a <style> element as it compiles.
  "style-src 'unsafe-inline'",
  `img-src ${imageSources()}`,
  "font-src data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join("; ");

/* Utilities are generated at runtime from the classes actually present, so the
   frame ships no stylesheet of its own — only the theme bridge (the app's
   --whirl-* tokens, set by the host) and a class-driven dark variant, since
   the sandbox must follow the app's theme rather than the OS's. */
const SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style type="text/tailwindcss">
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));
</style>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  html.fill, html.fill body, html.fill #root { height: 100%; }
  body {
    font-family: var(--whirl-font-sans);
    color: var(--whirl-fg);
    background: transparent;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    overflow-wrap: anywhere;
  }
  html.fill body { background: var(--whirl-bg); overflow-y: auto; }
  img, svg, canvas, video { max-width: 100%; height: auto; }
  :focus-visible { outline: 2px solid var(--whirl-accent); outline-offset: 2px; }
</style>
</head>
<body>
<div id="root"></div>
<script src="/artifact-runtime.js"></script>
</body>
</html>`;

export function GET() {
  return new Response(SHELL, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      // The shell never changes between deploys; the runtime it pulls in is
      // fingerprint-free, so keep that one revalidating.
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
