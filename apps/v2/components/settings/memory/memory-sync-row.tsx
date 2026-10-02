"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { api } from "@whirl/backend/convex/_generated/api";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/integrations-data";
import { formatRelative } from "@/lib/relative-time";
import { showToast } from "@/lib/toasts";
import { SettingsRow } from "../settings-rows";

/* Backfill: walk the chats Whirl hasn't handed to memory yet and upload
   them. Capped to one run a day server-side, so the button spends most of
   its life explaining when the next one unlocks. The run row is a real
   Convex document, so progress ticks in live — no polling. */

const SOFT_REASONS: Record<string, string> = {
  paid: "Syncing past chats is available on paid plans.",
  running: "A sync is already running.",
  cooldown: "You can sync your past chats once a day.",
  empty: "Nothing new to sync — memory is already up to date.",
  disabled: "Turn memory on first, then sync.",
};

export function MemorySyncRow({ onSynced }: { onSynced: () => void }) {
  const { isAuthenticated } = useConvexAuth();
  const status = useQuery(
    api.memoryIndex.getStatus,
    isAuthenticated ? {} : "skip",
  );
  const start = useAction(api.memoryIndex.start);
  const [starting, setStarting] = useState(false);

  const running = status?.isRunning ?? false;
  const wasRunning = useRef(false);

  /* A finished run means new documents upstream — let the list reload. */
  useEffect(() => {
    if (wasRunning.current && !running) onSynced();
    wasRunning.current = running;
  }, [running, onSynced]);

  const lastRun = status?.lastRun ?? null;
  const cooldownEnds = status?.nextAvailableAt ?? null;

  const description = running
    ? lastRun && lastRun.totalThreads > 0
      ? `Syncing ${lastRun.processedThreads} of ${lastRun.totalThreads} chats…`
      : "Starting the sync…"
    : lastRun?.status === "failed"
      ? "The last sync didn't finish. Try again."
      : cooldownEnds
        ? `Synced ${lastRun?.finishedAt ? formatRelative(lastRun.finishedAt) : "recently"}. Once a day.`
        : "Hand your older chats to memory in one pass.";

  const run = async () => {
    if (starting || running) return;
    setStarting(true);
    try {
      const result = await start({});
      if (!result.started) {
        showToast(
          SOFT_REASONS[result.reason ?? ""] ?? "Couldn't start the sync.",
        );
      }
    } catch (error) {
      showToast(errorText(error, "Couldn't start the sync. Try again."));
    } finally {
      setStarting(false);
    }
  };

  return (
    <SettingsRow
      title="Sync past chats"
      description={description}
      control={
        <Button
          variant="secondary"
          size="sm"
          className="min-w-[84px]"
          disabled={starting || running || !!cooldownEnds}
          onClick={() => void run()}
        >
          {starting || running ? <Spinner /> : "Sync now"}
        </Button>
      }
    />
  );
}
