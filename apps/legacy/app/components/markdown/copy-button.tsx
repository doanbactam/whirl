import { useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";

/**
 * tiny copy-to-clipboard button shared by code blocks + tables.
 * set `label={false}` for a compact icon-only chip.
 */
export function CopyButton({
  getText,
  className,
  label = true,
}: {
  getText: () => string;
  className?: string;
  label?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const Glyph = copied ? IconCheck : IconCopy;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(getText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "Copied" : "Copy"}
      className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-neutral-500 transition-colors hover:bg-black/[0.06] hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-white/[0.08] dark:hover:text-neutral-200 ${className ?? ""}`}
    >
      <Glyph size={12} stroke={2} />
      {label && (copied ? "copied" : "copy")}
    </button>
  );
}
