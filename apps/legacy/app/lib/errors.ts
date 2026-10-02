import { ConvexError } from "convex/values";

/**
 * The user-facing message for an error thrown by a Convex function. Convex
 * redacts plain `Error` messages to "Server Error" in production, so backend
 * code throws `ConvexError(<message>)` for anything the user should read —
 * this pulls that payload back out and falls back for everything else.
 */
export function userErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError && typeof error.data === "string") {
    return error.data;
  }
  return error instanceof Error ? error.message : fallback;
}
