import posthog from "posthog-js";

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

export const analyticsEnabled = Boolean(projectToken);

export const ANALYTICS_EVENTS = {
  messageSent: "message_sent",
  messageSendFailed: "message_send_failed",
  messageQueued: "message_queued",
  messageDequeued: "message_dequeued",
  generationRetried: "generation_retried",
  generationStopped: "generation_stopped",
  messageEdited: "message_edited",
  messageQuoted: "message_quoted",
  threadBranched: "thread_branched",
  threadRolledBack: "thread_rolled_back",
  threadRenamed: "thread_renamed",
  threadTitleRegenerated: "thread_title_regenerated",
  threadDeleted: "thread_deleted",
  threadPinToggled: "thread_pin_toggled",
  threadFolderChanged: "thread_folder_changed",
  threadShared: "thread_shared",
  threadShareRevoked: "thread_share_revoked",
  /* Locked threads. Counts and outcomes only — never anything that could
     narrow down a password, a recovery key, or what's in the conversation. */
  threadLocked: "thread_locked",
  threadUnlocked: "thread_unlocked",
  threadUnlockFailed: "thread_unlock_failed",
  threadLockPasswordChanged: "thread_lock_password_changed",
  threadLockRemoved: "thread_lock_removed",
  lockedTurnSent: "locked_turn_sent",
  lockedTurnFailed: "locked_turn_failed",
  folderCreated: "folder_created",
  folderRenamed: "folder_renamed",
  folderDeleted: "folder_deleted",
  integrationSuggestionShown: "integration_suggestion_shown",
  integrationSuggestionClicked: "integration_suggestion_clicked",
  frontendPerformance: "frontend_performance",
  /* The Median support panel. What happens inside it (a conversation, a bug
     report, a resolution) is Median's to count, so this is only the open. */
  supportOpened: "support_opened",
  /* The acquisition funnel (W-155), in order:
       visitor_landed → signup_completed → first_chat_sent
         → free_limit_reached → paywall_viewed → plan_purchased
     The three missing from this list are emitted by the backend, in
     packages/backend/convex/funnel.ts — only the server knows a chat really
     landed, a gate really denied a turn, or Autumn really took the money.
     Keep the two name lists in step. */
  visitorLanded: "visitor_landed",
  signupStarted: "signup_started",
  signupCompleted: "signup_completed",
  paywallViewed: "paywall_viewed",
  checkoutStarted: "checkout_started",
} as const;

export type AnalyticsEvent =
  (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

export function initializePostHog() {
  if (!projectToken || posthog.__loaded) return;

  posthog.init(projectToken, {
    api_host: host,
    defaults: "2026-05-30",
    capture_exceptions: true,
  });
}

export function captureEvent(
  event: AnalyticsEvent,
  properties?: Record<string, unknown>,
) {
  if (!posthog.__loaded) return;
  try {
    posthog.capture(event, properties);
  } catch {
    // Analytics must never affect the interaction that emitted the event.
  }
}

/* Surfaces that mount more than once per visit — a paywall the user opens,
   backs out of and opens again, a message list that remounts on every thread
   swap — would otherwise report the same sighting several times. `key` is
   whatever makes two sightings the same one; the ledger lives for the page. */
const capturedOnce = new Set<string>();

export function captureEventOnce(
  key: string,
  event: AnalyticsEvent,
  properties?: Record<string, unknown>,
) {
  if (capturedOnce.has(key)) return;
  capturedOnce.add(key);
  captureEvent(event, properties);
}
