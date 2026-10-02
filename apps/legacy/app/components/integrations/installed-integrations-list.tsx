import { useState } from "react";
import {
  IconAlertTriangle,
  IconCheck,
  IconPlug,
  IconTrash,
} from "@tabler/icons-react";
import { AnimatePresence, motion, type Variants } from "motion/react";

import { ConfirmDialog } from "~/components/confirm-dialog";
import {
  IntegrationLogo,
  VerifiedBadge,
} from "~/components/integrations/integration-logo";
import { Switch } from "~/components/memory-settings";
import type { InstalledIntegration } from "~/data/integrationStore";

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

/** The manage tab: every install with its toggle, connect, and delete. */
export function InstalledIntegrationsList({
  installed,
  onToggle,
  onConnect,
  onUninstall,
}: {
  installed: InstalledIntegration[];
  onToggle: (item: InstalledIntegration, enabled: boolean) => void;
  onConnect: (item: InstalledIntegration) => void;
  onUninstall: (item: InstalledIntegration) => void;
}) {
  // The row pending its "are you sure?" — one dialog serves the whole list.
  const [confirming, setConfirming] = useState<InstalledIntegration | null>(
    null,
  );

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
              key={item.serverId}
              item={item}
              onToggle={(enabled) => onToggle(item, enabled)}
              onConnect={() => onConnect(item)}
              onUninstall={() => setConfirming(item)}
            />
          ))}
        </AnimatePresence>
      </motion.ul>

      <ConfirmDialog
        open={confirming !== null}
        title={`Uninstall ${confirming?.name ?? "this integration"}?`}
        message="Whirl loses its tools, and any sign-in or keys go with it. You can always reinstall it from the store."
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
  onConnect,
  onUninstall,
}: {
  item: InstalledIntegration;
  onToggle: (enabled: boolean) => void;
  onConnect: () => void;
  onUninstall: () => void;
}) {
  const needsConnect =
    (item.authMode === "oauth" && !item.oauthConnected) ||
    (item.composioConnect && !item.composioConnected);
  const status = item.lastError
    ? {
        icon: IconAlertTriangle,
        text: item.lastError,
        className: "text-red-600 dark:text-red-300",
      }
    : needsConnect
      ? {
          icon: IconAlertTriangle,
          text: "Not connected yet",
          className: "text-amber-600 dark:text-amber-400",
        }
      : {
          icon: IconCheck,
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
            <status.icon size={12} stroke={2} />
            <span className="truncate">{status.text}</span>
          </motion.span>
        </AnimatePresence>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {needsConnect && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={onConnect}
            className="mr-1 inline-flex h-7 items-center gap-1.5 rounded-md bg-blue-500/10 px-2.5 text-[12px] font-medium text-blue-600 transition hover:bg-blue-500/15 dark:bg-blue-400/15 dark:text-blue-300 dark:hover:bg-blue-400/20"
          >
            <IconPlug size={13} stroke={2} />
            Connect
          </motion.button>
        )}
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
