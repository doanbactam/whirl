import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { animate, motion, useMotionValue } from "motion/react";

/**
 * A shared hover pill: one soft background pill per region that fades in on a
 * fresh hover and hops instantly between rows (no trailing). Born on the
 * about-site nav, shared with the app sidebar.
 *
 * The pill is a single persistent element (HoverPillOverlay) rendered once
 * inside the region's positioned container. Rows report mouse enter/leave with
 * their DOM node; the overlay measures the node against its offsetParent and
 * snaps over. No layoutId, no per-row mount/unmount — fast sweeps across rows
 * just move one element instead of stacking AnimatePresence crossfades, which
 * is what flickered inside the sidebar's Reorder/scroll/transform soup.
 */

export type HoverPillTarget = { key: string; el: HTMLElement };

export type HoverPill = {
  /** A row was entered: show the pill over `el`. */
  onHover: (key: string, el: HTMLElement) => void;
  /** A row was left (or wants the pill gone) — hides only if still current.
   *  Hiding waits out a short grace period so sweeping across gaps between
   *  rows doesn't dip the pill; pass `immediate` when the row is going away
   *  for real (drag, drop highlight, unmount). */
  onLeave: (key: string, immediate?: boolean) => void;
  getTarget: () => HoverPillTarget | null;
  subscribe: (onChange: () => void) => () => void;
};

/** One pill per region. The store is stable, so hovering re-renders only the
 *  overlay — never the rows or the component that owns the pill. */
export function useHoverPill(): HoverPill {
  const [pill] = useState(createHoverPill);
  return pill;
}

/** How long a leave waits before hiding — long enough to cross the gaps and
 *  group headers between rows mid-sweep, short enough that a real exit still
 *  feels immediate. */
const HIDE_GRACE_MS = 120;

function createHoverPill(): HoverPill {
  let target: HoverPillTarget | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const cancelHide = () => {
    if (hideTimer == null) return;
    clearTimeout(hideTimer);
    hideTimer = null;
  };
  const hide = (key: string) => {
    if (target?.key !== key) return;
    target = null;
    emit();
  };
  return {
    onHover(key, el) {
      cancelHide();
      target = { key, el };
      emit();
    },
    onLeave(key, immediate = false) {
      if (target?.key !== key) return;
      cancelHide();
      if (immediate) {
        hide(key);
        return;
      }
      hideTimer = setTimeout(() => {
        hideTimer = null;
        hide(key);
      }, HIDE_GRACE_MS);
    },
    getTarget: () => target,
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
}

const HoverPillContext = createContext<HoverPill | null>(null);

/** Shares one pill across a whole region (e.g. the app sidebar) so deeply
 *  nested rows — folders, thread rows — can join without prop-drilling. */
export function HoverPillProvider({
  pill,
  children,
}: {
  pill: HoverPill;
  children: ReactNode;
}) {
  return (
    <HoverPillContext.Provider value={pill}>
      {children}
    </HoverPillContext.Provider>
  );
}

/** The nearest shared pill, or null when the row renders outside any provider
 *  (rows should keep their plain CSS hover then). */
export function useHoverPillContext(): HoverPill | null {
  return useContext(HoverPillContext);
}

const POP_SPRING = { type: "spring", stiffness: 480, damping: 34 } as const;
const FADE = { duration: 0.15, ease: [0.22, 0.61, 0.36, 1] } as const;

/**
 * The pill itself. Render exactly one as a direct child of the region's
 * positioned container (that container is what it measures rows against, and
 * inside a scroll container it rides along with the content). Rows paint above
 * it as long as they're positioned, which they all are.
 */
export function HoverPillOverlay({
  pill,
  fillClassName = "bg-black/[0.05] dark:bg-white/[0.07]",
  radius = 9999,
  pressScale = 0.94,
}: {
  pill: HoverPill;
  /** Fill of the pill; defaults to the about-nav wash. */
  fillClassName?: string;
  radius?: number;
  /** How far the pill squishes while its row is pressed. */
  pressScale?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const target = useSyncExternalStore(
    pill.subscribe,
    pill.getTarget,
    () => null,
  );
  const el = target?.el ?? null;

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const width = useMotionValue(0);
  const height = useMotionValue(0);
  const opacity = useMotionValue(0);
  const scale = useMotionValue(1);

  useEffect(() => {
    if (!el || !el.isConnected) {
      animate(opacity, 0, FADE);
      return;
    }
    const container = ref.current?.offsetParent;
    if (!(container instanceof HTMLElement)) return;
    const containerRect = container.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    x.jump(rect.left - containerRect.left + container.scrollLeft);
    y.jump(rect.top - containerRect.top + container.scrollTop);
    width.jump(rect.width);
    height.jump(rect.height);
    // Position always snaps — no trailing between rows. The scale-in pop only
    // happens when the pill materializes from nothing ("fresh" is simply "the
    // pill isn't visible right now"; crossing rows leaves it mid-fade, which
    // still counts as visible).
    if (opacity.get() < 0.1) scale.jump(0.8);
    animate(scale, 1, POP_SPRING);
    animate(opacity, 1, FADE);
  }, [el, x, y, width, height, opacity, scale]);

  // Squish while the hovered row is pressed (the old group-active feel — but
  // the pill is no longer a descendant of the row, so listen directly).
  useEffect(() => {
    if (!el) return;
    const press = (e: PointerEvent) => {
      if (e.button === 0) animate(scale, pressScale, POP_SPRING);
    };
    const release = () => animate(scale, 1, POP_SPRING);
    el.addEventListener("pointerdown", press);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      el.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [el, pressScale, scale]);

  return (
    <motion.span
      ref={ref}
      aria-hidden
      style={{ x, y, width, height, opacity, scale, borderRadius: radius }}
      className={`pointer-events-none absolute left-0 top-0 ${fillClassName}`}
    />
  );
}
