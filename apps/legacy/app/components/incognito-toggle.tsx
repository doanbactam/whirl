import { AnimatePresence, motion } from "motion/react";
import { IconGhost2, IconGhost2Filled } from "@tabler/icons-react";

import { COMPOSER_GLASS_CONTROL } from "~/components/composer";
import { useIncognito } from "~/lib/incognito";
import { pinRasterPath } from "~/lib/motion";

/**
 * The ghost toggle that floats in the top-right of the new-thread page. Off, it
 * slips into incognito; on, it asks to leave (which warns before deleting the
 * ephemeral chat). Filled + tinted while active so the mode reads at a glance.
 */
export function IncognitoToggle() {
  const { enabled, enter, requestExit } = useIncognito();

  return (
    <motion.button
      type="button"
      onClick={() => (enabled ? requestExit() : enter())}
      whileTap={{ scale: 0.94 }}
      aria-pressed={enabled}
      aria-label={enabled ? "Leave incognito mode" : "Go incognito"}
      title={enabled ? "Leave incognito" : "Go incognito"}
      className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
        enabled
          ? "border border-[#0c82f2]/30 bg-[#0c82f2]/[0.12] text-[#0c82f2] hover:bg-[#0c82f2]/[0.18] dark:bg-[#0c82f2]/[0.16]"
          : `text-neutral-600 dark:text-neutral-300 ${COMPOSER_GLASS_CONTROL}`
      }`}
    >
      {/* Crossfade in place (no mode="wait") — the ghosts occupy the same
          fixed box, and waiting out the exit made the toggle feel laggy. */}
      <span className="relative h-[18px] w-[18px]">
        <AnimatePresence initial={false}>
          <motion.span
            key={enabled ? "on" : "off"}
            initial={{ opacity: 0, scale: 0.6, rotate: -12 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.6, rotate: 12 }}
            transition={{ type: "spring", stiffness: 520, damping: 28 }}
            transformTemplate={pinRasterPath}
            className="absolute inset-0 flex items-center justify-center"
          >
            {enabled ? (
              <IconGhost2Filled size={18} stroke={2} />
            ) : (
              <IconGhost2 size={18} stroke={2} />
            )}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.button>
  );
}
