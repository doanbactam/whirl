import { useState } from "react";
import { IconCheck, IconTrash } from "@tabler/icons-react";
import { AnimatePresence, motion, type Variants } from "motion/react";

import { ConfirmDialog } from "~/components/confirm-dialog";
import {
  IntegrationLogo,
  VerifiedBadge,
} from "~/components/integrations/integration-logo";
import { Switch } from "~/components/memory-settings";
import type { InstalledSkill } from "~/data/skillStore";

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

/** The manage tab's skills section: every install with its toggle and delete. */
export function InstalledSkillsList({
  installed,
  onToggle,
  onUninstall,
}: {
  installed: InstalledSkill[];
  onToggle: (item: InstalledSkill, enabled: boolean) => void;
  onUninstall: (item: InstalledSkill) => void;
}) {
  // The row pending its "are you sure?" — one dialog serves the whole list.
  const [confirming, setConfirming] = useState<InstalledSkill | null>(null);

  return (
    <>
      <motion.ul
        variants={listStagger}
        initial="hidden"
        animate="show"
        className="relative flex flex-col gap-1"
      >
        {/* popLayout so neighbors glide up when a row is uninstalled. */}
        <AnimatePresence mode="popLayout" initial={false}>
          {installed.map((item) => (
            <InstalledRow
              key={item.installId}
              item={item}
              onToggle={(enabled) => onToggle(item, enabled)}
              onUninstall={() => setConfirming(item)}
            />
          ))}
        </AnimatePresence>
      </motion.ul>

      <ConfirmDialog
        open={confirming !== null}
        title={`Uninstall ${confirming?.name ?? "this skill"}?`}
        message="Whirl forgets how to do this. You can always reinstall it from the store."
        confirmLabel="Uninstall"
        tone="danger"
        onConfirm={() => {
          if (confirming) onUninstall(confirming);
          setConfirming(null);
        }}
        onCancel={() => setConfirming(null)}
      />
    </>
  );
}

function InstalledRow({
  item,
  onToggle,
  onUninstall,
}: {
  item: InstalledSkill;
  onToggle: (enabled: boolean) => void;
  onUninstall: () => void;
}) {
  const status = {
    text: item.enabled ? "Ready to use" : "Paused",
    className: item.enabled
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-neutral-400 dark:text-neutral-500",
  };

  return (
    <motion.li
      layout
      variants={listItem}
      exit={{
        opacity: 0,
        scale: 0.96,
        transition: { duration: 0.15, ease: [0.22, 0.61, 0.36, 1] },
      }}
      className="group/row flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
    >
      <IntegrationLogo
        name={item.name}
        logoUrl={item.logoUrl}
        iconSvg={item.iconSvg}
        size={44}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13.5px] font-medium text-neutral-900 dark:text-neutral-100">
            {item.name}
          </span>
          {item.verified && <VerifiedBadge size={13} />}
        </span>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={`${status.text}-${status.className}`}
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: 0.13, ease: [0.22, 0.61, 0.36, 1] }}
            className={`flex items-center gap-1 text-[11.5px] ${status.className}`}
          >
            <IconCheck size={12} stroke={2} />
            <span className="truncate">{status.text}</span>
          </motion.span>
        </AnimatePresence>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <motion.button
          type="button"
          whileTap={{ scale: 0.92 }}
          aria-label={`Uninstall ${item.name}`}
          onClick={onUninstall}
          className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 opacity-0 transition hover:bg-red-500/[0.08] hover:text-red-600 focus-visible:opacity-100 group-hover/row:opacity-100 dark:text-neutral-400 dark:hover:bg-red-400/[0.1] dark:hover:text-red-300 max-md:opacity-100"
        >
          <IconTrash size={14} stroke={2} />
        </motion.button>
        <span className="ml-1">
          <Switch checked={item.enabled} onChange={onToggle} />
        </span>
      </div>
    </motion.li>
  );
}
