import {
  PersistentTextStreaming,
  type StreamId,
} from "@convex-dev/persistent-text-streaming";

import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { drainQueuedMessages } from "./messageQueue";
import { settledPhases } from "./validators";

// The reliability backstop for assistant turns. Generation runs inside an HTTP
// action anchored to the sender's connection — if that action dies mid-flight
// (the tab is backgrounded or loses its network, the isolate crashes, a
// provider request hangs forever), NOTHING writes a terminal status: the
// message sits in "thinking"/"streaming" and the UI shimmers until the user
// gives up and mashes stop or retry. This cron finds those corpses and settles
// them: salvaged partial text lands as a cut-short "stopped" reply, an empty
// one becomes a clear, retryable error.
//
// Liveness comes from `heartbeatAt`, stamped every ~25s by the live handler
// (see inference/stream.ts). Three missed minutes of beats means the handler
// is gone — every write path it has would also have refreshed the stamp.

const persistentTextStreaming = new PersistentTextStreaming(
  components.persistentTextStreaming,
);

// Generous relative to the ~25s beat: a healthy handler misses this only if
// the deployment itself is having a very bad time.
const STALE_AFTER_MS = 3 * 60 * 1000;

// Per-status cap per sweep. The in-flight statuses are tiny sets in steady
// state; the cap only matters for draining the historical backlog gradually.
const SWEEP_BATCH = 50;

const LIVE_STATUSES = ["thinking", "searching", "streaming"] as const;

export const INTERRUPTED_TURN_MESSAGE =
  "This reply was interrupted before it could finish — the connection to the model dropped mid-turn. Retry to run it again.";

export const sweepStuckAssistantTurns = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let reaped = 0;

    for (const status of LIVE_STATUSES) {
      const candidates = await ctx.db
        .query("messages")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(SWEEP_BATCH);

      for (const message of candidates) {
        // Rows from before the heartbeat existed fall back to their last
        // known write; either way, silence past the threshold means dead.
        const lastAlive =
          message.heartbeatAt ??
          Math.max(message.updatedAt ?? 0, message.createdAt);
        if (now - lastAlive < STALE_AFTER_MS) continue;

        // Salvage whatever streamed before the handler died — the text lives
        // in the streaming component, not on the message row.
        let salvaged = "";
        if (message.streamId) {
          try {
            const body = await persistentTextStreaming.getStreamBody(
              ctx,
              message.streamId as StreamId,
            );
            salvaged = body?.text ?? "";
          } catch {
            // The stream row was already cleaned up — nothing to salvage.
          }
        }

        const phases = settledPhases(message.phases);
        const phasePatch =
          phases && phases !== message.phases ? { phases } : {};

        if (salvaged.trim().length > 0) {
          // A visible partial reply reads honestly as cut short.
          await ctx.db.patch(message._id, {
            status: "stopped",
            content: salvaged,
            ...phasePatch,
            updatedAt: now,
          });
        } else {
          await ctx.db.patch(message._id, {
            status: "error",
            content: INTERRUPTED_TURN_MESSAGE,
            ...phasePatch,
            updatedAt: now,
          });
        }
        reaped += 1;
        // The corpse counted as a running reply until now — anything queued
        // behind it can finally go.
        await drainQueuedMessages(ctx, message.threadId);
        console.warn("assistant_turn_reaped", {
          assistantId: message._id,
          threadId: message.threadId,
          status,
          lastAliveAgoMs: now - lastAlive,
          salvagedChars: salvaged.length,
        });
      }
    }

    return reaped;
  },
});
