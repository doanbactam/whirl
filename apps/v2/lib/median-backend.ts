/* The support tools' way into Convex (packages/backend/convex/support).
 *
 * Median's route has no Clerk session, so it can't call Convex as the
 * customer. It calls as itself instead, with MEDIAN_SUPPORT_SECRET, and names
 * the customer by the Clerk id Median's signature already proved. A missing
 * env var throws, and a thrown message reaches the agent, so a misconfigured
 * deployment makes it say lookups are down rather than invent an answer. */

import type { ToolContext } from "@mediansh/agent-tools";
import { ConvexHttpClient } from "convex/browser";

export function supportBackend() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const secret = process.env.MEDIAN_SUPPORT_SECRET;
  if (!convexUrl || !secret) {
    throw new Error("Account lookups aren't configured on this deployment.");
  }
  return { convex: new ConvexHttpClient(convexUrl), secret };
}

/** Said instead of an answer when nobody signed the visitor in. */
export const SIGNED_OUT = {
  known: false,
  reason:
    "The visitor isn't signed in to Whirl here, so there's no account to look at. Ask them to sign in and reopen support.",
} as const;

/* `externalId` only ever arrives alongside `verified: true`. Checking both
   costs nothing and survives a future change to that rule. */
export function verifiedCustomer(context: ToolContext): string | null {
  const { verified, externalId } = context.visitor;
  return verified && externalId ? externalId : null;
}
