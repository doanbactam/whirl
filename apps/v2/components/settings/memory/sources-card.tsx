"use client";

import { IconArrowUpRight, IconMessage2 } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorText } from "@/lib/integrations-data";
import { formatRelative } from "@/lib/relative-time";
import { showToast } from "@/lib/toasts";
import type { MemorySource, useMemorySources } from "@/lib/user-memory";
import { useView } from "@/lib/view";
import { ArmRemoveButton } from "../arm-remove-button";
import { ListPager } from "../list-pager";
import { SettingsCard, SettingsGroupHeader } from "../settings-rows";
import { MemorySyncRow } from "./memory-sync-row";

/* The raw material behind the memories: every chat Whirl has handed to
   Supermemory. Removing one takes the transcript out of the index — the
   facts already extracted from it live on in the list above. */

/** Ingestion stages worth calling out; "done" is the boring happy path. */
function statusLine(source: MemorySource): string | null {
  if (source.status === "failed") return "Couldn't be indexed";
  if (source.status !== "done" && source.status !== "unknown") {
    return "Still indexing";
  }
  return null;
}

function SourceSkeletons() {
  return (
    <div className="flex flex-col divide-y divide-border">
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-40 max-w-full" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SourcesCard({
  store,
}: {
  store: ReturnType<typeof useMemorySources>;
}) {
  const { data, loading, error, load, remove } = store;
  const { openThread, closeSettings } = useView();

  const openChat = (threadId: string) => {
    openThread(threadId);
    closeSettings();
  };

  const totalItems = data?.totalItems ?? 0;
  const totalPages = data?.totalPages ?? 0;
  const page = data?.page ?? 1;

  return (
    <section>
      <SettingsGroupHeader
        title="Synced chats"
        description={
          totalItems > 0
            ? `${totalItems} ${totalItems === 1 ? "conversation" : "conversations"} Whirl reads memories out of.`
            : "The conversations Whirl reads memories out of."
        }
      />
      <SettingsCard>
        <MemorySyncRow onSynced={() => void load(1)} />

        {data === undefined ? (
          <SourceSkeletons />
        ) : error ? (
          <div className="flex flex-wrap items-center justify-between gap-2 p-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => void load(page)}>
              Try again
            </Button>
          </div>
        ) : data.sources.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            Nothing synced yet. Chats land here once Whirl has stored them.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {data.sources.map((source) => {
              const { threadId } = source;
              const status = statusLine(source);
              const stamp = source.updatedAt
                ? formatRelative(source.updatedAt)
                : null;
              return (
                <li key={source.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-well text-muted-foreground shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)]">
                    <IconMessage2 size={17} stroke={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium">
                      {source.threadTitle ?? source.title}
                    </div>
                    {/* Supermemory writes a real summary for most documents,
                        which beats repeating the title back at the user. */}
                    <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                      {[status ?? source.summary ?? "Stored in memory", stamp]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {threadId && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Open ${source.threadTitle ?? "this chat"}`}
                        className="text-muted-foreground"
                        onClick={() => openChat(threadId)}
                      >
                        <IconArrowUpRight size={16} stroke={2} />
                      </Button>
                    )}
                    <ArmRemoveButton
                      label={source.threadTitle ?? "this chat"}
                      onRemove={() => {
                        remove(source.id).catch((caught: unknown) =>
                          showToast(
                            errorText(
                              caught,
                              "Couldn't remove that chat. Try again.",
                            ),
                          ),
                        );
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Sources page server-side — each flip is a fresh Supermemory call. */}
        <ListPager
          page={page}
          totalPages={totalPages}
          disabled={loading}
          onChange={(next) => void load(next)}
        />
      </SettingsCard>
    </section>
  );
}
