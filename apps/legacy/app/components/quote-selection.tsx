import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { IconQuote } from "@tabler/icons-react";

import { COMPOSER_GLASS_CONTROL } from "~/components/composer";
import { useComposerIngest } from "~/lib/composer-ingest";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

/**
 * Message regions opt into quoting with this attribute (value = message role).
 * See the user bubble and assistant body in message-bubble.tsx.
 */
const QUOTABLE_SELECTOR = "[data-quotable]";

type QuoteTarget = {
  text: string;
  role: string;
  /** Selection rect in viewport coords (the popover is position: fixed). */
  left: number;
  top: number;
  bottom: number;
};

/** The nearest quotable message container above a selection endpoint. */
function quotableHost(node: Node | null): Element | null {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return el?.closest(QUOTABLE_SELECTOR) ?? null;
}

function readSelection(): QuoteTarget | null {
  const sel = window.getSelection?.();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  // Both ends must sit inside the SAME message — a drag that spills across
  // bubbles (or out of the feed entirely) isn't a quotable selection.
  const anchorHost = quotableHost(sel.anchorNode);
  const focusHost = quotableHost(sel.focusNode);
  if (!anchorHost || anchorHost !== focusHost) return null;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    text,
    role: anchorHost.getAttribute("data-quotable") || "assistant",
    left: rect.left + rect.width / 2,
    top: rect.top,
    bottom: rect.bottom,
  };
}

/**
 * A floating "Quote" pill that appears over selected message text. One click
 * drops the selection into the composer as a markdown blockquote, ready to be
 * replied to — no copy-paste round trip. Mount once per chat feed.
 */
export function QuoteSelectionPopover() {
  const [target, setTarget] = useState<QuoteTarget | null>(null);
  const { insertQuote } = useComposerIngest();
  const capture = useCapture();

  useEffect(() => {
    let raf = 0;
    // Selections settle a beat after pointerup/keyup; read on the next frame.
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setTarget(readSelection()));
    };
    // Hide the moment the selection collapses (click-away, Escape, typing).
    const onSelectionChange = () => {
      const sel = window.getSelection?.();
      if (!sel || sel.isCollapsed) setTarget(null);
    };
    document.addEventListener("pointerup", update);
    document.addEventListener("keyup", update);
    document.addEventListener("selectionchange", onSelectionChange);
    // Capture-phase scroll: the chat feed scrolls in a nested container, and
    // the pill is fixed-positioned, so it must track the selection's new spot.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("pointerup", update);
      document.removeEventListener("keyup", update);
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, []);

  const handleQuote = useCallback(() => {
    if (!target) return;
    const quote = target.text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    if (insertQuote(quote)) {
      capture(ANALYTICS_EVENTS.messageQuoted, {
        role: target.role,
        selection_length: target.text.length,
      });
    }
    window.getSelection()?.removeAllRanges();
    setTarget(null);
  }, [target, insertQuote, capture]);

  if (typeof document === "undefined") return null;

  // Above the selection by default; below it when the selection starts at the
  // very top of the viewport. Clamped so the pill never slides off-screen.
  const flip = target ? target.top < 56 : false;
  const left = target
    ? Math.min(Math.max(target.left, 56), window.innerWidth - 56)
    : 0;
  const top = target ? (flip ? target.bottom + 8 : target.top - 8) : 0;

  return createPortal(
    <AnimatePresence>
      {target && (
        <motion.div
          key="quote-selection"
          initial={{ opacity: 0, y: flip ? -4 : 4, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: flip ? -4 : 4, scale: 0.95 }}
          transition={{ duration: 0.14, ease: [0.22, 0.61, 0.36, 1] }}
          className={`fixed z-[70] -translate-x-1/2 ${
            flip ? "" : "-translate-y-full"
          }`}
          style={{ left, top }}
        >
          <button
            type="button"
            // Keep the selection alive through the click — a bare mousedown
            // would collapse it (and hide this pill) before the click lands.
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleQuote}
            className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium text-neutral-700 dark:text-neutral-200 ${COMPOSER_GLASS_CONTROL}`}
          >
            <IconQuote size={14} stroke={2} />
            Quote
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
