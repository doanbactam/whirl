import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAction } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { AnimatePresence, motion } from "motion/react";
import { IconBug, IconBulbFilled, type TablerIcon } from "@tabler/icons-react";

import { ModalCard } from "~/components/modal-card";
import { Spinner } from "~/components/spinner";
import { showToast } from "~/data/toasts";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

type FeedbackKind = "feature" | "bug";

const submitFeedbackRef = makeFunctionReference<"action">("feedback:submit");

const KINDS: {
  value: FeedbackKind;
  label: string;
  icon: TablerIcon;
  placeholder: string;
}[] = [
  {
    value: "feature",
    label: "Feature request",
    icon: IconBulbFilled,
    placeholder: "What would make Whirl better?",
  },
  {
    value: "bug",
    label: "Bug report",
    icon: IconBug,
    placeholder: "What went wrong? Steps to reproduce help a lot.",
  },
];

const MAX_CHARS = 10_000;

export function FeedbackModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<FeedbackKind>("feature");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submitFeedback = useAction(submitFeedbackRef);
  const capture = useCapture();

  useEffect(() => setMounted(true), []);

  // Fresh slate every time the modal opens.
  useEffect(() => {
    if (open) {
      setKind("feature");
      setContent("");
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(id);
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

  const activeKind = KINDS.find((k) => k.value === kind) ?? KINDS[0];
  const trimmed = content.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await submitFeedback({
        kind,
        content: trimmed.slice(0, MAX_CHARS),
        sourceUrl:
          typeof window !== "undefined" ? window.location.href : undefined,
      });
      capture(ANALYTICS_EVENTS.feedbackSubmitted, {
        kind,
        length: trimmed.length,
      });
      showToast({
        message:
          kind === "bug"
            ? "Thanks for the bug report — we're on it."
            : "Thanks for the idea — noted.",
        tone: "success",
      });
      onClose();
    } catch (err) {
      capture(ANALYTICS_EVENTS.feedbackFailed, { kind });
      showToast({
        message:
          err instanceof Error
            ? err.message
            : "Couldn't send your feedback. Try again?",
        tone: "danger",
      });
      setSubmitting(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="feedback-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }}
          className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 px-4 pt-[18vh] backdrop-blur-[6px] dark:bg-black/50"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !submitting) onClose();
          }}
        >
          <motion.div
            key="feedback-modal"
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
            aria-label="Send feedback"
            className="w-full max-w-md"
          >
            <ModalCard>
            <div className="flex flex-col gap-3 p-4">
              <div className="flex flex-col gap-1">
                <span className="text-[14px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                  Send feedback
                </span>
                <span className="text-[12px] text-neutral-500 dark:text-neutral-400">
                  Got an idea or hit a snag? We read every one.
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-black/[0.04] p-1 dark:bg-white/[0.05]">
                {KINDS.map((k) => {
                  const active = k.value === kind;
                  const Glyph = k.icon;
                  return (
                    <button
                      key={k.value}
                      type="button"
                      onClick={() => setKind(k.value)}
                      className={`flex h-9 items-center justify-center gap-2 rounded-lg text-[13px] font-medium transition ${
                        active
                          ? "bg-white text-neutral-900 shadow-sm dark:bg-[#2c2c2c] dark:text-neutral-100"
                          : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                      }`}
                    >
                      <Glyph size={15} stroke={2} />
                      {k.label}
                    </button>
                  );
                })}
              </div>

              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value.slice(0, MAX_CHARS))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                rows={5}
                placeholder={activeKind.placeholder}
                className="resize-none rounded-lg border border-black/[0.08] bg-transparent px-3 py-2.5 text-[14px] leading-relaxed text-neutral-900 placeholder:text-neutral-400 focus:border-[#178dfb] focus:outline-none focus:ring-2 focus:ring-[#178dfb]/30 dark:border-white/[0.08] dark:text-neutral-100 dark:placeholder:text-neutral-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-black/[0.06] bg-black/[0.02] px-4 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.02]">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="h-8 rounded-md px-3 text-[13px] font-medium text-neutral-600 hover:bg-black/[0.05] disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-white/[0.06]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSubmit}
                className="inline-flex h-8 min-w-[88px] items-center justify-center gap-2 rounded-md bg-[#0c82f2] px-3 text-[13px] font-medium text-white hover:bg-[#0a74d8] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? (
                  <Spinner size={14} className="text-white" />
                ) : (
                  "Send"
                )}
              </button>
            </div>
            </ModalCard>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
