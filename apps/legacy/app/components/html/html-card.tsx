import { useEffect } from "react";

import {
  ArtifactCardShell,
  ArtifactWorkingBody,
} from "~/components/artifact-card-shell";
import {
  deriveHtmlCardState,
  htmlWorkingLook,
  type HtmlPhase,
} from "~/components/artifact-card-state";
import { useReportArtifactWorking } from "~/components/activity/artifact-activity";
import {
  FullHtmlBody,
  FullHtmlFailedBody,
} from "~/components/html/full-html-card";
import { InlineHtmlBody } from "~/components/html/inline-html-card";
import { useDocumentSidebar } from "~/lib/document-sidebar";
import {
  useIsSharedArtifacts,
  useLiveHtmlArtifact,
} from "~/lib/shared-artifacts";

/**
 * The inline chat card for any `html` phase — visualization or full page,
 * create or edit. One persistent shell per phase: the interior hard-swaps
 * working → complete/failed (deliberately unanimated — see ArtifactCardShell
 * for the frozen-iframe saga), with the working body rotating whimsical
 * labels from the very first frame — even before the row id round-trips, or
 * when an edit doesn't yet know which kind of artifact it's touching (its
 * pool swaps once the row loads).
 */
export function HtmlCard({ phase }: { phase: HtmlPhase }) {
  const live = useLiveHtmlArtifact(phase.htmlId);
  const state = deriveHtmlCardState(phase, live);
  const working = state === "working";
  const isEdit = (phase.op ?? "create") === "edit";
  const mode = phase.mode ?? live?.kind;
  const status = live?.status;

  useReportArtifactWorking(working);

  // A freshly-built page opens itself the first time it starts generating, so
  // the user watches it appear. Lives here (not in the full body) because it
  // must fire while the working body is showing. Edits don't auto-open, and a
  // shared thread is read-only — nothing pops the panel on load.
  const shared = useIsSharedArtifacts();
  const { autoOpenStreamingHtml } = useDocumentSidebar();
  useEffect(() => {
    if (
      !shared &&
      !isEdit &&
      mode === "full" &&
      phase.htmlId &&
      (status === "generating" || status === "complete")
    ) {
      autoOpenStreamingHtml(phase.htmlId);
    }
  }, [shared, isEdit, mode, phase.htmlId, status, autoOpenStreamingHtml]);

  if (state === "hidden") return null;

  const { icon, verbs } = htmlWorkingLook(phase, live);
  // Only the full page shows its title while working: it's written once up
  // front, whereas streaming inline titles would thrash the label morph.
  const workingTitle =
    mode === "full" && !isEdit
      ? phase.title?.trim() || live?.title?.trim() || undefined
      : undefined;
  // An inline create renders the viz in place, so it gets the wide shell for
  // its whole lifecycle; everything else stays the compact card.
  const wide = mode === "inline" && !isEdit;

  return (
    <ArtifactCardShell className={wide ? "w-full max-w-[600px]" : undefined}>
      {working ? (
        <ArtifactWorkingBody icon={icon} verbs={verbs} title={workingTitle} />
      ) : state === "failed" ? (
        <FullHtmlFailedBody live={live} />
      ) : mode === "full" ? (
        <FullHtmlBody phase={phase} live={live} />
      ) : (
        <InlineHtmlBody phase={phase} live={live} />
      )}
    </ArtifactCardShell>
  );
}
