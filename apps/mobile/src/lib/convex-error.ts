import { Alert } from "react-native";
import { ConvexError } from "convex/values";

/**
 * Convex's errors are written for whoever wrote the backend. A failed mutation
 * arrives as an Error whose message is the whole server-side stack —
 * `[CONVEX M(threads:setPinned)] Uncaught Error: Thread not found\n  at ...` —
 * which is exactly right in a log and no use at all in an alert.
 *
 * Everything the user can see goes through here, the same way Clerk's errors
 * go through `describeClerkError`.
 */

const GENERIC = "Something went wrong on our end. Please try again in a moment.";

const NETWORK =
  "We couldn't reach whirl. Check your connection and try again.";

/** Server-side messages we have better wording for. */
const FRIENDLY: Array<[RegExp, string]> = [
  [/not authenticated/i, "You're signed out. Sign back in and try again."],
  [/thread not found/i, "That thread is gone — someone deleted it already."],
  [/title cannot be empty/i, "Give the thread a name first."],
  [/folder not found/i, "That folder is gone."],
];

/** The first line of a Convex error, minus its `[CONVEX …]` prefix. */
function firstLine(message: string): string {
  const line = message.split("\n")[0] ?? message;
  return line
    .replace(/^\[CONVEX [^\]]*\]\s*/, "")
    .replace(/^\[Request ID:[^\]]*\]\s*/, "")
    .replace(/^Uncaught (ConvexError|Error):\s*/, "")
    .trim();
}

export function describeConvexError(error: unknown): string {
  if (!error) return GENERIC;

  /* A `ConvexError` carries whatever the backend chose to send — a string for
     every one whirl throws — so it needs no unwrapping. */
  if (error instanceof ConvexError) {
    const data = error.data;
    const message = typeof data === "string" ? data : firstLine(error.message);
    return match(message);
  }

  if (error instanceof Error) return match(firstLine(error.message));
  if (typeof error === "string") return match(error);
  return GENERIC;
}

function match(message: string): string {
  if (!message) return GENERIC;
  if (/network|fetch failed|timeout|offline/i.test(message)) return NETWORK;

  for (const [pattern, friendly] of FRIENDLY) {
    if (pattern.test(message)) return friendly;
  }

  /* Anything still carrying a stack frame or a file path was never meant for
     a person — better the honest catch-all than a leaked internal. */
  if (/\bat \w+|\.ts:\d+/.test(message)) return GENERIC;
  return message;
}

/**
 * Runs a mutation and, if it fails, says so.
 *
 * There's no toast surface in the app yet, and a silent failure on a
 * destructive action is the worst of both worlds — so failures land in the
 * platform alert, which is native everywhere and needs no chrome of its own.
 * The promise is swallowed on purpose: every caller is a fire-and-forget tap.
 */
export function run(title: string, work: Promise<unknown>): void {
  work.catch((cause: unknown) => {
    Alert.alert(title, describeConvexError(cause));
  });
}
