import { jsonSchema, tool } from "ai";
import { all, create } from "mathjs";

// A locked-down mathjs instance. `import` and `createUnit` can mutate the
// instance's global state, so we stub them out; everything else (algebra,
// calculus, units, statistics, big numbers) stays available for the model.
const math = create(all, {});
math.import(
  {
    import: function disabledImport() {
      throw new Error("import is disabled");
    },
    createUnit: function disabledCreateUnit() {
      throw new Error("createUnit is disabled");
    },
  },
  { override: true },
);

// Hard caps so a prompt-injected or runaway call can't wedge the action.
const MAX_EXPRESSION_LENGTH = 1000;
const MAX_BATCH_ITEMS = 100;

/** One evaluated expression — the unit both tools and the UI share. */
export type CalcItem = {
  expression: string;
  result?: string;
  label?: string;
  expressionTex?: string;
  resultTex?: string;
  needsLatex?: boolean;
  error?: string;
};

/** What gets persisted onto the assistant message's calc phase. */
export type CalcPhasePayload = {
  callIdx: number;
  label?: string;
  expression?: string;
  result?: string;
  needsLatex?: boolean;
  expressionTex?: string;
  resultTex?: string;
  error?: string;
  items?: CalcItem[];
};

/** Format whatever mathjs returns into a clean, precise string. */
function formatValue(value: unknown): string {
  if (value === undefined || value === null) {
    throw new Error("the expression did not produce a value");
  }
  if (typeof value === "function") {
    throw new Error("the expression defined a function instead of a value");
  }
  // 12 significant figures trims float noise (0.1 + 0.2 => 0.3) without
  // collapsing genuinely long results.
  return math.format(value, { precision: 12 });
}

/**
 * Whether the result deserves LaTeX rendering. Pure arithmetic (numbers and
 * the four operators, percentages, parens) reads fine as plain text; anything
 * with functions, powers, roots, symbols or units looks better typeset.
 */
function expressionNeedsLatex(expression: string): boolean {
  return !/^[\d\s+\-*/.,()%]+$/.test(expression);
}

function safeToTex(expression: string): string | undefined {
  try {
    return math
      .parse(expression)
      .toTex({ parenthesis: "keep", implicit: "hide" });
  } catch {
    return undefined;
  }
}

function resultToTex(resultText: string): string | undefined {
  try {
    return math.parse(resultText).toTex();
  } catch {
    return undefined;
  }
}

/** Evaluate one expression into a CalcItem (errors captured, never thrown). */
function evaluateItem(expression: string, label?: string): CalcItem {
  const trimmedLabel = label?.trim() || undefined;
  try {
    const result = formatValue(math.evaluate(expression));
    const needsLatex = expressionNeedsLatex(expression);
    return {
      expression,
      result,
      needsLatex,
      ...(trimmedLabel ? { label: trimmedLabel } : {}),
      ...(needsLatex
        ? {
            expressionTex: safeToTex(expression),
            resultTex: resultToTex(result),
          }
        : {}),
    };
  } catch (error) {
    return {
      expression,
      ...(trimmedLabel ? { label: trimmedLabel } : {}),
      error: error instanceof Error ? error.message : "could not evaluate",
    };
  }
}

const EXPRESSION_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: MAX_EXPRESSION_LENGTH,
  description: "A mathjs expression; use `value unit to unit` for conversions.",
} as const;

/**
 * A deterministic calculator the model can lean on instead of doing arithmetic
 * in its head. Calls surface to the user as a quiet "Calculated …" chip; the
 * model presents the values itself in its reply. The maths is evaluated with
 * mathjs; we hand back LaTeX (when it helps) for the chip's detail view and
 * the plain result for the model to keep reasoning with.
 */
export function createCalculatorTool({
  onResult,
}: {
  onResult: (result: CalcPhasePayload) => Promise<void>;
}) {
  let callIndex = 0;
  return tool({
    description:
      "Evaluate one mathjs expression. Use calculateBatch for multiple expressions.",
    inputSchema: jsonSchema<{
      expression: string;
      label?: string;
    }>({
      type: "object",
      properties: {
        expression: EXPRESSION_SCHEMA,
        label: {
          type: "string",
          maxLength: 80,
          description: "Optional result label.",
        },
      },
      required: ["expression"],
      additionalProperties: false,
    }),
    execute: async ({ expression, label }) => {
      const item = evaluateItem(expression, label);
      await onResult({
        callIdx: callIndex++,
        expression: item.expression,
        ...(item.result !== undefined ? { result: item.result } : {}),
        needsLatex: item.needsLatex ?? false,
        ...(item.label ? { label: item.label } : {}),
        ...(item.expressionTex ? { expressionTex: item.expressionTex } : {}),
        ...(item.resultTex ? { resultTex: item.resultTex } : {}),
        ...(item.error ? { error: item.error } : {}),
      });
      return item.error ? { error: item.error } : { result: item.result };
    },
  });
}

/**
 * The bulk sibling of `calculate`: many independent expressions evaluated in
 * one call (a worksheet, a table of values, several quantities at once).
 * Surfaced to the user as a "Calculated N values" chip that opens the full
 * list; the model presents the answers itself in its reply.
 */
export function createBatchCalculatorTool({
  onResult,
}: {
  onResult: (result: CalcPhasePayload) => Promise<void>;
}) {
  let callIndex = 0;
  return tool({
    description: "Evaluate multiple independent mathjs expressions.",
    inputSchema: jsonSchema<{
      items: { expression: string; label?: string }[];
      label?: string;
    }>({
      type: "object",
      properties: {
        items: {
          type: "array",
          minItems: 1,
          maxItems: MAX_BATCH_ITEMS,
          description: "Expressions to evaluate.",
          items: {
            type: "object",
            properties: {
              expression: EXPRESSION_SCHEMA,
              label: {
                type: "string",
                maxLength: 80,
                description: "Optional item label.",
              },
            },
            required: ["expression"],
            additionalProperties: false,
          },
        },
        label: {
          type: "string",
          maxLength: 80,
          description: "Optional batch label.",
        },
      },
      required: ["items"],
      additionalProperties: false,
    }),
    execute: async ({ items, label }) => {
      const evaluated = items
        .slice(0, MAX_BATCH_ITEMS)
        .map(({ expression, label: itemLabel }) =>
          evaluateItem(expression, itemLabel),
        );
      await onResult({
        callIdx: callIndex++,
        ...(label?.trim() ? { label: label.trim() } : {}),
        items: evaluated,
      });
      return {
        results: evaluated.map((item) => ({
          ...(item.label ? { label: item.label } : {}),
          expression: item.expression,
          ...(item.error ? { error: item.error } : { result: item.result }),
        })),
      };
    },
  });
}
