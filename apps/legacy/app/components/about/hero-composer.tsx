import { useEffect, useState } from "react";
import { IconChevronRight, IconPlus } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";

import { stashComposerPrefill } from "~/lib/composer-prefill";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

/**
 * A lookalike of the app's home composer that doesn't chat at all: same glass
 * pill, same controls, but submitting stashes the prompt and hops to the real
 * composer at /, which picks it up pre-filled and focused.
 *
 * The styles are copied from ~/components/composer (COMPOSER_GLASS_SURFACE,
 * the +/send buttons, the placeholder rotation) rather than imported — pulling
 * that module in would drag the whole chat dependency tree into the SSR'd
 * marketing bundle. If the composer's look changes, update this to match.
 */

const GLASS_SURFACE =
  "border border-black/[0.05] bg-white/35 shadow-[0_3px_14px_rgba(0,0,0,0.05)] backdrop-blur-md backdrop-saturate-150 dark:border-white/[0.05] dark:bg-[#1E1E1E]/38 dark:shadow-[0_3px_16px_rgba(0,0,0,0.38)]";

const PLACEHOLDERS = [
  "Ask anything",
  "What's on your mind?",
  "Dream up something wild",
  "Throw me a curveball",
  "Whatcha thinking?",
  "Surprise me",
];

export function HeroComposer() {
  const navigate = useNavigate();
  const capture = useCapture();
  const [value, setValue] = useState("");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const hasText = value.trim().length > 0;

  useEffect(() => {
    if (value !== "") return;
    const id = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS.length);
    }, 5000);
    return () => clearInterval(id);
  }, [value]);

  const goToApp = () => {
    const prompt = value.trim();
    if (prompt) stashComposerPrefill(prompt);
    capture(ANALYTICS_EVENTS.aboutComposerSubmitted, {
      hasPrompt: prompt.length > 0,
      length: prompt.length,
    });
    navigate({ to: "/" });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        goToApp();
      }}
      className="w-full"
    >
      <label
        className={`relative flex w-full cursor-text flex-col rounded-[28px] ${GLASS_SURFACE}`}
      >
        <div className="flex w-full items-center p-1.5">
          <motion.button
            type="button"
            aria-label="Add"
            onClick={goToApp}
            whileTap={{ scale: 0.98 }}
            className="depth-neutral flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-600 dark:text-neutral-300"
          >
            <IconPlus size={16} stroke={2} />
          </motion.button>
          <div className="relative min-w-0 flex-1">
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label="Ask Whirl anything"
              className="h-11 w-full bg-transparent px-2.5 text-[17px] leading-6 text-neutral-900 outline-none dark:text-neutral-100"
            />
            {!hasText && (
              <AnimatePresence initial={false} mode="wait">
                <motion.span
                  key={placeholderIdx}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 truncate text-[17px] text-neutral-400 dark:text-neutral-500"
                >
                  {PLACEHOLDERS[placeholderIdx]}
                </motion.span>
              </AnimatePresence>
            )}
          </div>
          <motion.button
            type="submit"
            aria-label="Send"
            whileTap={{ scale: 0.98 }}
            className={`depth-neutral relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors duration-200 ${
              hasText ? "text-white" : "text-neutral-400 dark:text-neutral-500"
            }`}
          >
            <motion.span
              aria-hidden
              initial={false}
              animate={{ opacity: hasText ? 1 : 0 }}
              transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
              style={{
                backgroundImage:
                  "linear-gradient(180deg, #3a9efc 0%, #178dfb 50%, #0c82f2 100%)",
              }}
              className="pointer-events-none absolute inset-0 rounded-full"
            />
            <span className="relative flex">
              <IconChevronRight size={16} stroke={2.5} />
            </span>
          </motion.button>
        </div>
      </label>
    </form>
  );
}
