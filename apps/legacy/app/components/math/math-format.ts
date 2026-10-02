/** True when a result string is just a plain (optionally signed) decimal. */
export function isPlainNumber(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value.trim());
}

/**
 * Group a plain numeric result with thousands separators while preserving its
 * own decimal places (capped so 1/3 doesn't render 12 nines). Non-numeric
 * strings pass through untouched.
 */
export function prettyNumber(value: string): string {
  const trimmed = value.trim();
  if (!isPlainNumber(trimmed)) return trimmed;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return trimmed;
  const fraction = trimmed.split(".")[1] ?? "";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.min(fraction.length, 10),
  }).format(n);
}

/** Make a raw math expression readable as plain text (no LaTeX): ×, ÷, − . */
export function prettyExpression(expression: string): string {
  return expression
    .replace(/\s*\*\s*/g, " × ")
    .replace(/\s*\/\s*/g, " ÷ ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The short, readable summary shown on a "Calculated …" chip. Prefer the
 * model's label; otherwise the value count for a batch, or the formatted
 * result for a single calculation.
 */
export function calcChipSummary(phase: {
  label?: string;
  result?: string;
  items?: unknown[];
}) {
  const trimmedLabel = phase.label?.trim();
  if (trimmedLabel) return trimmedLabel;
  if (phase.items?.length) {
    return `${phase.items.length} value${phase.items.length === 1 ? "" : "s"}`;
  }
  return prettyNumber(phase.result ?? "");
}
