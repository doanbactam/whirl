/**
 * One-shot handoff for seeding the home composer from elsewhere in the app
 * (today: the /about hero composer). sessionStorage instead of a URL param so
 * the prompt survives the client-side hop without polluting the address bar.
 */

const KEY = "whirl:composer-prefill";

export function stashComposerPrefill(text: string) {
  try {
    sessionStorage.setItem(KEY, text);
  } catch {
    // Storage unavailable (private mode quirks) — the hop just lands empty.
  }
}

/** Read and clear the stashed prompt, so it only ever seeds one composer. */
export function takeComposerPrefill(): string | null {
  try {
    const text = sessionStorage.getItem(KEY);
    if (text !== null) sessionStorage.removeItem(KEY);
    return text;
  } catch {
    return null;
  }
}
