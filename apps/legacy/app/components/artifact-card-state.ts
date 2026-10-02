import type { TablerIcon } from "@tabler/icons-react";
import {
  IconBrowser,
  IconChartBubble,
  IconFile,
  IconFilePencil,
  IconWand,
} from "@tabler/icons-react";

import type { LiveHtmlArtifact } from "~/components/html/shared";
import type { Phase } from "~/data/messages";

export type DocumentPhase = Extract<Phase, { kind: "document" }>;
export type HtmlPhase = Extract<Phase, { kind: "html" }>;

/**
 * The one lifecycle every artifact chat card moves through. Replaces the
 * per-card boolean soups (streaming / pendingCreate / loadingRow / building)
 * so documents, inline visualizations and full pages all agree on what
 * "still working" means — including the stretch where the message phase has
 * finalized but the live row is still streaming or the background builder is
 * still generating.
 */
export type ArtifactCardState = "working" | "complete" | "failed" | "hidden";

// The message phase is the document card's source of truth: the row can
// briefly flip complete before the tool result finalizes the phase, and late
// deltas can still settle behind it. There's no background builder for docs,
// so the phase alone decides.
export function deriveDocumentCardState(
  phase: DocumentPhase,
): ArtifactCardState {
  if (phase.pending) return "working";
  // Failures never surface in the chat: a fully-missed edit drops its pending
  // card server-side, and a stale failed phase renders nothing.
  if (phase.ok === false || !phase.documentId) return "hidden";
  return "complete";
}

export function deriveHtmlCardState(
  phase: HtmlPhase,
  live: LiveHtmlArtifact | null | undefined,
): ArtifactCardState {
  const status = live?.status;
  const loadingRow = Boolean(phase.htmlId) && live === undefined;
  // Working while: the phase is in flight and the row hasn't settled; the row
  // itself reports work (a streaming inline body, or the background builder's
  // pending/generating — which can outlive the phase's pending flag); or the
  // row is still loading. Trust the row's status over the slower phase flag.
  const working =
    (Boolean(phase.pending) && status !== "complete" && status !== "failed") ||
    status === "streaming" ||
    status === "pending" ||
    status === "generating" ||
    loadingRow;
  if (working) return "working";
  if (status === "failed") {
    // Only the full-page card surfaces failure; a failed inline viz hides.
    return (phase.mode ?? live?.kind) === "full" ? "failed" : "hidden";
  }
  if (phase.ok === false || !phase.htmlId) return "hidden";
  if (!live || !live.content) return "hidden";
  return "complete";
}

// Whimsical rotating labels for working cards — the same in-progress language
// as the live activity row. The first entry of each pool is the canonical one.
const DOCUMENT_CREATE_VERBS = [
  "Writing a document",
  "Wrangling paragraphs",
  "Finding the words",
  "Dotting the i's",
  "Inking the pages",
];

const DOCUMENT_EDIT_VERBS = [
  "Updating the document",
  "Polishing the prose",
  "Rearranging sentences",
  "Trimming the margins",
];

const VIZ_CREATE_VERBS = [
  "Drawing a visualization",
  "Plotting the points",
  "Mixing the colors",
  "Connecting the dots",
  "Sharpening the crayons",
];

const VIZ_EDIT_VERBS = [
  "Updating the visualization",
  "Nudging the pixels",
  "Tweaking the palette",
  "Redrawing the lines",
];

const PAGE_CREATE_VERBS = [
  "Building the page",
  "Stacking the divs",
  "Pouring the foundation",
  "Painting the pixels",
  "Hanging the header",
];

const PAGE_EDIT_VERBS = [
  "Updating the page",
  "Rearranging the furniture",
  "Repainting the walls",
];

// An edit whose artifact kind hasn't resolved yet (the row is still loading) —
// the pool swaps to the specific one once it's known, and the swap animates.
const EDIT_UNKNOWN_VERBS = [
  "Making edits",
  "Rolling up sleeves",
  "Warming up the tools",
];

export function documentWorkingLook(phase: DocumentPhase): {
  icon: TablerIcon;
  verbs: string[];
} {
  const isEdit = (phase.op ?? "create") === "edit";
  return {
    icon: isEdit ? IconFilePencil : IconFile,
    verbs: isEdit ? DOCUMENT_EDIT_VERBS : DOCUMENT_CREATE_VERBS,
  };
}

export function htmlWorkingLook(
  phase: HtmlPhase,
  live: LiveHtmlArtifact | null | undefined,
): { icon: TablerIcon; verbs: string[] } {
  const isEdit = (phase.op ?? "create") === "edit";
  const mode = phase.mode ?? live?.kind;
  if (mode === "full") {
    return isEdit
      ? { icon: IconWand, verbs: PAGE_EDIT_VERBS }
      : { icon: IconBrowser, verbs: PAGE_CREATE_VERBS };
  }
  if (mode === "inline") {
    return isEdit
      ? { icon: IconWand, verbs: VIZ_EDIT_VERBS }
      : { icon: IconChartBubble, verbs: VIZ_CREATE_VERBS };
  }
  return { icon: IconWand, verbs: EDIT_UNKNOWN_VERBS };
}
