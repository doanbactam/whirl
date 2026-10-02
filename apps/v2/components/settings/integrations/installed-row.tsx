"use client";

import {
  IconAlertTriangle,
  IconAlertTriangleFilled,
  IconCheck,
  type Icon,
} from "@tabler/icons-react";
import { AnimatePresence, motion, type Variants } from "motion/react";

import { IntegrationLogo } from "@/components/integration-logo";
import { ToggleSwitch } from "@/components/toggle-switch";
import { Skeleton } from "@/components/ui/skeleton";
import { VerifiedBadge } from "@/components/integrations/verified-badge";
import {
  canReconnect,
  needsSignIn,
  type InstalledIntegration,
} from "@/lib/integrations-data";

/* The shared row for everything the user has installed or written —
   integrations, store skills, custom skills. Branding + an animated status
   line on the left, the caller's actions plus the toggle pinned right.
   Rendered inside a SettingsCard, so rows draw dividers, not borders. */

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

export type RowStatus = {
  icon: Icon;
  text: string;
  className: string;
};

/** The plain ready/paused pair — skills and anything else without auth. */
export function enabledStatus(enabled: boolean): RowStatus {
  return {
    icon: IconCheck,
    text: enabled ? "Ready to use" : "Paused",
    className: enabled
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-muted-foreground",
  };
}

/** An integration install's status line: errors, owed sign-ins, or ready. */
export function integrationStatus(item: InstalledIntegration): RowStatus {
  /* Expired beats every other line, including whatever raw error came back
     with it. "Your sign-in ran out" is the actionable half; the provider's
     wording underneath it is not. */
  if (item.needsReauth) {
    return {
      icon: IconAlertTriangleFilled,
      text: canReconnect(item)
        ? "Sign-in expired — reconnect to keep using this"
        : "Credentials stopped working — reinstall with fresh keys",
      className: "text-destructive",
    };
  }
  if (item.lastError) {
    return {
      icon: IconAlertTriangle,
      text: item.lastError,
      className: "text-destructive",
    };
  }
  if (needsSignIn(item)) {
    return {
      icon: IconAlertTriangle,
      text: "Not connected yet",
      className: "text-amber-600 dark:text-amber-400",
    };
  }
  return enabledStatus(item.enabled);
}

/** First-visit bones for a card's rows, matching InstalledRow's spacing. */
export function RowSkeletons({ rows = 2 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="size-10 rounded-xl" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-44 max-w-full" />
          </div>
        </div>
      ))}
    </>
  );
}

/** The list shell: staggers rows in, glides neighbors up on removal. */
export function InstalledRowsList({ children }: { children: React.ReactNode }) {
  return (
    <motion.ul
      variants={listStagger}
      initial="hidden"
      animate="show"
      className="relative flex flex-col divide-y divide-border"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {children}
      </AnimatePresence>
    </motion.ul>
  );
}

export function InstalledRow({
  name,
  verified = false,
  logoUrl = null,
  iconSvg,
  logo,
  status,
  enabled,
  onToggle,
  action,
  children,
}: {
  name: string;
  verified?: boolean;
  logoUrl?: string | null;
  iconSvg?: string;
  /** Overrides the IntegrationLogo — custom skills have no branding. */
  logo?: React.ReactNode;
  status: RowStatus;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  /** Extra controls between the copy and the toggle (connect, edit, trash). */
  action?: React.ReactNode;
  /** Room under the row — the edit form unfolds here. */
  children?: React.ReactNode;
}) {
  return (
    <motion.li
      layout
      variants={listItem}
      exit={{
        opacity: 0,
        scale: 0.96,
        transition: { duration: 0.15, ease: [0.22, 0.61, 0.36, 1] },
      }}
      className="group/row px-4 py-3.5"
    >
      <div className="flex items-center gap-3">
        {logo ?? (
          <IntegrationLogo
            name={name}
            logoUrl={logoUrl}
            iconSvg={iconSvg}
            size={40}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13.5px] font-medium">{name}</span>
            {verified && <VerifiedBadge size={13} />}
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
              <status.icon size={12} stroke={2} className="shrink-0" />
              <span className="truncate">{status.text}</span>
            </motion.span>
          </AnimatePresence>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {action}
          <span className="ml-1">
            <ToggleSwitch
              checked={enabled}
              onCheckedChange={onToggle}
              aria-label={`${enabled ? "Pause" : "Resume"} ${name}`}
            />
          </span>
        </div>
      </div>
      {children && <div className="mt-3">{children}</div>}
    </motion.li>
  );
}
