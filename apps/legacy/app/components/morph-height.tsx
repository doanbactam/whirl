import { useCallback, useRef, useState } from "react";
import { motion } from "motion/react";

/**
 * A wrapper that spring-animates to its content's natural height: a
 * ResizeObserver on the content feeds a motion-animated container, so
 * swapping the content (e.g. a modal's steps) resizes smoothly instead of
 * snapping.
 *
 * The measurement state lives in here, so a fresh mount always paints its
 * first frame at natural height — it can never flash a stale size from
 * whatever it showed last time. Callers rendering different "documents"
 * through one instance (a modal reused across listings) should pass a
 * `key` so each one starts fresh.
 */
export function MorphHeight({ children }: { children: React.ReactNode }) {
  const [height, setHeight] = useState<number | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const measureRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    // The observer fires once on observe(), so the first paint's "auto"
    // hands off to an identical pixel value without a visible jump.
    const observer = new ResizeObserver(() => setHeight(node.offsetHeight));
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  return (
    <motion.div
      animate={{ height: height ?? "auto" }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      className="overflow-hidden"
    >
      {/* `relative` anchors popLayout-exiting children during transitions. */}
      <div ref={measureRef} className="relative">
        {children}
      </div>
    </motion.div>
  );
}
