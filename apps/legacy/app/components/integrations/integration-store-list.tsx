import { IconChevronRight, IconCircleCheckFilled } from "@tabler/icons-react";
import { AnimatePresence, motion, type Variants } from "motion/react";

import {
  IntegrationLogo,
  VerifiedBadge,
} from "~/components/integrations/integration-logo";
import type { StoreIntegration } from "~/data/integrationStore";

const listStagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.03 } },
};

const listItem: Variants = {
  hidden: { opacity: 0, y: 4 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: [0.22, 0.61, 0.36, 1] },
  },
};

const trailingPop = {
  initial: { opacity: 0, scale: 0.5 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.5 },
  transition: { duration: 0.14, ease: [0.22, 0.61, 0.36, 1] as const },
};

/** The storefront grid: one tappable row per approved integration. */
export function IntegrationStoreList({
  integrations,
  onOpen,
}: {
  integrations: StoreIntegration[];
  onOpen: (integration: StoreIntegration) => void;
}) {
  return (
    <motion.ul
      variants={listStagger}
      initial="hidden"
      animate="show"
      className="relative grid gap-1 md:grid-cols-2"
    >
      {/* popLayout lets surviving rows glide into place as search filters. */}
      <AnimatePresence mode="popLayout" initial={false}>
        {integrations.map((integration) => (
          <motion.li
            layout
            variants={listItem}
            exit={{
              opacity: 0,
              scale: 0.96,
              transition: { duration: 0.15, ease: [0.22, 0.61, 0.36, 1] },
            }}
            key={integration.id}
          >
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              onClick={() => onOpen(integration)}
              className="group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
            >
              <IntegrationLogo
                name={integration.name}
                logoUrl={integration.logoUrl}
                iconSvg={integration.iconSvg}
                size={44}
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[14px] font-medium text-neutral-900 dark:text-neutral-100">
                    {integration.name}
                  </span>
                  {integration.verified && <VerifiedBadge size={14} />}
                </span>
                <span className="truncate text-[12.5px] text-neutral-500 dark:text-neutral-400">
                  {integration.description ?? "An MCP integration for Whirl"}
                </span>
              </span>
              <AnimatePresence mode="wait" initial={false}>
                {integration.installedConnected ? (
                  <motion.span
                    key="installed"
                    {...trailingPop}
                    title="Installed"
                    className="shrink-0 text-emerald-500"
                  >
                    <IconCircleCheckFilled size={18} aria-label="Installed" />
                  </motion.span>
                ) : integration.installedServerId ? (
                  <motion.span
                    key="pending"
                    {...trailingPop}
                    className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:bg-amber-400/15 dark:text-amber-400"
                  >
                    Finish setup
                  </motion.span>
                ) : (
                  <motion.span key="open" {...trailingPop} className="shrink-0">
                    <IconChevronRight
                      size={16}
                      stroke={2}
                      className="text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-neutral-500 dark:text-neutral-600 dark:group-hover:text-neutral-400"
                    />
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          </motion.li>
        ))}
      </AnimatePresence>
    </motion.ul>
  );
}
