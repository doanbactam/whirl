import { AnimatePresence } from "motion/react";
import { IconAlertTriangle, IconBrowser } from "@tabler/icons-react";

import {
  CloseButton,
  FullscreenToggle,
  useArtifactShell,
} from "~/components/artifact-shell";
import { HtmlExportButtons } from "~/components/html/html-export-buttons";
import { HtmlFrameView } from "~/components/html/html-frame-view";
import { useDocumentSidebar } from "~/lib/document-sidebar";
import { useLiveHtmlArtifact } from "~/lib/shared-artifacts";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";
import { useMinMd } from "~/lib/use-media";

/**
 * The HTML page panel. Shares the resizable/fullscreen shell with the document
 * panel (only one is ever open) and shows whichever full HTML artifact
 * {@link useDocumentSidebar} has open via `liveHtmlId`. While the background
 * builder works it shows a building state; when complete it renders the page in
 * a sandboxed iframe that can be fullscreened, opened in a new tab, or saved.
 */
export function HtmlSidebar() {
  const { liveHtmlId, closeDocument, fullscreen } = useDocumentSidebar();
  const minMd = useMinMd();
  const Shell = useArtifactShell();
  const isFullscreen = minMd && fullscreen;

  return (
    <AnimatePresence initial={false}>
      {liveHtmlId ? (
        <Shell
          key={`html:${liveHtmlId}`}
          onClose={closeDocument}
          fullscreen={isFullscreen}
        >
          <HtmlPanelContents htmlId={liveHtmlId} onClose={closeDocument} />
        </Shell>
      ) : null}
    </AnimatePresence>
  );
}

function HtmlPanelContents({
  htmlId,
  onClose,
}: {
  htmlId: string;
  onClose: () => void;
}) {
  const capture = useCapture();
  const live = useLiveHtmlArtifact(htmlId);

  const title = live?.title?.trim() || "HTML page";
  const status = live?.status;
  const building =
    live === undefined || status === "pending" || status === "generating";
  const failed = status === "failed";
  const ready = status === "complete" && Boolean(live?.content);

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-black/[0.06] px-4 dark:border-white/[0.06]">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] text-neutral-600 dark:bg-white/[0.06] dark:text-neutral-300">
          <IconBrowser size={16} stroke={2} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13.5px] font-medium text-neutral-900 dark:text-neutral-100">
            {title}
          </span>
          <span className="flex items-center gap-1.5 truncate text-[11px] text-neutral-500 dark:text-neutral-400">
            {live !== null && building ? (
              <>
                <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-500/80" />
                Building…
              </>
            ) : failed ? (
              "Couldn't build"
            ) : (
              "Created with Whirl"
            )}
          </span>
        </span>
        {ready && live ? (
          <HtmlExportButtons
            title={title}
            html={live.content}
            shortId={live.shortId}
          />
        ) : null}
        <FullscreenToggle
          onToggle={(next) =>
            capture(ANALYTICS_EVENTS.htmlFullscreenToggled, { fullscreen: next })
          }
        />
        <CloseButton onClose={onClose} label="Close page" />
      </header>
      <div className="relative min-h-0 flex-1">
        {live === null ? (
          <CenteredNote>This page isn't available anymore.</CenteredNote>
        ) : failed ? (
          <ErrorState error={live?.error} />
        ) : ready && live ? (
          <HtmlFrameView html={live.content} title={title} fill />
        ) : (
          <BuildingState />
        )}
      </div>
    </>
  );
}

/** A tasteful "assembling the page" skeleton shown while the builder works. */
function BuildingState() {
  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-6">
      <div className="h-7 w-2/5 animate-pulse rounded-lg bg-black/[0.06] dark:bg-white/[0.07]" />
      <div className="h-24 w-full animate-pulse rounded-xl bg-black/[0.05] dark:bg-white/[0.05]" />
      <div className="grid grid-cols-2 gap-4">
        <div className="h-20 animate-pulse rounded-xl bg-black/[0.05] dark:bg-white/[0.05]" />
        <div className="h-20 animate-pulse rounded-xl bg-black/[0.05] dark:bg-white/[0.05]" />
      </div>
      <div className="h-4 w-5/6 animate-pulse rounded bg-black/[0.06] dark:bg-white/[0.07]" />
      <div className="h-4 w-3/4 animate-pulse rounded bg-black/[0.06] dark:bg-white/[0.07]" />
      <div className="mt-auto flex items-center justify-center gap-2 text-[12.5px] text-neutral-500 dark:text-neutral-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#0c82f2]" />
        Whirl is building your page…
      </div>
    </div>
  );
}

function ErrorState({ error }: { error?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/10 text-red-500">
        <IconAlertTriangle size={20} stroke={2} />
      </span>
      <div className="flex flex-col gap-1">
        <span className="text-[13.5px] font-medium text-neutral-800 dark:text-neutral-100">
          Couldn't build this page
        </span>
        <span className="text-[12.5px] text-neutral-500 dark:text-neutral-400">
          {error?.trim() ||
            "Something went wrong while generating it. Ask Whirl to try again."}
        </span>
      </div>
    </div>
  );
}

function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-neutral-500 dark:text-neutral-400">
      {children}
    </div>
  );
}
