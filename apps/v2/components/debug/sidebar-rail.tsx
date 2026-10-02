"use client";

import { useMemo } from "react";
import { IconPlus, IconPuzzleFilled, IconSearch } from "@tabler/icons-react";

import { cachedThreadToSummary } from "@/lib/thread-cache";
import { Separator } from "@/components/ui/separator";
import { SidebarRow } from "../sidebar-row";
import { SquishButton } from "../squish-button";
import { ThreadRow } from "../thread-row";
import { WhirlLogo } from "../whirl-logo";

/* The sidebar's chat list on the workbench: real ThreadRow instances fed
   canned summaries, so every glyph a row can wear — the spinner, the
   finished tick, the pin — can be looked at side by side without a
   signed-in account behind it. The chrome around them (logo, New, nav)
   is a still life of sidebar.tsx, close enough to read the rows in
   context; it isn't wired to anything. */

const MINUTE = 60_000;
/* A fixed clock: the group labels are hand-written, and a row's
   timestamp only feeds the hover warm-up, which never fires here. */
const BASE_TIME = 1_752_000_000_000;

const ROWS = [
  { title: "Migrate off the old billing ledger", ago: 0, running: true },
  { title: "Kirkify the team offsite photos", ago: 4, finished: true },
  { title: "Why is my Tailwind chip purple", ago: 21 },
  { title: "Sourdough starter timeline", ago: 55 },
  { title: "Lisbon in October", ago: 3 * 60, pinned: true },
];

/* Same whisper-quiet marker the real list draws between date groups. */
function GroupLabel({ children }: { children: string }) {
  return (
    <div className="flex h-5 items-center px-2.5 text-[10.5px]/4 font-medium text-muted-foreground/55">
      {children}
    </div>
  );
}

export function DebugSidebarRail() {
  const rows = useMemo(
    () =>
      ROWS.map((row, index) => ({
        ...row,
        thread: cachedThreadToSummary({
          id: `debug-thread-${index}`,
          title: row.title,
          pinnedAt: row.pinned ? BASE_TIME - row.ago * MINUTE : null,
          folderId: null,
          updatedAt: BASE_TIME - row.ago * MINUTE,
        }),
      })),
    [],
  );
  const pinned = rows.filter((row) => row.pinned);
  const loose = rows.filter((row) => !row.pinned);

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-2 px-3 pt-1 pb-2">
      <div className="flex h-7 items-center px-1.5">
        <WhirlLogo size={20} />
      </div>
      <SquishButton className="relative h-8 w-full py-0">
        <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
          <IconPlus size={16} stroke={2.5} className="shrink-0" />
          New
        </span>
      </SquishButton>
      <nav className="-mt-1.5 flex flex-col gap-0.5">
        <SidebarRow icon={IconSearch} label="Search" onClick={() => {}} />
        <SidebarRow
          icon={IconPuzzleFilled}
          label="Integrations"
          onClick={() => {}}
        />
      </nav>
      <Separator className="mx-1.5 data-horizontal:w-auto" />
      <div className="flex flex-col gap-2">
        {pinned.length > 0 && (
          <section>
            <GroupLabel>Pinned</GroupLabel>
            <div className="flex flex-col gap-0.5">
              {pinned.map((row) => (
                <ThreadRow key={row.thread.id} thread={row.thread} folders={[]} />
              ))}
            </div>
          </section>
        )}
        <section>
          <GroupLabel>Today</GroupLabel>
          <div className="flex flex-col gap-0.5">
            {loose.map((row) => (
              <ThreadRow
                key={row.thread.id}
                thread={row.thread}
                folders={[]}
                running={row.running}
                finished={row.finished}
              />
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}
