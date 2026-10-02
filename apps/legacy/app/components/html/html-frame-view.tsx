import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";

import { buildHtmlSrcDoc } from "~/lib/html-frame";
import { useIsDark } from "~/lib/use-dark";

const INLINE_MIN_HEIGHT = 80;
const INLINE_MAX_HEIGHT = 640;

/**
 * Renders a finished HTML artifact inside a sandboxed iframe. The sandbox is
 * `allow-scripts` only — NO `allow-same-origin` — so scripts run in an opaque
 * origin with no access to cookies, storage, the network, or the host page; the
 * artifact can animate and be interactive but can't touch anything.
 *
 * `fill` fills its container (the side panel). Otherwise it's an inline card
 * that sizes itself to the content via the height the host doc posts up.
 *
 * The inline mode is deliberately animation-proof. Chromium composites an
 * iframe that paints while ANY ancestor is mid-animation of a compositable
 * property (filter, opacity, transform — we've been burned by each) as a
 * stale snapshot that never repaints: the frozen ghost-card bug. So the
 * iframe mounts only after `mountDelayMs` (the chat card passes
 * ARTIFACT_SETTLE_MS so the message row's mount fades have finished) and
 * stays `visibility: hidden` until the srcdoc reports its height. The only
 * thing that ever animates is the wrapper's `height` — a pure layout
 * property that Motion drives per-frame in JS, which never promotes a
 * compositor surface, so the card grows/shrinks to fit without the bug.
 */
export function HtmlFrameView({
  html,
  title,
  fill = false,
  maxHeight = INLINE_MAX_HEIGHT,
  mountDelayMs = 0,
}: {
  html: string;
  title?: string;
  fill?: boolean;
  /** Cap for the auto-height (inline) mode. The share page raises this so a full
   * page expands fully and the outer page scrolls. */
  maxHeight?: number;
  /** Hold the iframe mount this long so entrance animations settle first. */
  mountDelayMs?: number;
}) {
  const dark = useIsDark();
  const srcDoc = useMemo(
    () => buildHtmlSrcDoc(html, { dark, fill }),
    [html, dark, fill],
  );
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(INLINE_MIN_HEIGHT);
  const [mounted, setMounted] = useState(mountDelayMs <= 0);
  // The srcdoc has painted and told us how tall it is — safe to show.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (mounted) return;
    const timer = setTimeout(() => setMounted(true), mountDelayMs);
    return () => clearTimeout(timer);
  }, [mounted, mountDelayMs]);

  useEffect(() => {
    if (fill) return; // the panel iframe just fills its container
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      if ((e.data as { type?: string } | null)?.type !== "whirl-html-height") {
        return;
      }
      const reported = Number((e.data as { height?: unknown }).height);
      if (!Number.isFinite(reported)) return;
      setHeight(
        Math.min(Math.max(Math.ceil(reported), INLINE_MIN_HEIGHT), maxHeight),
      );
      setReady(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [fill, maxHeight]);

  if (fill) {
    return (
      <iframe
        ref={frameRef}
        title={title || "Whirl visualization"}
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        className="h-full w-full border-0 bg-transparent"
      />
    );
  }

  return (
    <motion.div
      initial={false}
      animate={{ height }}
      transition={{ duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
      className="w-full overflow-hidden"
    >
      {mounted && (
        <iframe
          ref={frameRef}
          title={title || "Whirl visualization"}
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          className="block h-full w-full border-0 bg-transparent"
          style={ready ? undefined : { visibility: "hidden" }}
        />
      )}
    </motion.div>
  );
}
