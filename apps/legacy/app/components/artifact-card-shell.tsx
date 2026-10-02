import type { ReactNode } from "react";
import type { TablerIcon } from "@tabler/icons-react";

import {
  LabelMorph,
  useRotatingVerb,
} from "~/components/activity/rotating-verb";
import { Squircle } from "~/components/squircle";

/**
 * Shared chrome for the inline chat cards that whirl's artifacts render as
 * (documents and HTML). Kept here so the document card and the HTML cards stay
 * visually identical without duplicating the shell, icon badge, or the
 * indeterminate "working" progress bar.
 */

// No backdrop-blur here: a backdrop-filter keeps the card permanently
// composited, which is half of the Chromium frozen-iframe bug (see
// HtmlFrameView). Over the flat chat background it was invisible anyway.
export const ARTIFACT_SURFACE =
  "rounded-2xl border border-black/[0.06] bg-white/70 shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:border-white/[0.06] dark:bg-white/[0.03]";

/** How long the message row's own mount fades can still be running after a
 * card's interior mounts (the row's opacity/y entrance, the cached-thread
 * blur-in). Anything that must never paint under an animating ancestor (the
 * inline viz iframe) waits this long before mounting. */
export const ARTIFACT_SETTLE_MS = 400;

/** The card the inline artifact chrome sits in. Callers own the full
 * width/max-width via `className` (a document card is fixed-width; an inline viz
 * is wider) so there's no competing max-width on the base.
 *
 * Deliberately a static div — NO entrance, crossfade, filter or transform.
 * An inline viz mounts a sandboxed iframe in here, and Chromium freezes an
 * iframe that paints while any ancestor animates (filter, transform, even a
 * plain opacity fade) as a stale ghost snapshot that never repaints. We
 * chased that bug through three animation variants; the card is static now.
 * Keep it that way. (The Lisse clip-path is set once and never animated, so
 * it doesn't re-trigger the bug.) */
export function ArtifactCardShell({
  children,
  className = "w-[380px] max-w-full",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Squircle
      radius={12}
      className={`mt-1 overflow-hidden ${ARTIFACT_SURFACE} ${className}`}
    >
      {children}
    </Squircle>
  );
}

/** A rounded icon badge, sized to sit in the artifact card header. */
export function ArtifactIconBadge({ icon }: { icon: TablerIcon }) {
  const Glyph = icon;
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black/[0.04] text-neutral-600 dark:bg-white/[0.06] dark:text-neutral-300">
      <Glyph size={17} stroke={2} />
    </span>
  );
}

/**
 * An indeterminate progress bar — the "working" affordance while streaming.
 * Driven by a CSS keyframe (see `.artifact-progress-bar` in app.css), NOT
 * framer-motion: the artifact cards re-render on every streamed delta, which
 * restarts a JS keyframe loop each time and leaves the bar frozen off-screen.
 */
export function ArtifactProgressBar() {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
      <div className="artifact-progress-bar h-full w-1/3 rounded-full bg-neutral-400/80 dark:bg-neutral-400/70" />
    </div>
  );
}

/**
 * The one working state every artifact card shows: icon badge, a rotating
 * whimsical label (same shimmer language as the live activity row) and the
 * indeterminate bar. `title` adds a static subtitle once it's known (used by
 * full pages, whose title is written up front — streaming titles would make
 * the morph thrash on every character).
 */
export function ArtifactWorkingBody({
  icon,
  verbs,
  title,
}: {
  icon: TablerIcon;
  verbs: string[];
  title?: string;
}) {
  const verb = useRotatingVerb(verbs);
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <ArtifactIconBadge icon={icon} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="flex min-w-0 flex-col">
          <LabelMorph
            text={verb}
            ellipsis
            shimmer
            className="text-[13.5px] leading-5 font-medium"
          />
          {title && (
            <LabelMorph
              text={title}
              className="max-w-full truncate text-[11.5px] leading-4 text-neutral-500 dark:text-neutral-400"
            />
          )}
        </span>
        <ArtifactProgressBar />
      </div>
    </div>
  );
}
