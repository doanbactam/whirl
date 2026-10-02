/** The in-app path for a public artifact share page. */
export function visualPath(shortId: string): string {
  return `/visual/${shortId}`;
}

/** The absolute, shareable URL for an artifact (origin + path). */
export function visualUrl(shortId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${visualPath(shortId)}`;
}

/** The in-app path for a public shared-thread page. */
export function sharePath(shareId: string): string {
  return `/share/${shareId}`;
}

/** The absolute, shareable URL for a thread (origin + path). */
export function shareUrl(shareId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${sharePath(shareId)}`;
}

/** The in-app path for the raw markdown view of a shared thread. */
export function shareRawPath(shareId: string): string {
  return `${sharePath(shareId)}/raw`;
}

/** The absolute URL for a shared thread's raw markdown view. */
export function shareRawUrl(shareId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${shareRawPath(shareId)}`;
}
