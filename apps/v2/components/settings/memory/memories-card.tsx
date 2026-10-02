"use client";

import { useMemo, useState } from "react";
import { IconPlus, IconRefresh } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { Memory, useMemories } from "@/lib/user-memory";
import { ListPager } from "../list-pager";
import {
  SettingsCard,
  SettingsGroupHeader,
  SettingsSearchRow,
} from "../settings-rows";
import { AddMemoryDialog } from "./add-memory-dialog";
import { MemoryRow } from "./memory-row";

/* Everything Whirl currently believes about the user, editable. The whole
   list is fetched up front, so search and paging are both local — instant,
   and no per-row animation to flicker on every keystroke. */

// Below this the list is short enough to scan; a search field would be noise.
const SEARCH_THRESHOLD = 6;
const PAGE_SIZE = 10;

/** Permanent traits sit above the rest — they're the profile, not the
 *  running commentary — then newest first within each group. Sorting is
 *  global rather than per-page, so the pinned ones are always on page 1. */
function byPinnedThenRecent(a: Memory, b: Memory) {
  if (a.isStatic !== b.isStatic) return a.isStatic ? -1 : 1;
  return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
}

function MemorySkeletons() {
  return (
    <div className="flex flex-col divide-y divide-border">
      {["w-4/5", "w-3/5", "w-2/3"].map((width, index) => (
        <div key={index} className="flex flex-col gap-2 px-4 py-3.5">
          <Skeleton className={`h-3.5 ${width}`} />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

export function MemoriesCard({
  store,
}: {
  store: ReturnType<typeof useMemories>;
}) {
  const { memories, totalItems, error, refresh, add, edit, forget } = store;
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const matches = useMemo(() => {
    if (!memories) return undefined;
    const needle = query.trim().toLowerCase();
    const rows = needle
      ? memories.filter((row) => row.memory.toLowerCase().includes(needle))
      : memories;
    return [...rows].sort(byPinnedThenRecent);
  }, [memories, query]);

  const totalPages = Math.max(1, Math.ceil((matches?.length ?? 0) / PAGE_SIZE));
  /* Forgetting the last row on the last page shrinks the list under the
     current page — follow it down rather than showing an empty slice. */
  const safePage = Math.min(page, totalPages);
  const visible = matches?.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  const search = (next: string) => {
    setQuery(next);
    setPage(1);
  };

  const reload = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const count = memories?.length ?? 0;
  const showSearch = count > SEARCH_THRESHOLD;
  // Past the fetch cap the list is a slice, and saying so beats pretending.
  const capped = totalItems > count;

  return (
    <section>
      <SettingsGroupHeader
        title="Saved memories"
        description={
          capped
            ? `Showing the ${count} most recent of ${totalItems}.`
            : count > 0
              ? `${count} ${count === 1 ? "memory" : "memories"} Whirl carries between chats.`
              : "Facts Whirl carries between chats."
        }
        control={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh memories"
              className="text-muted-foreground"
              disabled={refreshing}
              onClick={() => void reload()}
            >
              {refreshing ? <Spinner /> : <IconRefresh size={15} stroke={2} />}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAdding(true)}
            >
              <IconPlus size={14} stroke={2} />
              Add memory
            </Button>
          </div>
        }
      />
      <SettingsCard>
        {showSearch && (
          <SettingsSearchRow
            value={query}
            onChange={search}
            placeholder="Search memories"
          />
        )}

        {memories === undefined ? (
          <MemorySkeletons />
        ) : error ? (
          <div className="flex flex-wrap items-center justify-between gap-2 p-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => void reload()}>
              Try again
            </Button>
          </div>
        ) : count === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            Nothing yet. Whirl picks memories up as you chat — or write the
            first one yourself.
          </p>
        ) : visible?.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No memories match “{query.trim()}”.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {visible?.map((memory) => (
              <MemoryRow
                key={memory.id}
                memory={memory}
                onSave={edit}
                onForget={forget}
              />
            ))}
          </ul>
        )}

        <ListPager
          page={safePage}
          totalPages={totalPages}
          onChange={setPage}
        />
      </SettingsCard>

      <AddMemoryDialog open={adding} onOpenChange={setAdding} onAdd={add} />
    </section>
  );
}
