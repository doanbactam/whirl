import { initBotId } from "botid/client/core";

import { initializePostHog } from "@/lib/posthog";
import { startRoutePerformance } from "@/lib/performance";

try {
  initializePostHog();
} catch {
  // Analytics must never prevent the app from hydrating.
}

/* Vercel BotID. The client attaches its classification headers only to the
   routes listed here; a route missing from this list fails checkBotId() on
   the server. Kirkify spends money on anonymous traffic, so its POST is the
   one that needs a browser behind it. */
initBotId({
  protect: [{ path: "/api/kirkify", method: "POST" }],
});

export function onRouterTransitionStart(
  url: string,
  navigationType: "push" | "replace" | "traverse",
) {
  startRoutePerformance(url, navigationType);
}
