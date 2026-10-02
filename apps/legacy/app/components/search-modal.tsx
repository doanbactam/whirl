import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { IconSearch, IconX } from "@tabler/icons-react";

import { ModalCard } from "~/components/modal-card";
import { groupThreads, useThreads, type Thread } from "~/data/threads";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (thread: Thread) => void;
};

function highlight(text: string, query: string) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="bg-[#0c82f2]/15 text-[#0c82f2] dark:bg-[#0c82f2]/20">
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}

export function SearchModal({ open, onClose, onSelect }: Props) {
  const threads = useThreads();
  const capture = useCapture();
  const [query, setQuery] = useState("");
  // Filter on the live query — no debounce, results update as you type.
  const trimmedQuery = query.trim();
  const [activeIndex, setActiveIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // The list scroller animates to fit its content (capped at the same
  // min(60vh,420px) ceiling it scrolls past), so the modal grows and shrinks
  // smoothly as results come and go instead of snapping.
  const [listHeight, setListHeight] = useState<number>();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    if (!trimmedQuery) return threads;
    const q = trimmedQuery.toLowerCase();
    return threads.filter((t) => t.title.toLowerCase().includes(q));
  }, [trimmedQuery, threads]);

  const grouped = useMemo(() => groupThreads(filtered), [filtered]);

  useEffect(() => {
    setActiveIndex(0);
  }, [trimmedQuery]);

  // Measure the rendered results and drive the scroller's height. Measuring in
  // a layout effect keeps the first frame correct (no snap), and the
  // ResizeObserver catches every result change so the spring always has a fresh
  // target.
  useLayoutEffect(() => {
    if (!open) return;
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      const max = Math.min(window.innerHeight * 0.6, 420);
      setListHeight(Math.min(content.offsetHeight, max));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`,
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const selectThread = (
    thread: Thread,
    via: "keyboard" | "click",
    index: number,
  ) => {
    capture(ANALYTICS_EVENTS.searchResultSelected, {
      via,
      result_index: index,
      result_count: filtered.length,
      query_length: trimmedQuery.length,
      had_query: trimmedQuery.length > 0,
    });
    onSelect(thread);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = filtered[activeIndex];
      if (target) selectThread(target, "keyboard", activeIndex);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="search-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[12vh] backdrop-blur-[6px] dark:bg-black/50"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            key="search-modal"
            initial={{ opacity: 0, y: -8, scale: 0.97, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -4, scale: 0.98, filter: "blur(4px)" }}
            transition={{
              opacity: { duration: 0.18 },
              filter: { duration: 0.2 },
              y: { type: "spring", stiffness: 360, damping: 30 },
              scale: { type: "spring", stiffness: 360, damping: 30 },
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Search threads"
            className="w-full max-w-xl"
          >
            <ModalCard>
            <div className="flex h-12 items-center gap-2.5 border-b border-black/[0.06] px-3.5 dark:border-white/[0.06]">
              <IconSearch
                size={16}
                stroke={2}
                className="shrink-0 text-neutral-400 dark:text-neutral-500"
              />
              <input
                ref={inputRef}
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Search threads"
                className="flex-1 bg-transparent text-[14px] text-neutral-900 placeholder:text-neutral-400 focus:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-500"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-black/[0.05] dark:text-neutral-400 dark:hover:bg-white/[0.06]"
                >
                  <IconX size={12} stroke={2.5} />
                </button>
              )}
              <kbd className="hidden shrink-0 rounded-md border border-black/[0.08] px-1.5 py-0.5 text-[10.5px] font-medium text-neutral-400 dark:border-white/[0.08] dark:text-neutral-500 sm:inline-block">
                ESC
              </kbd>
            </div>

            <motion.div
              ref={listRef}
              initial={false}
              animate={listHeight != null ? { height: listHeight } : undefined}
              transition={{ type: "spring", stiffness: 380, damping: 34 }}
              className="overflow-y-auto"
              style={{ maxHeight: "min(60vh, 420px)" }}
            >
              <div ref={contentRef} className="px-1.5 py-1.5">
              <AnimatePresence mode="popLayout" initial={false}>
                {filtered.length === 0 ? (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -2 }}
                    transition={{ duration: 0.18 }}
                    className="flex flex-col items-center gap-1 px-4 py-12 text-center"
                  >
                    <span className="text-[13px] font-medium text-neutral-700 dark:text-neutral-200">
                      No threads found
                    </span>
                    <span className="text-[12px] text-neutral-500 dark:text-neutral-400">
                      Try a different search
                    </span>
                  </motion.div>
                ) : (
                  <motion.div
                    key="results"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -2 }}
                    transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
                    className="flex flex-col gap-3 py-1"
                  >
                    {(() => {
                      let runningIndex = -1;
                      return grouped.map(([group, items]) => (
                        <div key={group} className="flex flex-col">
                          <span className="flex h-6 items-center px-2.5 text-[11px] font-medium tracking-wide text-neutral-400 dark:text-neutral-500">
                            {group}
                          </span>
                          {items.map((t) => {
                            runningIndex += 1;
                            const index = runningIndex;
                            const active = index === activeIndex;
                            return (
                              <button
                                key={t.id}
                                type="button"
                                data-index={index}
                                onMouseEnter={() => setActiveIndex(index)}
                                onClick={() => selectThread(t, "click", index)}
                                className={`flex h-9 w-full items-center rounded-lg px-2.5 text-left text-[13px] transition-colors ${
                                  active
                                    ? "bg-black/[0.05] text-neutral-900 dark:bg-white/[0.07] dark:text-neutral-100"
                                    : "text-neutral-700 dark:text-neutral-300"
                                }`}
                              >
                                <IconSearch
                                  size={13}
                                  stroke={2}
                                  className={`mr-2.5 shrink-0 ${
                                    active
                                      ? "text-neutral-500 dark:text-neutral-400"
                                      : "text-neutral-400 dark:text-neutral-500"
                                  }`}
                                />
                                {t.titleStatus === "generating" ? (
                                  <span
                                    aria-label="Generating title"
                                    className="relative inline-flex h-3.5 w-40 overflow-hidden rounded-md bg-black/[0.06] dark:bg-white/[0.06]"
                                  >
                                    <span
                                      aria-hidden
                                      className="absolute inset-0 animate-rainbow bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.55)_50%,transparent_100%)] bg-[length:200%_100%] dark:bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.18)_50%,transparent_100%)]"
                                    />
                                  </span>
                                ) : (
                                  <span className="truncate">
                                    {highlight(t.title, trimmedQuery)}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      ));
                    })()}
                  </motion.div>
                )}
              </AnimatePresence>
              </div>
            </motion.div>

            <div className="flex items-center justify-between gap-4 border-t border-black/[0.06] px-3.5 py-2 text-[11px] text-neutral-500 dark:border-white/[0.06] dark:text-neutral-400">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="rounded-md border border-black/[0.08] px-1 py-0.5 text-[10px] dark:border-white/[0.08]">
                    ↑
                  </kbd>
                  <kbd className="rounded-md border border-black/[0.08] px-1 py-0.5 text-[10px] dark:border-white/[0.08]">
                    ↓
                  </kbd>
                  to navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded-md border border-black/[0.08] px-1 py-0.5 text-[10px] dark:border-white/[0.08]">
                    ↵
                  </kbd>
                  to open
                </span>
              </div>
              <span>
                {filtered.length} result{filtered.length === 1 ? "" : "s"}
              </span>
            </div>
            </ModalCard>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
