/// <reference types="vite/client" />

// Build-time constants injected via Vite `define`. Used to detect when a newer
// deployment has shipped (see ~/lib/version-check).
declare const __APP_VERSION__: string;
declare const __APP_ENV__: string;

// mammoth ships no types, and its default entry is Node-only (it needs
// `Buffer`, which Vite doesn't polyfill). We load the prebuilt, self-contained
// browser bundle instead (see ~/lib/document-text), so a tiny ambient surface
// keeps us honest without a heavy or stale @types package.
declare module "mammoth/mammoth.browser.js" {
  interface Mammoth {
    extractRawText(input: {
      arrayBuffer: ArrayBuffer;
    }): Promise<{ value: string; messages: unknown[] }>;
  }
  const mammoth: Mammoth;
  export default mammoth;
}
