import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

// Keep the free-user daily-cost cache warm so the under-composer overload notice
// can show even before a given free user has sent anything this session. A cheap
// PostHog read — no inference, no tokens. The inference path also schedules a
// background refresh when the cached value is stale.
crons.interval(
  "refresh free-user server load",
  { minutes: 10 },
  internal.serverLoad.refresh,
  {},
);

// The stuck-turn reaper: settles assistant messages whose stream handler died
// mid-flight (client disconnect, isolate crash, hung provider) so users get a
// retryable error instead of a shimmer that never ends. Cheap — the in-flight
// statuses it scans are near-empty in steady state.
crons.interval(
  "reap dead assistant turns",
  { minutes: 1 },
  internal.streamWatchdog.sweepStuckAssistantTurns,
  {},
);

// The billing backstop: retries every charge Autumn hasn't confirmed yet (see
// convex/usageLedger.ts). One indexed read and nothing else when the ledger is
// clean, which is the normal state — it only does work after Autumn was slow,
// errored, or an isolate went away mid-charge.
crons.interval(
  "settle pending usage charges",
  { minutes: 1 },
  internal.usageLedger.sweepPendingCharges,
  {},
);

// Re-read which OpenRouter models have zero-retention endpoints. A locked
// chat may only run one of these, so the list going stale narrows what they
// can use; it going missing closes them entirely, which is why the refresh
// leaves the last good answer in place on failure.
crons.interval(
  "refresh zero-retention models",
  { hours: 6 },
  internal.zeroRetention.refresh,
  {},
);

// Backfill shelf categories for store listings the approval hook missed
// (admin-added Composio extensions, pre-category rows). A no-op — not even a
// model call — when everything is already categorized.
crons.interval(
  "categorize store listings",
  { hours: 6 },
  internal.storeCategorize.categorizeStore,
  {},
);

// /kirkify's daily counters only mean something for their own UTC day, and
// its run log only for as long as somebody might ask what a day cost. Both
// are dropped once they're past that (convex/kirkify.ts).
crons.interval(
  "sweep kirkify counters",
  { hours: 6 },
  internal.kirkify.sweep,
  {},
);

export default crons;
