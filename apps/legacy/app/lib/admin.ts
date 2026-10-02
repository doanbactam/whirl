import { useEffect, useReducer } from "react";
import { useUser } from "@clerk/tanstack-react-start";
import { makeFunctionReference } from "convex/server";
import { useQuery } from "convex/react";

/**
 * The active usage-multiplier event, or null when none is running. Shape mirrors
 * the `admin:getActiveMultiplier` Convex query.
 */
export type ActiveMultiplier = {
  multiplier: number;
  headline: string;
  subtext: string | null;
  applyToFreeMessages: boolean;
  expiresAt: number | null;
};

/** The raw enabled event from the server, window not yet applied. */
type MultiplierEvent = ActiveMultiplier & { startsAt: number | null };

const activeMultiplierRef =
  makeFunctionReference<"query">("admin:getActiveMultiplier");

const pendingResetNoticeRef = makeFunctionReference<"query">(
  "admin:getPendingResetNotice",
);

/** Reference for acknowledging (clearing) the current user's reset notice. */
export const acknowledgeResetNoticeRef = makeFunctionReference<"mutation">(
  "admin:acknowledgeResetNotice",
);

export type ResetNotice = { message: string; createdAt: number };

/**
 * Whether the signed-in user is an admin, derived from the Clerk publicMetadata
 * `role` claim. Convenience for showing/hiding admin UI — every admin Convex
 * function re-checks server-side, so this is never the sole gate.
 */
export function useIsAdmin(): boolean {
  const { user } = useUser();
  return user?.publicMetadata?.role === "admin";
}

// setTimeout's delay is a 32-bit int; anything longer would fire immediately.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Subscribes to the active usage-multiplier event (banner + pricing).
 *
 * The server hands back any *enabled* event with its raw start/end; the
 * window is evaluated here against a live clock. It has to be: a Convex
 * subscription only re-fires when the data changes, so a server-side
 * Date.now() gate freezes — a scheduled event would never appear and an
 * expired one would linger until an unrelated write. A timer re-renders at
 * the next boundary so the flip happens on time without polling.
 */
export function useActiveMultiplier(): ActiveMultiplier | null | undefined {
  const event = useQuery(activeMultiplierRef) as
    | MultiplierEvent
    | null
    | undefined;
  const [, bumpClock] = useReducer((n: number) => n + 1, 0);

  const now = Date.now();
  const nextBoundary = event
    ? Math.min(
        ...[event.startsAt, event.expiresAt].filter(
          (t): t is number => typeof t === "number" && t > now,
        ),
      )
    : Infinity;

  useEffect(() => {
    if (!Number.isFinite(nextBoundary)) return;
    const timer = window.setTimeout(
      bumpClock,
      // A hair past the boundary so the re-render lands on the far side.
      Math.min(nextBoundary - Date.now() + 250, MAX_TIMEOUT_MS),
    );
    return () => window.clearTimeout(timer);
  }, [nextBoundary]);

  if (!event) return event;
  if (event.startsAt != null && now < event.startsAt) return null;
  if (event.expiresAt != null && now > event.expiresAt) return null;
  return event;
}

/** The signed-in user's pending "quota reset" notice, if any. */
export function usePendingResetNotice(): ResetNotice | null | undefined {
  return useQuery(pendingResetNoticeRef) as ResetNotice | null | undefined;
}

/** Human label for the multiplier, e.g. 0.5 => "2×". */
export function multiplierLabel(multiplier: number): string {
  if (multiplier <= 0) return "1×";
  const factor = 1 / multiplier;
  const rounded = Math.round(factor * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text}×`;
}

// --- Banner dismissal (localStorage) ---------------------------------------
// Keyed by the event's window so a *new* event re-shows even after a prior one
// was dismissed. Mirrors the try/catch storage helpers in lib/sidebar.ts.

function dismissalKey(event: ActiveMultiplier): string {
  return `banner-dismissed:multiplier:${event.expiresAt ?? "open"}`;
}

export function isMultiplierBannerDismissed(event: ActiveMultiplier): boolean {
  try {
    return localStorage.getItem(dismissalKey(event)) === "1";
  } catch {
    return false;
  }
}

export function dismissMultiplierBanner(event: ActiveMultiplier): void {
  try {
    localStorage.setItem(dismissalKey(event), "1");
  } catch {
    // ignore
  }
}
