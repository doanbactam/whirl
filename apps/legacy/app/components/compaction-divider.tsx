import { motion } from "motion/react";

export function CompactionDivider({ compactedAt }: { compactedAt?: number }) {
  const label = compactedAt
    ? `Conversation compacted · ${new Date(compactedAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })}`
    : "Conversation compacted";

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 0.61, 0.36, 1] }}
      className="flex items-center gap-3 py-1"
      role="separator"
      aria-label={label}
    >
      <span className="h-px min-w-0 flex-1 bg-black/[0.08] dark:bg-white/[0.1]" />
      <span className="shrink-0 text-[12px] text-neutral-500 dark:text-neutral-400">
        {label}
      </span>
      <span className="h-px min-w-0 flex-1 bg-black/[0.08] dark:bg-white/[0.1]" />
    </motion.div>
  );
}
