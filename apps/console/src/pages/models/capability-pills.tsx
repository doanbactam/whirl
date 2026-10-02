import type { ModelCapabilities } from "~/lib/backend";

/**
 * A model's detected capabilities as a row of tiny pills, plus the context
 * window. Used by the models table and the form's detection preview.
 */
export function CapabilityPills({
  capabilities,
}: {
  capabilities: ModelCapabilities;
}) {
  const labels = [
    capabilities.vision ? "Vision" : null,
    capabilities.files ? "Files" : null,
    capabilities.audio ? "Audio" : null,
    capabilities.reasoning ? "Reasoning" : null,
    capabilities.tools ? "Tools" : null,
    capabilities.imageOutput ? "Image output" : null,
  ].filter((label): label is string => label !== null);

  return (
    <span className="flex flex-wrap items-center gap-1">
      {labels.length === 0 && (
        <span className="text-[11.5px] text-neutral-400 dark:text-neutral-500">
          Text only
        </span>
      )}
      {labels.map((label) => (
        <span
          key={label}
          className="rounded-full bg-black/[0.05] px-1.5 py-px text-[10.5px] font-medium text-neutral-600 dark:bg-white/[0.07] dark:text-neutral-300"
        >
          {label}
        </span>
      ))}
      {capabilities.contextLength > 0 && (
        <span className="rounded-full bg-black/[0.05] px-1.5 py-px text-[10.5px] font-medium text-neutral-600 dark:bg-white/[0.07] dark:text-neutral-300">
          {formatContext(capabilities.contextLength)} context
        </span>
      )}
    </span>
  );
}

export function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return `${tokens}`;
}
