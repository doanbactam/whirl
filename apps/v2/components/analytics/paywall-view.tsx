"use client";

import { useEffect } from "react";

import { capturePaywallViewed, type PaywallSource } from "@/lib/funnel";

/**
 * Funnel step 5, as a component: mount it wherever plans are on screen and the
 * sighting is reported. Renders nothing, so it can sit inside any layout
 * without touching it.
 *
 * `gate` names the thing the user was reaching for when the wall appeared
 * (`messages`, `basic`, `can_search`, …) — the honest answer to "what were they
 * trying to do?" — and keeps two different walls on the same surface distinct.
 */
export function PaywallView({
  source,
  gate,
}: {
  source: PaywallSource;
  gate?: string;
}) {
  useEffect(() => {
    capturePaywallViewed(source, gate);
  }, [source, gate]);

  return null;
}
