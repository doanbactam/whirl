"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { api } from "@whirl/backend/convex/_generated/api";
import { useCustomer } from "autumn-js/react";
import { useMutation } from "convex/react";

import { captureVisitorLanded } from "@/lib/funnel";
import { findActivePlanProduct } from "@/lib/plan";

/* The two ends of the funnel, watched from the app root: the moment someone
   turns up, and the moment they start paying. Everything between those is
   captured where it happens. Renders nothing. */

/**
 * Step 6. Nobody tells the browser a payment cleared — Stripe simply sends the
 * user back and Autumn's customer quietly grows a product. So we watch for one
 * to appear and hand the claim to Convex, which re-reads the customer before
 * any of it becomes revenue in PostHog (see convex/funnel.ts). Claimed once per
 * device; the milestone row makes it once per person.
 */
function PaidWatcher() {
  const { user } = useUser();
  const { customer } = useCustomer();
  const recordPaidPlan = useMutation(api.funnel.recordPaidPlan);
  const claimed = useRef(false);

  useEffect(() => {
    if (claimed.current || !user) return;
    const plan = findActivePlanProduct(customer);
    if (!plan) return;

    claimed.current = true;
    const storageKey = `funnel:paid:${user.id}`;
    try {
      if (localStorage.getItem(storageKey)) return;
    } catch {
      // No storage to read: the claim below is idempotent server-side anyway.
    }

    void recordPaidPlan({ planId: plan.id })
      .then(() => {
        try {
          localStorage.setItem(storageKey, "1");
        } catch {
          // Not worth a retry — the server already knows.
        }
      })
      .catch(() => {
        // The claim didn't land (offline, auth still settling). Let the next
        // customer update try again rather than losing the step entirely.
        claimed.current = false;
      });
  }, [customer, user, recordPaidPlan]);

  return null;
}

export function FunnelTracker() {
  const { isLoaded, isSignedIn } = useUser();
  const pathname = usePathname();
  const landingPath = useRef(pathname);
  const landed = useRef(false);

  /* Step 1, held until Clerk has answered — the landing carries whether this
     session opened signed in, and the page they walked in on rather than
     wherever they've navigated to by the time the answer arrives. */
  useEffect(() => {
    if (!isLoaded || landed.current) return;
    landed.current = true;
    captureVisitorLanded(landingPath.current, isSignedIn === true);
  }, [isLoaded, isSignedIn]);

  /* Autumn is only asked about people who could plausibly be paying — a
     signed-out visitor reading the marketing site never triggers a customer
     fetch. Conditional rendering, not a conditional hook. */
  return isSignedIn ? <PaidWatcher /> : null;
}
