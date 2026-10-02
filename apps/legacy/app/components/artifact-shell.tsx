import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import {
  IconArrowsDiagonal,
  IconArrowsDiagonalMinimize2,
  IconX,
} from "@tabler/icons-react";

import { useDocumentSidebar } from "~/lib/document-sidebar";
import {
  DOCUMENT_PANEL_DEFAULT_WIDTH,
  clampDocumentPanelWidth,
  persistDocumentPanelWidth,
  readDocumentPanelWidth,
  snapDocumentPanelWidth,
} from "~/lib/document-panel";
import { useMinMd } from "~/lib/use-media";

/**
 * The shared right-hand artifact panel shell, used by both the document sidebar
 * and the HTML sidebar (only one is ever open at a time). On desktop it's a
 * resizable panel that pushes the chat aside and can morph to fullscreen; on
 * mobile it's a full-screen overlay. The panels share one persisted width.
 */

type ShellProps = {
  onClose: () => void;
  /** Desktop: fill the content area (chat hidden). Ignored by the overlay. */
  fullscreen?: boolean;
  children: ReactNode;
};

/** Desktop: an inline, drag-to-resize panel that shares the row with the chat. */
export function EmbeddedPanel({
  onClose,
  fullscreen = false,
  children,
}: ShellProps) {
  const [width, setWidth] = useState(readDocumentPanelWidth);
  const [isResizing, setIsResizing] = useState(false);
  // The width the panel grows to in fullscreen = the whole content region (its
  // flex parent), which the chat shares. Animating to a real px width (rather
  // than a transform) makes the panel reflow as it morphs, no distortion. The
  // chat, as a flex sibling with min-w-0, is squeezed to zero as we grow.
  const asideRef = useRef<HTMLElement>(null);
  const [fillWidth, setFillWidth] = useState(0);
  useEffect(() => {
    const parent = asideRef.current?.parentElement;
    if (!parent) return;
    const measure = () => setFillWidth(parent.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  // The card overlays the content region while fullscreen — and must stay an
  // overlay through the *exit* morph too, only re-docking once the width has
  // animated all the way back (otherwise it briefly renders full-width inside
  // the narrow docked slot and overflows). `overlay` turns on with fullscreen
  // and off when the shrink-back animation completes.
  const [overlay, setOverlay] = useState(false);
  useEffect(() => {
    if (fullscreen) setOverlay(true);
  }, [fullscreen]);
  const resizeStartRef = useRef<{ x: number; width: number } | null>(null);
  // Teardown for an in-flight resize drag (global listeners + the body styles we
  // hijack). Held in a ref so unmounting mid-drag can run it — `onEnd` clears it
  // once a drag finishes normally, so this is a no-op in the common case.
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => resizeCleanupRef.current?.(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Drag the left edge: pulling left (smaller clientX) widens the panel.
  const onResizePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      resizeStartRef.current = { x: e.clientX, width };
      setIsResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: PointerEvent) => {
        const start = resizeStartRef.current;
        if (!start) return;
        setWidth(clampDocumentPanelWidth(start.width + (start.x - ev.clientX)));
      };

      const cleanup = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onEnd);
        document.removeEventListener("pointercancel", onEnd);
        resizeCleanupRef.current = null;
      };

      const onEnd = (ev: PointerEvent) => {
        const start = resizeStartRef.current;
        resizeStartRef.current = null;
        setIsResizing(false);
        cleanup();
        if (start) {
          const next = snapDocumentPanelWidth(
            start.width + (start.x - ev.clientX),
          );
          setWidth(next);
          persistDocumentPanelWidth(next);
        }
      };

      resizeCleanupRef.current = cleanup;
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onEnd);
      document.addEventListener("pointercancel", onEnd);
    },
    [width],
  );

  const onResizeDoubleClick = useCallback(() => {
    setWidth(DOCUMENT_PANEL_DEFAULT_WIDTH);
    persistDocumentPanelWidth(DOCUMENT_PANEL_DEFAULT_WIDTH);
  }, []);

  const transition = isResizing
    ? { duration: 0 }
    : {
        type: "tween" as const,
        duration: 0.32,
        ease: [0.32, 0.72, 0, 1] as [number, number, number, number],
      };

  return (
    <motion.aside
      ref={asideRef}
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: width + 8, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={transition}
      className={`z-0 hidden h-full shrink-0 py-2 pr-2 md:block ${
        overlay ? "" : "relative"
      }`}
    >
      <motion.div
        animate={{ width: fullscreen ? Math.max(fillWidth - 16, 0) : width }}
        transition={transition}
        onAnimationComplete={() => {
          if (!fullscreen) setOverlay(false);
        }}
        className={`flex flex-col overflow-hidden rounded-[28px] border border-black/[0.06] bg-white shadow-[inset_0_1px_3px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.06] dark:border-white/[0.06] dark:bg-[#1A1A19] dark:ring-white/[0.06] ${
          overlay
            ? "absolute bottom-2 right-2 top-2 z-30"
            : "relative h-full"
        }`}
      >
        {!overlay && (
          <button
            type="button"
            aria-label="Resize panel"
            title="Drag to resize. Double-click for default width."
            onPointerDown={onResizePointerDown}
            onDoubleClick={onResizeDoubleClick}
            className="group absolute inset-y-0 left-0 z-20 flex w-2.5 cursor-col-resize touch-none items-center justify-center"
          >
            <span className="h-10 w-[3px] rounded-full bg-black/[0.08] transition-colors group-hover:bg-black/20 dark:bg-white/[0.12] dark:group-hover:bg-white/30" />
          </button>
        )}
        {children}
      </motion.div>
    </motion.aside>
  );
}

/** Mobile: a full-screen overlay that slides up over the chat. */
export function OverlayPanel({ onClose, children }: ShellProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <motion.div
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ type: "spring", stiffness: 360, damping: 36 }}
      className="fixed inset-0 z-[70] flex flex-col bg-white dark:bg-[#1A1A19]"
    >
      {children}
    </motion.div>,
    document.body,
  );
}

/** Picks the right shell for the viewport. */
export function useArtifactShell() {
  const minMd = useMinMd();
  return minMd ? EmbeddedPanel : OverlayPanel;
}

/**
 * Desktop-only toggle that expands the panel to fill the content area (hiding
 * the chat) and back. `onToggle` lets the caller record analytics for its own
 * artifact kind; the fullscreen state itself is shared in the sidebar context.
 */
export function FullscreenToggle({
  onToggle,
}: {
  onToggle?: (next: boolean) => void;
}) {
  const { fullscreen, toggleFullscreen } = useDocumentSidebar();
  const minMd = useMinMd();
  if (!minMd) return null;
  const Glyph = fullscreen ? IconArrowsDiagonalMinimize2 : IconArrowsDiagonal;
  return (
    <button
      type="button"
      aria-label={fullscreen ? "Exit fullscreen (show chat)" : "Fullscreen"}
      title={fullscreen ? "Show chat" : "Fullscreen"}
      onClick={() => {
        onToggle?.(!fullscreen);
        toggleFullscreen();
      }}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-black/[0.05] dark:text-neutral-400 dark:hover:bg-white/[0.06]"
    >
      <Glyph size={15} stroke={2} />
    </button>
  );
}

/** The shared header close button. */
export function CloseButton({
  onClose,
  label = "Close",
}: {
  onClose: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClose}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-black/[0.05] dark:text-neutral-400 dark:hover:bg-white/[0.06]"
    >
      <IconX size={13} stroke={2.5} />
    </button>
  );
}
