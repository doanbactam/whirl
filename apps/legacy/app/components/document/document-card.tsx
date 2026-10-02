import { useEffect } from "react";
import { IconArrowUpRight } from "@tabler/icons-react";

import {
  ArtifactCardShell,
  ArtifactIconBadge,
  ArtifactWorkingBody,
} from "~/components/artifact-card-shell";
import {
  deriveDocumentCardState,
  documentWorkingLook,
  type DocumentPhase,
} from "~/components/artifact-card-state";
import { useReportArtifactWorking } from "~/components/activity/artifact-activity";
import { useDocumentSidebar } from "~/lib/document-sidebar";
import { useLiveDocument } from "~/lib/shared-artifacts";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

/**
 * The inline chat card for a markdown document whirl authored or revised. One
 * persistent shell whose interior hard-swaps working → complete: while the
 * model streams the body it rotates whimsical labels over an indeterminate
 * bar (and a fresh create auto-pops the side panel so the user watches it
 * being written); once the phase finalizes it becomes the openable card.
 */
export function DocumentCard({ phase }: { phase: DocumentPhase }) {
  const { openDocumentById, autoOpenStreamingDocument } = useDocumentSidebar();
  const capture = useCapture();

  const op = phase.op ?? "create";
  const isEdit = op === "edit";
  const state = deriveDocumentCardState(phase);
  const working = state === "working";
  const { icon, verbs } = documentWorkingLook(phase);

  const live = useLiveDocument(phase.documentId, working);
  useReportArtifactWorking(working);

  // A freshly-created doc opens itself the first time it streams, so the user
  // watches it fill in. Edits don't auto-open (the user may not be looking at
  // that doc).
  useEffect(() => {
    if (phase.pending && !isEdit && phase.documentId) {
      autoOpenStreamingDocument(phase.documentId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.pending, phase.documentId, isEdit]);

  if (state === "hidden") return null;

  const title =
    phase.title?.trim() || live?.title?.trim() || "Untitled document";

  const open = () => {
    capture(ANALYTICS_EVENTS.documentCardOpened, {
      op,
      ...(phase.editCount !== undefined ? { edit_count: phase.editCount } : {}),
    });
    if (phase.documentId) openDocumentById(phase.documentId);
  };

  const subtitle = isEdit
    ? `Updated${phase.editCount ? ` · ${phase.editCount} change${phase.editCount === 1 ? "" : "s"}` : ""}`
    : "Document";

  return (
    <ArtifactCardShell>
      {working ? (
        <ArtifactWorkingBody icon={icon} verbs={verbs} />
      ) : (
        <button
          type="button"
          onClick={open}
          className="group/doc flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
        >
          <ArtifactIconBadge icon={icon} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13.5px] font-medium text-neutral-900 dark:text-neutral-100">
              {title}
            </span>
            <span className="truncate text-[11.5px] text-neutral-500 dark:text-neutral-400">
              {subtitle}
            </span>
          </span>
          <span className="flex h-7 items-center gap-1 rounded-full bg-black/[0.04] px-2.5 text-[11.5px] font-medium text-neutral-600 transition-colors group-hover/doc:bg-black/[0.07] dark:bg-white/[0.06] dark:text-neutral-300 dark:group-hover/doc:bg-white/[0.1]">
            Open
            <IconArrowUpRight size={13} stroke={2} />
          </span>
        </button>
      )}
    </ArtifactCardShell>
  );
}
