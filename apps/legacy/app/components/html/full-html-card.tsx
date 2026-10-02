import {
  IconAlertTriangle,
  IconArrowUpRight,
  IconBrowser,
} from "@tabler/icons-react";

import { ArtifactIconBadge } from "~/components/artifact-card-shell";
import type { HtmlPhase } from "~/components/artifact-card-state";
import type { LiveHtmlArtifact } from "~/components/html/shared";
import { useDocumentSidebar } from "~/lib/document-sidebar";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

/**
 * The settled interior of a full HTML page card (the shell, the working state
 * and the auto-open behavior live in HtmlCard): an openable row once the
 * background builder finishes.
 */
export function FullHtmlBody({
  phase,
  live,
}: {
  phase: HtmlPhase;
  live: LiveHtmlArtifact | null | undefined;
}) {
  const capture = useCapture();
  const { openHtmlById } = useDocumentSidebar();
  const isEdit = (phase.op ?? "create") === "edit";

  const title = phase.title?.trim() || live?.title?.trim() || "HTML page";

  const open = () => {
    if (!phase.htmlId) return;
    capture(ANALYTICS_EVENTS.htmlCardOpened, {
      mode: "full",
      op: phase.op ?? "create",
    });
    openHtmlById(phase.htmlId);
  };

  const subtitle = isEdit
    ? `Updated${phase.editCount ? ` · ${phase.editCount} change${phase.editCount === 1 ? "" : "s"}` : ""}`
    : "HTML page";

  return (
    <button
      type="button"
      onClick={open}
      className="group/html flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
    >
      <ArtifactIconBadge icon={IconBrowser} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13.5px] font-medium text-neutral-900 dark:text-neutral-100">
          {title}
        </span>
        <span className="truncate text-[11.5px] text-neutral-500 dark:text-neutral-400">
          {subtitle}
        </span>
      </span>
      <span className="flex h-7 items-center gap-1 rounded-full bg-black/[0.04] px-2.5 text-[11.5px] font-medium text-neutral-600 transition-colors group-hover/html:bg-black/[0.07] dark:bg-white/[0.06] dark:text-neutral-300 dark:group-hover/html:bg-white/[0.1]">
        Open
        <IconArrowUpRight size={13} stroke={2} />
      </span>
    </button>
  );
}

/** The failure interior — only full pages surface build failures in the chat. */
export function FullHtmlFailedBody({
  live,
}: {
  live: LiveHtmlArtifact | null | undefined;
}) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <ArtifactIconBadge icon={IconAlertTriangle} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13.5px] font-medium text-neutral-700 dark:text-neutral-200">
          Couldn't build the page
        </span>
        <span className="truncate text-[11.5px] text-neutral-500 dark:text-neutral-400">
          {live?.error?.trim() || "Something went wrong while generating it."}
        </span>
      </div>
    </div>
  );
}
