import { ConvexError } from "convex/values";

/**
 * True when an error from a Convex function means the caller's session is
 * gone (expired/revoked Clerk token) rather than a genuine server fault.
 * Convex redacts plain `Error` messages to "Server Error" in production, so
 * the backend throws `ConvexError("Not authenticated")` — the data payload
 * survives redaction. The message check keeps dev throws covered too.
 */
export function isAuthError(error: unknown): boolean {
  if (error instanceof ConvexError && error.data === "Not authenticated") {
    return true;
  }
  return error instanceof Error && /not authenticated/i.test(error.message);
}
