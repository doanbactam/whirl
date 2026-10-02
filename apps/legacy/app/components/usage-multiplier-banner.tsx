import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconSparkles, IconX } from "@tabler/icons-react";

import {
  dismissMultiplierBanner,
  isMultiplierBannerDismissed,
  useActiveMultiplier,
  type ActiveMultiplier,
} from "~/lib/admin";

/**
 * Thin, dismissible bar shown at the very top of the app while an admin-
 * configured usage-multiplier event is active. Renders nothing when no event is
 * running or the user has dismissed the current one (persisted in localStorage,
 * keyed by the event window so a new event re-shows).
 */
export function UsageMultiplierBanner() {
  const event = useActiveMultiplier();
  const [dismissed, setDismissed] = useState(false);

  // Recompute dismissal whenever the active event changes (new window => new
  // key => may be undismissed again).
  useEffect(() => {
    if (!event) {
      setDismissed(false);
      return;
    }
    setDismissed(isMultiplierBannerDismissed(event));
  }, [event?.expiresAt, event?.headline]);

  const show = Boolean(event && event.headline && !dismissed);

  return (
    <AnimatePresence initial={false}>
      {show && event && (
        <motion.div
          key="usage-multiplier-banner"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 0.61, 0.36, 1] }}
          className="shrink-0 overflow-hidden"
        >
          <div className="flex items-center justify-center gap-2 bg-gradient-to-r from-[#0c82f2] to-[#0a6fd0] px-4 py-2 text-white">
            <IconSparkles
              size={15}
              stroke={2}
              className="shrink-0 opacity-90"
            />
            <p className="min-w-0 truncate text-center text-[13px]">
              <span className="font-semibold">{event.headline}</span>
              {event.subtext ? (
                <span className="ml-2 opacity-90">{event.subtext}</span>
              ) : null}
            </p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => {
                dismissMultiplierBanner(event as ActiveMultiplier);
                setDismissed(true);
              }}
              className="ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white/80 transition hover:bg-white/15 hover:text-white"
            >
              <IconX size={14} stroke={2} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
