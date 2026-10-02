import { useEffect, useRef } from "react";

// Baseline clearance under the chat, matching the classic `pb-40` — the
// composer has to outgrow this before the clearance starts tracking it.
const MIN_CLEARANCE_PX = 160;
// Breathing room kept between the latest message and the composer's top edge,
// sized so the pills that float above the composer (free messages, server
// overload) still clear the chat.
const CLEARANCE_GAP_PX = 48;
// Only shift the scroll position when the reader is within this distance of
// the bottom — anyone further up is reading history and shouldn't be moved.
const PIN_DISTANCE_PX = 240;

/**
 * Bottom padding for a chat feed that sits under the floating composer. The
 * variable is written by {@link useComposerClearance}; the fallback keeps the
 * classic `pb-40` spacing until the first measurement lands.
 */
export const COMPOSER_CLEARANCE_CLASS =
  "pb-[var(--composer-clearance,10rem)]";

/**
 * Keeps a chat's bottom clearance tracking the floating composer's real
 * height, so a growing composer (multiline draft, attachment tray) shifts the
 * conversation up instead of covering the latest message.
 *
 * Attach `dockRef` to the composer's floating dock, `containerRef` to a shared
 * ancestor of the dock and the scrollable chat, and `viewportRef` to the
 * scrollable element itself; give the padded content element
 * {@link COMPOSER_CLEARANCE_CLASS}. While the reader is at or near the bottom,
 * their distance to the bottom is preserved across every clearance change, so
 * the latest message glides up with the composer (and back down as it shrinks)
 * instead of disappearing behind it.
 */
export function useComposerClearance() {
  const containerRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const dock = dockRef.current;
    if (!container || !dock) return;

    let prevClearance: number | null = null;
    const update = () => {
      const clearance = Math.max(
        MIN_CLEARANCE_PX,
        Math.ceil(dock.offsetHeight) + CLEARANCE_GAP_PX,
      );
      if (clearance === prevClearance) return;
      const changed = prevClearance !== null;
      prevClearance = clearance;

      // Measure against the old clearance before writing the new one.
      const viewport = viewportRef.current;
      const distanceToBottom = viewport
        ? viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
        : Infinity;

      container.style.setProperty("--composer-clearance", `${clearance}px`);

      if (viewport && changed && distanceToBottom <= PIN_DISTANCE_PX) {
        // Re-reading scrollHeight after the style write reflects the new
        // clearance; restoring the old distance-to-bottom shifts the view by
        // exactly the clearance delta.
        viewport.scrollTop =
          viewport.scrollHeight - viewport.clientHeight - distanceToBottom;
      }
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(dock);
    return () => {
      observer.disconnect();
      container.style.removeProperty("--composer-clearance");
    };
  }, []);

  return { containerRef, dockRef, viewportRef };
}
