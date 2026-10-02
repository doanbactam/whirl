import { IconAlertTriangle } from "@tabler/icons-react";

import type { CalcItem, Phase } from "~/data/messages";
import { KatexFormula } from "./katex-formula";
import { isPlainNumber, prettyExpression, prettyNumber } from "./math-format";

type CalcPhase = Extract<Phase, { kind: "calc" }>;

/** Common shape of a single-calc phase and one batch item. */
type CalcLike = {
  expression?: string;
  result?: string;
  expressionTex?: string;
  resultTex?: string;
  needsLatex?: boolean;
  error?: string;
};

/** An expression in muted type: typeset when it benefits, plain (× ÷) else. */
function Expression({ calc }: { calc: CalcLike }) {
  if (!calc.expression) return null;
  if (calc.needsLatex && calc.expressionTex) {
    return (
      <span className="text-[15px] text-neutral-500 dark:text-neutral-400">
        <KatexFormula tex={calc.expressionTex} />
      </span>
    );
  }
  return (
    <span className="font-mono text-[13.5px] text-neutral-500 [overflow-wrap:anywhere] dark:text-neutral-400">
      {prettyExpression(calc.expression)}
    </span>
  );
}

/** A result value: grouped number, or typeset units/symbolic output. */
function ResultValue({
  calc,
  className,
}: {
  calc: CalcLike;
  className: string;
}) {
  const result = calc.result ?? "";
  if (!isPlainNumber(result) && calc.needsLatex && calc.resultTex) {
    return (
      <span className={className}>
        <KatexFormula tex={calc.resultTex} />
      </span>
    );
  }
  return <span className={className}>{prettyNumber(result)}</span>;
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 text-[14px] text-amber-700 dark:text-amber-400">
      <IconAlertTriangle
        size={16}
        stroke={2}
        className="mt-0.5 shrink-0"
      />
      <span className="[overflow-wrap:anywhere]">
        couldn&apos;t compute that ({message})
      </span>
    </div>
  );
}

/** One row of a batch: label + expression muted left, result bold right. */
function BatchRow({ item }: { item: CalcItem }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0">
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {item.label && (
          <span className="text-[13px] font-medium text-neutral-700 dark:text-neutral-200">
            {item.label}
          </span>
        )}
        <Expression calc={item} />
      </span>
      {item.error ? (
        <span
          className="shrink-0 text-[13px] text-amber-700 dark:text-amber-400"
          title={item.error}
        >
          error
        </span>
      ) : (
        <ResultValue
          calc={item}
          className="shrink-0 text-right text-[15px] font-semibold text-neutral-900 dark:text-neutral-50"
        />
      )}
    </div>
  );
}

/**
 * The expression + result (or error) stack shown when a "Calculated …" chip
 * is opened. Batch calculations render as a divided list of label/expression
 * → result rows instead of the single big result.
 */
export function CalcBody({ phase }: { phase: CalcPhase }) {
  if (phase.items?.length) {
    return (
      <div className="flex flex-col divide-y divide-black/[0.05] dark:divide-white/[0.06]">
        {phase.items.map((item, i) => (
          <BatchRow key={`${item.expression}-${i}`} item={item} />
        ))}
      </div>
    );
  }
  if (phase.error) {
    return <ErrorRow message={phase.error} />;
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="max-w-full overflow-x-auto">
        <Expression calc={phase} />
      </div>
      <ResultValue
        calc={phase}
        className="max-w-full overflow-x-auto text-[28px] font-semibold leading-tight tracking-[-0.02em] text-neutral-900 [overflow-wrap:anywhere] dark:text-neutral-50"
      />
    </div>
  );
}

/** Plain-text form of a calculation, for the copy button. */
export function calcCopyText(phase: CalcPhase): string {
  if (phase.items?.length) {
    return phase.items
      .map((item) =>
        [
          item.label ? `${item.label}: ` : "",
          item.expression,
          " = ",
          item.error ? `error (${item.error})` : item.result ?? "",
        ].join(""),
      )
      .join("\n");
  }
  return phase.result ?? "";
}

/** Heading for the detail modal: the model's label, or a sensible default. */
export function calcHeading(phase: CalcPhase): string {
  const label = phase.label?.trim();
  if (label) return label;
  if (phase.items?.length) {
    return `${phase.items.length} calculation${phase.items.length === 1 ? "" : "s"}`;
  }
  return "Calculation";
}
