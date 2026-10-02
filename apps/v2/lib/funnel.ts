/* The browser's half of the acquisition funnel (W-155).

   Whirl's funnel runs visitor → signup → first chat → free limit → paywall →
   paid. The steps a person *sees* are captured here; the ones only the server
   can vouch for (the chat that landed, the gate that denied, the plan Autumn
   confirmed) come from packages/backend/convex/funnel.ts. Both halves report
   against the same distinct id, so PostHog reads them as one journey. */

import { ANALYTICS_EVENTS, captureEvent, captureEventOnce } from "./posthog";

/** Where a person was standing when the paywall came into view. */
export type PaywallSource =
  /** The in-app /pricing face. */
  | "pricing_page"
  /** The compact plan picker in settings → Billing. */
  | "upgrade_dialog"
  /** The public /about/pricing page — often the very first look. */
  | "marketing_pricing"
  /** The Platinum page, which sells (or takes requests for) the premium line. */
  | "platinum_page"
  /** The banner on a reply that never happened, after a gate said no. */
  | "thread_gate_banner";

const VISITOR_KEY = "funnel:visitor-landed";

/**
 * Step 1. One landing per browser session, whichever surface caught them —
 * the marketing site, a shared thread, or the app itself. Sessions rather than
 * page loads so a visitor reading four pages stays one visitor.
 *
 * `signed_in` says whether the session opened with an account already attached,
 * which is what separates a genuinely new visitor from someone coming back to
 * a chat. Worth waiting for Clerk to answer before reporting the landing.
 */
export function captureVisitorLanded(path: string, signedIn: boolean) {
  try {
    if (sessionStorage.getItem(VISITOR_KEY)) return;
    sessionStorage.setItem(VISITOR_KEY, "1");
  } catch {
    // Storage can be denied outright (private mode, locked-down browsers).
    // Better a duplicate landing than a funnel with no first step.
  }
  captureEvent(ANALYTICS_EVENTS.visitorLanded, {
    path,
    signed_in: signedIn,
    referrer: typeof document === "undefined" ? undefined : document.referrer,
  });
}

/**
 * Step 5. Fires once per source per page for the same reason the paywall
 * itself is idempotent: reopening the plan picker isn't a new decision.
 */
export function capturePaywallViewed(source: PaywallSource, gate?: string) {
  captureEventOnce(
    `paywall:${source}:${gate ?? "none"}`,
    ANALYTICS_EVENTS.paywallViewed,
    { source, gate },
  );
}

/**
 * Between paywall and payment: they picked a plan and committed to it — either
 * off to Stripe (`stripe`) or straight through Autumn for a customer who
 * already has a card on file (`in_app`).
 */
export function captureCheckoutStarted(plan: string, via: "stripe" | "in_app") {
  captureEvent(ANALYTICS_EVENTS.checkoutStarted, { plan, via });
}
