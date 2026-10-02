import { useEffect, useMemo, useRef, useState } from "react";
import { IconArrowUpRight, IconSitemap } from "@tabler/icons-react";
import { useIsCodeFenceIncomplete } from "streamdown";

import { CopyButton } from "~/components/markdown/copy-button";
import { useIsDark } from "~/lib/use-dark";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

// A ```mermaid fence rendered as a live diagram card — same family as the
// inline visualization card (title bar with icon + open-in-new-tab, body
// below). The source stays one copy click away, and while the model is still
// writing the fence a quiet shimmer holds the spot.

type MermaidModule = typeof import("mermaid").default;

let mermaidPromise: Promise<MermaidModule> | null = null;
function loadMermaid(): Promise<MermaidModule> {
  mermaidPromise ??= import("mermaid").then((mod) => mod.default);
  return mermaidPromise;
}

let renderSeq = 0;

/** Parse-gated render: resolves to the SVG markup, or null for invalid source
 *  (mid-stream fragments land here constantly — that's expected, not an error). */
async function renderMermaid(code: string, dark: boolean): Promise<string | null> {
  const mermaid = await loadMermaid();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: dark ? "dark" : "neutral",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
  });
  const ok = await mermaid
    .parse(code, { suppressErrors: true })
    .catch(() => false);
  if (!ok) return null;
  const id = `whirl-mermaid-${renderSeq++}`;
  try {
    const { svg } = await mermaid.render(id, code);
    return svg;
  } catch {
    // Mermaid can leave its scratch node behind on a failed render.
    document.getElementById(`d${id}`)?.remove();
    return null;
  }
}

/** The soft placeholder shown while the diagram is still being written. */
function DiagramShimmer() {
  return (
    <div className="relative h-28 overflow-hidden">
      <div className="absolute inset-0 bg-black/[0.03] dark:bg-white/[0.04]" />
      <div
        aria-hidden
        className="image-shimmer-gleam absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/50 to-transparent dark:via-white/[0.1]"
      />
    </div>
  );
}

export function MermaidDiagram({ code }: { code: string }) {
  const capture = useCapture();
  const dark = useIsDark();
  const incomplete = useIsCodeFenceIncomplete();
  const [svg, setSvg] = useState<string | null>(null);
  // Only report "couldn't draw" once the fence is closed — anything before
  // that is just a half-written diagram, not a failure.
  const [failed, setFailed] = useState(false);
  const reportedRef = useRef<"ok" | "fail" | null>(null);

  useEffect(() => {
    let cancelled = false;
    // A short debounce batches the flurry of streaming updates; theme flips
    // and the final settle re-render land on the same path.
    const timer = window.setTimeout(() => {
      void renderMermaid(code, dark).then((result) => {
        if (cancelled) return;
        if (result) {
          setSvg(result);
          setFailed(false);
          if (reportedRef.current !== "ok") {
            reportedRef.current = "ok";
            capture(ANALYTICS_EVENTS.mermaidDiagramRendered, {
              source_length: code.length,
            });
          }
        } else if (!incomplete) {
          setFailed(true);
          if (reportedRef.current === null) {
            reportedRef.current = "fail";
            capture(ANALYTICS_EVENTS.mermaidDiagramFailed, {
              source_length: code.length,
            });
          }
        }
      });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [code, dark, incomplete, capture]);

  const openInNewTab = useMemo(() => {
    if (!svg) return undefined;
    return () => {
      capture(ANALYTICS_EVENTS.mermaidOpenedInNewTab);
      const blob = new Blob([svg], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      // Revoking immediately races the new tab's load — give it a minute.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };
  }, [svg, capture]);

  // A finished fence that never parsed: keep the source visible in the same
  // card so nothing silently vanishes — just with an honest subtitle.
  const showSourceFallback = failed && !svg;

  return (
    <div className="group/mermaid my-3 overflow-hidden rounded-xl border border-black/[0.08] dark:border-white/[0.08]">
      <div className="flex h-10 items-center gap-2 border-b border-black/[0.05] bg-black/[0.02] px-3 dark:border-white/[0.05] dark:bg-white/[0.03]">
        <IconSitemap
          size={15}
          stroke={2}
          className="shrink-0 text-neutral-500 dark:text-neutral-400"
        />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-neutral-700 dark:text-neutral-200">
          {showSourceFallback ? "Diagram (couldn't be drawn)" : "Diagram"}
        </span>
        <span onClick={() => capture(ANALYTICS_EVENTS.mermaidSourceCopied)}>
          <CopyButton getText={() => code} label={false} />
        </span>
        {openInNewTab && (
          <button
            type="button"
            onClick={openInNewTab}
            aria-label="Open diagram in a new tab"
            title="Open in new tab"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-black/[0.05] dark:text-neutral-400 dark:hover:bg-white/[0.06]"
          >
            <IconArrowUpRight size={14} stroke={2} />
          </button>
        )}
      </div>
      {svg ? (
        <div
          className="table-scroll flex justify-center overflow-x-auto px-4 py-4 [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : showSourceFallback ? (
        <pre className="overflow-x-auto bg-transparent px-3.5 py-3 font-mono text-[12.5px] leading-[1.6] text-neutral-800 dark:text-neutral-200">
          <code>{code}</code>
        </pre>
      ) : (
        <DiagramShimmer />
      )}
    </div>
  );
}
