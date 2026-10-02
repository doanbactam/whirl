import {
  IconArrowUpRight,
  IconChartBubble,
  IconWand,
} from "@tabler/icons-react";

import {
  ARTIFACT_SETTLE_MS,
  ArtifactIconBadge,
} from "~/components/artifact-card-shell";
import type { HtmlPhase } from "~/components/artifact-card-state";
import { HtmlFrameView } from "~/components/html/html-frame-view";
import type { LiveHtmlArtifact } from "~/components/html/shared";
import { openHtmlArtifactInNewTab } from "~/lib/html-export";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

/**
 * The settled interior of an inline visualization card (the shell and the
 * working state live in HtmlCard). A create renders the HTML in a sandboxed
 * iframe right in the conversation; a revision shows a compact "Updated" note
 * instead — the original card already updates in place, since both read the
 * same live row.
 */
export function InlineHtmlBody({
  phase,
  live,
}: {
  phase: HtmlPhase;
  live: LiveHtmlArtifact | null | undefined;
}) {
  const capture = useCapture();
  const isEdit = (phase.op ?? "create") === "edit";

  // The derived card state guarantees a content-full row here; this guard is
  // for TypeScript and the odd row that vanishes mid-render.
  if (!live?.content) return null;

  const title = phase.title?.trim() || live.title?.trim() || "Visualization";

  const openInNewTab = () => {
    capture(ANALYTICS_EVENTS.htmlOpenedInNewTab, { mode: "inline" });
    openHtmlArtifactInNewTab(title, live.content, live.shortId);
  };

  if (isEdit) {
    return (
      <div className="flex items-center gap-3 px-3.5 py-3">
        <ArtifactIconBadge icon={IconWand} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13.5px] font-medium text-neutral-900 dark:text-neutral-100">
            {title}
          </span>
          <span className="truncate text-[11.5px] text-neutral-500 dark:text-neutral-400">
            Updated
            {phase.editCount
              ? ` · ${phase.editCount} change${phase.editCount === 1 ? "" : "s"}`
              : ""}
          </span>
        </span>
        <button
          type="button"
          onClick={openInNewTab}
          aria-label="Open visualization in a new tab"
          title="Open in new tab"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-black/[0.05] dark:text-neutral-400 dark:hover:bg-white/[0.06]"
        >
          <IconArrowUpRight size={14} stroke={2} />
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-10 items-center gap-2 border-b border-black/[0.05] px-3 dark:border-white/[0.05]">
        <IconChartBubble
          size={15}
          stroke={2}
          className="shrink-0 text-neutral-500 dark:text-neutral-400"
        />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-neutral-700 dark:text-neutral-200">
          {title}
        </span>
        <button
          type="button"
          onClick={openInNewTab}
          aria-label="Open visualization in a new tab"
          title="Open in new tab"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-black/[0.05] dark:text-neutral-400 dark:hover:bg-white/[0.06]"
        >
          <IconArrowUpRight size={14} stroke={2} />
        </button>
      </div>
      {/* The iframe waits out the card's entrance choreography before it
          mounts — painting under an animating ancestor is how the card used
          to freeze as a ghost (see HtmlFrameView). */}
      <HtmlFrameView
        html={live.content}
        title={title}
        mountDelayMs={ARTIFACT_SETTLE_MS}
      />
    </>
  );
}
