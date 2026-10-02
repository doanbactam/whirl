import { jsonSchema, tool } from "ai";

import {
  applyChartBinding,
  type ChartAggregate,
  type ChartBindingSpec,
} from "./chartBinding";

/* The chart tool: the model writes a small JSON spec, the client owns the
   rendering. Nothing here draws anything — the whole point of a spec (over
   letting the model hand-write SVG) is that palette, light/dark, geometry,
   and hover behaviour stay ours.

   Everything the card shows rides on the message's `chart` phase, exactly
   like the weather widget, so there's no table behind it. That makes the
   caps below load-bearing: a spec sits on the hot message row that every
   open tab re-reads while the turn streams. */

export type ChartType =
  | "line"
  | "area"
  | "bar"
  | "hbar"
  | "pie"
  | "scatter";

export type ChartValueFormat =
  | "number"
  | "compact"
  | "percent"
  | "currency";

export type ChartSeries = {
  name: string;
  /** Aligned index-for-index with `categories`; null is a gap, not a zero. */
  values?: (number | null)[];
  /** Scatter only — free (x, y) pairs with no shared category axis. */
  points?: { x: number; y: number }[];
};

/* The shape the model writes, which is deliberately NOT the shape above.
   Several models — grok-4.5 through OpenRouter most reliably — simply omit a
   required array-of-objects property from a tool call, so a `series: [{name,
   values}]` input arrived with `series` missing over and over, the spec was
   rejected, and the chart never came. Parallel arrays of scalars survive every
   tier model's tool grammar, so that's what the schema asks for and this file
   folds back into ChartSeries. */
type SeriesInput = {
  names: string[];
  /** Non-scatter: one row per series, each aligned to `categories`. */
  rows?: (number | null)[][];
  /** Scatter: one row per series, x and y read pairwise. */
  pointsX?: number[][];
  pointsY?: number[][];
};

export type ChartSpec = {
  type: ChartType;
  title: string;
  subtitle?: string;
  categories?: string[];
  series: ChartSeries[];
  stacked?: boolean;
  xLabel?: string;
  yLabel?: string;
  format?: ChartValueFormat;
  /** ISO 4217 code, used only when `format` is "currency". */
  currency?: string;
  /** Where the numbers came from — rendered as a footnote under the chart. */
  source?: string;
  /**
   * A live data source. When present, `categories` and `series` hold the
   * values as of the moment the chart was made, and the card refreshes them
   * from the integration on every open. Written only by the tool, never by the
   * model directly — see createChartTool.
   */
  binding?: ChartBindingSpec;
};

/* Caps. The series ceiling is the categorical palette's: eight slots, never
   a ninth generated hue. Scatter is tighter because overlapping dots are
   compared all-pairs rather than adjacent-pairs, and only the first three
   slots clear the colorblind floors under that comparison. */
const MAX_SERIES = 8;
const MAX_SCATTER_SERIES = 3;
const MAX_CATEGORIES = 150;
const MAX_TOTAL_POINTS = 600;

const MAX_TITLE = 120;
const MAX_SUBTITLE = 200;
const MAX_AXIS_LABEL = 60;
const MAX_CATEGORY = 48;
const MAX_SERIES_NAME = 40;
const MAX_SOURCE = 200;

const CHART_TYPES: ChartType[] = [
  "line",
  "area",
  "bar",
  "hbar",
  "pie",
  "scatter",
];

const STACKABLE: ChartType[] = ["area", "bar", "hbar"];

/** Every type but scatter reads its x-axis off the shared `categories` list. */
function usesCategories(type: ChartType): boolean {
  return type !== "scatter";
}

class ChartSpecError extends Error {}

function fail(message: string): never {
  throw new ChartSpecError(message);
}

function trimTo(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function finite(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${where} must be a finite number (got ${JSON.stringify(value)}).`);
  }
  return value;
}

function seriesName(value: unknown, index: number): string {
  if (typeof value !== "string" || !value.trim()) {
    fail(
      `\`series[${index}]\` must be a non-empty series name — \`series\` is the list of names, and the numbers go in \`values\`.`,
    );
  }
  return trimTo(value, MAX_SERIES_NAME);
}

/** One row of numbers, gaps kept as nulls rather than zeroed. */
function numberRow(value: unknown, where: string): (number | null)[] {
  if (!Array.isArray(value)) {
    fail(`${where} must be an array of numbers.`);
  }
  return value.map((entry, index) =>
    entry === null || entry === undefined
      ? null
      : finite(entry, `${where}[${index}]`),
  );
}

function isNumeric(value: unknown): boolean {
  return typeof value === "number" || value === null;
}

/**
 * Read the model's series into one shape, whichever spelling arrived.
 *
 * Flat (`series: string[]` + `values: number[][]`) is what the schema asks
 * for, and the only one a model should ever write. The object spelling is
 * still accepted because the binding resolver produces it — and because a
 * model that improvises it deserves a chart rather than a rejection.
 */
function readSeriesInput(
  raw: Record<string, unknown>,
  type: ChartType,
): SeriesInput {
  const rawSeries = raw.series;
  if (!Array.isArray(rawSeries) || rawSeries.length === 0) {
    fail(
      type === "scatter"
        ? "`series` must be a non-empty array of series names, with a matching row in `pointsX` and `pointsY` for each."
        : "`series` must be a non-empty array of series names, with a matching row of numbers in `values` for each.",
    );
  }

  /* Object spelling: names and numbers already paired up. */
  if (rawSeries.some((entry) => entry !== null && typeof entry === "object")) {
    const names: string[] = [];
    const rows: (number | null)[][] = [];
    const pointsX: number[][] = [];
    const pointsY: number[][] = [];
    rawSeries.forEach((entry, index) => {
      if (entry === null || typeof entry !== "object") {
        fail(`\`series[${index}]\` must be an object like the others.`);
      }
      const item = entry as Record<string, unknown>;
      names.push(seriesName(item.name, index));
      if (type === "scatter") {
        const points = Array.isArray(item.points) ? item.points : [];
        pointsX.push(
          points.map((point, at) =>
            finite(
              (point as Record<string, unknown> | null)?.x,
              `\`series[${index}].points[${at}].x\``,
            ),
          ),
        );
        pointsY.push(
          points.map((point, at) =>
            finite(
              (point as Record<string, unknown> | null)?.y,
              `\`series[${index}].points[${at}].y\``,
            ),
          ),
        );
      } else {
        rows.push(numberRow(item.values, `\`series[${index}].values\``));
      }
    });
    return { names, rows, pointsX, pointsY };
  }

  const names = rawSeries.map((name, index) => seriesName(name, index));

  if (type === "scatter") {
    const readPoints = (value: unknown, key: string) => {
      if (!Array.isArray(value)) return [];
      /* One series written as a bare row rather than a row of rows — the
         single-series shorthand models reach for. */
      if (value.every(isNumeric) && names.length === 1) {
        return [value.map((entry, at) => finite(entry, `\`${key}[${at}]\``))];
      }
      return value.map((row, index) =>
        numberRow(row, `\`${key}[${index}]\``).map((entry, at) =>
          finite(entry, `\`${key}[${index}][${at}]\``),
        ),
      );
    };
    return {
      names,
      pointsX: readPoints(raw.pointsX, "pointsX"),
      pointsY: readPoints(raw.pointsY, "pointsY"),
    };
  }

  const rawValues = raw.values;
  if (!Array.isArray(rawValues)) {
    fail(
      "`values` must be an array of rows — one row of numbers per series, in the same order as `series`.",
    );
  }
  /* A single series written as one bare row instead of a row of rows. */
  const rows =
    rawValues.every(isNumeric) && names.length === 1
      ? [numberRow(rawValues, "`values`")]
      : rawValues.map((row, index) => numberRow(row, `\`values[${index}]\``));
  return { names, rows };
}

/**
 * Normalize and hard-validate the model's raw input into a spec the card can
 * render without defensive checks. Throws ChartSpecError with a message
 * written *for the model* — every failure says what to do instead, so a
 * malformed call can be repaired in one retry rather than abandoned.
 */
export function normalizeChartSpec(input: unknown): ChartSpec {
  if (typeof input !== "object" || input === null) {
    fail("The chart input must be an object.");
  }
  const raw = input as Record<string, unknown>;

  const type = raw.type as ChartType;
  if (!CHART_TYPES.includes(type)) {
    fail(`\`type\` must be one of: ${CHART_TYPES.join(", ")}.`);
  }

  const title =
    typeof raw.title === "string" && raw.title.trim()
      ? trimTo(raw.title, MAX_TITLE)
      : fail("`title` is required — a chart without one has no headline.");

  const seriesInput = readSeriesInput(raw, type);

  const seriesCap = type === "scatter" ? MAX_SCATTER_SERIES : MAX_SERIES;
  if (seriesInput.names.length > seriesCap) {
    fail(
      type === "scatter"
        ? `A scatter chart takes at most ${MAX_SCATTER_SERIES} series (overlapping dots stop being tellable apart past that). Aggregate the rest, or use one series.`
        : `A chart takes at most ${MAX_SERIES} series. Aggregate the smallest into a single "Other" series, or split this into two charts.`,
    );
  }
  if (type === "pie" && seriesInput.names.length !== 1) {
    fail(
      "A pie chart takes exactly one series — its slices are the categories. Use a stacked bar chart to compare several groups.",
    );
  }

  /* Categories: the shared x-axis for everything except scatter. */
  let categories: string[] | undefined;
  if (usesCategories(type)) {
    const rawCategories = raw.categories;
    if (!Array.isArray(rawCategories) || rawCategories.length === 0) {
      fail(
        "`categories` is required for this chart type — one label per point along the x-axis.",
      );
    }
    if (rawCategories.length > MAX_CATEGORIES) {
      fail(
        `That's ${rawCategories.length} categories; the cap is ${MAX_CATEGORIES}. Bucket or trim the data — nobody can read more than that in a chat-width chart anyway.`,
      );
    }
    categories = rawCategories.map((label, index) => {
      if (typeof label !== "string" || !label.trim()) {
        fail(`\`categories[${index}]\` must be a non-empty string.`);
      }
      return trimTo(label, MAX_CATEGORY);
    });
    if (type !== "pie" && categories.length < 2) {
      fail(
        "A chart needs at least 2 categories. For a single number, just say it in the reply.",
      );
    }
  }

  let totalPoints = 0;
  const series: ChartSeries[] = seriesInput.names.map((name, index) => {
    if (type === "scatter") {
      const xs = seriesInput.pointsX?.[index] ?? [];
      const ys = seriesInput.pointsY?.[index] ?? [];
      if (xs.length === 0 || ys.length === 0) {
        fail(
          `"${name}" has no points. A scatter chart needs a row of numbers in \`pointsX\` and one in \`pointsY\` for every series, in the same order.`,
        );
      }
      if (xs.length !== ys.length) {
        fail(
          `"${name}" has ${xs.length} x values but ${ys.length} y values. They're read pairwise, so the rows must be the same length.`,
        );
      }
      const points = xs.map((x, at) => ({ x, y: ys[at] }));
      totalPoints += points.length;
      return { name, points };
    }

    const values = seriesInput.rows?.[index];
    if (!values) {
      fail(
        `"${name}" has no numbers. \`values\` needs one row per series, in the same order as \`series\`.`,
      );
    }
    if (values.length !== categories!.length) {
      fail(
        `\`values[${index}]\` ("${name}") has ${values.length} entries but there are ${categories!.length} categories. They must line up — use null for a genuine gap.`,
      );
    }
    totalPoints += values.length;
    return { name, values };
  });

  if (totalPoints > MAX_TOTAL_POINTS) {
    fail(
      `That's ${totalPoints} data points; the cap is ${MAX_TOTAL_POINTS}. Sample, bucket, or drop a series.`,
    );
  }

  if (type === "pie") {
    const values = series[0].values ?? [];
    if (values.some((value) => value !== null && value < 0)) {
      fail(
        "A pie chart can't show negative values — every slice is a share of a whole. Use a bar chart instead.",
      );
    }
    if (!values.some((value) => value !== null && value > 0)) {
      fail("A pie chart needs at least one value above zero.");
    }
  }

  const stacked = raw.stacked === true && STACKABLE.includes(type);
  const format = (
    ["number", "compact", "percent", "currency"] as const
  ).includes(raw.format as ChartValueFormat)
    ? (raw.format as ChartValueFormat)
    : undefined;

  const optionalText = (value: unknown, max: number): string | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = trimTo(value, max);
    return trimmed ? trimmed : undefined;
  };

  const currency =
    format === "currency" && typeof raw.currency === "string"
      ? raw.currency.trim().toUpperCase().slice(0, 3) || undefined
      : undefined;

  return {
    type,
    title,
    ...(categories ? { categories } : {}),
    series,
    ...(stacked ? { stacked: true } : {}),
    ...(format ? { format } : {}),
    ...(currency ? { currency } : {}),
    ...(optionalText(raw.subtitle, MAX_SUBTITLE)
      ? { subtitle: optionalText(raw.subtitle, MAX_SUBTITLE) }
      : {}),
    ...(optionalText(raw.xLabel, MAX_AXIS_LABEL)
      ? { xLabel: optionalText(raw.xLabel, MAX_AXIS_LABEL) }
      : {}),
    ...(optionalText(raw.yLabel, MAX_AXIS_LABEL)
      ? { yLabel: optionalText(raw.yLabel, MAX_AXIS_LABEL) }
      : {}),
    ...(optionalText(raw.source, MAX_SOURCE)
      ? { source: optionalText(raw.source, MAX_SOURCE) }
      : {}),
  };
}

const CHART_INPUT_SCHEMA = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: CHART_TYPES,
      description:
        "line = change over an ordered sequence. area = the same, when the filled magnitude matters (set stacked for parts of a whole over time). bar = compare categories. hbar = the same with long category names, or a ranking. pie = a handful of parts of one whole. scatter = the relationship between two measures.",
    },
    title: {
      type: "string",
      maxLength: MAX_TITLE,
      description:
        "The chart's headline. State what it shows, not the chart type — 'Revenue by quarter', never 'Bar chart'.",
    },
    subtitle: {
      type: "string",
      maxLength: MAX_SUBTITLE,
      description: "Optional one-line clarifier: units, period, or caveat.",
    },
    categories: {
      type: "array",
      maxItems: MAX_CATEGORIES,
      items: { type: "string", maxLength: MAX_CATEGORY },
      description:
        "The x-axis labels, in the order they should appear. Required for every type except scatter; for pie these label the slices.",
    },
    /* Names and numbers travel as parallel arrays of scalars rather than as
       one array of objects. Several models drop a nested array-of-objects
       argument from a tool call outright, taking the whole chart with it; flat
       rows survive every one of them. */
    series: {
      type: "array",
      minItems: 1,
      maxItems: MAX_SERIES,
      items: { type: "string", maxLength: MAX_SERIES_NAME },
      description:
        "The legend labels, one per line/group. Exactly one for pie; at most three for scatter.",
    },
    values: {
      type: "array",
      maxItems: MAX_SERIES,
      items: {
        type: "array",
        items: { type: ["number", "null"] },
      },
      description:
        "One row per series, in the same order as `series`: that series' number for each category, in the same order as `categories`. Use null for a genuine gap in the data — never 0 to mean 'unknown'. Required for every type except scatter.",
    },
    pointsX: {
      type: "array",
      maxItems: MAX_SCATTER_SERIES,
      items: { type: "array", items: { type: "number" } },
      description:
        "Scatter only: one row per series, holding its x values. Paired index-for-index with pointsY.",
    },
    pointsY: {
      type: "array",
      maxItems: MAX_SCATTER_SERIES,
      items: { type: "array", items: { type: "number" } },
      description: "Scatter only: the matching y values.",
    },
    stacked: {
      type: "boolean",
      description:
        "Stack the series into a whole instead of drawing them side by side. Only for area, bar, and hbar, and only when the total is itself meaningful.",
    },
    xLabel: {
      type: "string",
      maxLength: MAX_AXIS_LABEL,
      description:
        "Optional x-axis label. Skip it when the categories already say it.",
    },
    yLabel: {
      type: "string",
      maxLength: MAX_AXIS_LABEL,
      description:
        "Optional y-axis label — usually the unit ('GB', 'signups').",
    },
    format: {
      type: "string",
      enum: ["number", "compact", "percent", "currency"],
      description:
        "How to write the values. compact = 1.2K/3.4M for large counts. percent expects 0-100, not 0-1. Defaults to number.",
    },
    currency: {
      type: "string",
      maxLength: 3,
      description: "ISO code (USD, EUR) — only with format: currency.",
    },
    source: {
      type: "string",
      maxLength: MAX_SOURCE,
      description:
        "Where these numbers came from, shown as a footnote. Name the actual source (a site you fetched, the file they sent, your own calculation).",
    },
  },
  required: ["type", "title", "series"],
  additionalProperties: false,
} as const;

/**
 * The `binding` half of the schema, spliced in only when the user has
 * integrations connected. With none, every binding a model could write would
 * be rejected, so the whole concept stays out of the request.
 */
const CHART_BINDING_SCHEMA = {
  type: "object",
  description:
    "Also keep this chart live: the integration is re-read every time the user opens the thread, so the numbers stay current. Fill in `categories` and `values` from what you already have as well — the binding only refreshes them, and if the source can't be read the chart still draws from what you wrote. Only omit them when you have no numbers yet. Not available for scatter, which needs (x, y) pairs you supply yourself.",
  properties: {
    integration: {
      type: "string",
      description: "Exact connected integration name.",
    },
    tool: {
      type: "string",
      description: "The tool to run. List its schema first if unsure.",
    },
    args: {
      type: "string",
      description: "JSON-encoded arguments object for that tool.",
    },
    path: {
      type: "string",
      description:
        "Dot path to the array of records in the response, if it isn't obvious. Usually omit — the wrapper is found automatically.",
    },
    categoryField: {
      type: "string",
      description:
        "Field on each record that becomes the x-axis label or pie slice. Dot paths work: 'state.name'.",
    },
    valueFields: {
      type: "array",
      maxItems: MAX_SERIES,
      items: { type: "string" },
      description:
        "Numeric fields, one series each. Omit when aggregate is 'count'.",
    },
    aggregate: {
      type: "string",
      enum: ["none", "count", "sum", "average"],
      description:
        "'count' groups the records by categoryField and charts how many fall in each — the usual answer for 'issues by status', 'orders by region'. 'sum'/'average' group the same way and aggregate valueFields. 'none' (default) charts one record per category, in the order returned.",
    },
    limit: {
      type: "number",
      description: "Keep only the N largest categories.",
    },
  },
  required: ["integration", "tool", "categoryField"],
  additionalProperties: false,
} as const;

/**
 * Render a chart inline in the reply. The model supplies data it actually
 * has; we draw it. Returns a short confirmation (never the data back) so the
 * model doesn't restate every number in prose next to the chart.
 */
export function createChartTool({
  onResult,
  onReject,
  connectedIntegrations = [],
  readBinding,
}: {
  onResult: (spec: ChartSpec) => Promise<void>;
  /** The spec didn't survive validation, so the card opened on
   *  tool-input-start has nothing coming — take it back down. */
  onReject: () => Promise<void>;
  /** Integration names the user has connected right now. */
  connectedIntegrations?: string[];
  /**
   * Run a bound chart's source once, here at authoring time. This is what
   * keeps a live chart from being a guess: the model writes a field mapping
   * without having seen the response, so we fetch it, apply the mapping, and
   * hand any mismatch straight back for a retry. It also seeds the cache, so
   * the card's first render costs nothing.
   */
  readBinding?: (binding: {
    integration: string;
    tool: string;
    args?: string;
  }) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;
}) {
  const bindingsEnabled = connectedIntegrations.length > 0 && Boolean(readBinding);
  const schema = bindingsEnabled
    ? {
        ...CHART_INPUT_SCHEMA,
        properties: {
          ...CHART_INPUT_SCHEMA.properties,
          binding: CHART_BINDING_SCHEMA,
        },
        /* `series` stops being required once a binding can supply it — the
           whole point is not hand-writing numbers the integration has. */
        required: ["type", "title"],
      }
    : CHART_INPUT_SCHEMA;

  return tool({
    description: bindingsEnabled
      ? "Draw a chart inline in the reply — from data you already have, or bound live to a connected integration. Types: line, area, bar, hbar, pie, scatter."
      : "Draw a chart inline in the reply from data you already have. Types: line, area, bar, hbar, pie, scatter.",
    inputSchema: jsonSchema<Record<string, unknown>>(
      schema as unknown as Record<string, unknown>,
    ),
    execute: async (input) => {
      const raw = { ...(input as Record<string, unknown>) };

      /* Resolve a live source into real categories and series BEFORE the spec
         is validated, so a bound chart goes through exactly the same checks a
         hand-written one does.

         A source that won't read is NOT fatal. The live link is a bonus on top
         of a chart; the numbers are the chart. Killing the whole call over it
         is what left an integration-shaped question with no chart at all —
         the model wrote good values, guessed a tool name the server didn't
         have, and lost everything five times over. So a failed binding is
         dropped and reported, and whatever the model wrote still draws. */
      let binding: ChartBindingSpec | undefined;
      let bindingError: string | undefined;
      if (bindingsEnabled && raw.binding) {
        const resolved = await resolveBinding(
          raw.binding,
          connectedIntegrations,
          readBinding!,
        );
        if (resolved.ok) {
          binding = resolved.binding;
          raw.categories = resolved.categories;
          raw.series = resolved.series;
          delete raw.values;
        } else {
          bindingError = resolved.error;
        }
        delete raw.binding;
      }

      let spec: ChartSpec;
      try {
        spec = normalizeChartSpec(raw);
      } catch (error) {
        if (error instanceof ChartSpecError) {
          // A rejected spec is the model's to fix, so hand back the reason
          // rather than a failed tool call — every message here says what to
          // do instead, so one retry is usually enough. A binding that failed
          // AND left nothing to draw says both halves at once, and says to
          // stop hunting for a source that works.
          await onReject();
          return {
            error: bindingError
              ? `That live source couldn't be read (${bindingError}), and there's nothing to draw without it: ${error.message} Don't retry the binding — write the numbers you already have into \`categories\` and \`values\` instead.`
              : error.message,
          };
        }
        throw error;
      }

      if (binding) spec = { ...spec, binding };
      await onResult(spec);

      const points = spec.series.reduce(
        (total, entry) =>
          total + (entry.values?.length ?? entry.points?.length ?? 0),
        0,
      );
      return {
        rendered: true,
        title: spec.title,
        summary: `${spec.type} chart, ${spec.series.length} series, ${points} points`,
        note: bindingError
          ? `The chart is drawn and visible to the user, from the numbers you supplied. The live link was dropped — that source couldn't be read (${bindingError}) — so the chart is a snapshot and won't refresh. Don't call the tool again for this; mention the numbers are a snapshot if it matters, and don't repeat them in prose.`
          : binding
            ? "The chart is visible to the user and refreshes itself from the integration, so its numbers will move on without you — describe what it shows, never the specific values, and don't restate them in prose."
            : "The chart is now visible to the user. Don't repeat its numbers in prose — add only what the chart can't say (the takeaway, a caveat).",
      };
    },
  });
}

type ResolvedBinding =
  | {
      ok: true;
      binding: ChartBindingSpec;
      categories: string[];
      series: ChartSeries[];
    }
  | { ok: false; error: string };

/** Validate a declared source, run it once, and map the response into series. */
async function resolveBinding(
  input: unknown,
  connectedIntegrations: string[],
  readBinding: (binding: {
    integration: string;
    tool: string;
    args?: string;
  }) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>,
): Promise<ResolvedBinding> {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "`binding` must be an object." };
  }
  const raw = input as Record<string, unknown>;

  const known = new Map(
    connectedIntegrations.map((name) => [name.trim().toLowerCase(), name]),
  );
  const integration =
    typeof raw.integration === "string"
      ? known.get(raw.integration.trim().toLowerCase())
      : undefined;
  if (!integration) {
    return {
      ok: false,
      error: `\`binding.integration\` must be one of the connected integrations: ${connectedIntegrations.join(", ")}.`,
    };
  }

  const toolName =
    typeof raw.tool === "string" && raw.tool.trim() ? raw.tool.trim() : null;
  if (!toolName) return { ok: false, error: "`binding.tool` is required." };

  const categoryField =
    typeof raw.categoryField === "string" && raw.categoryField.trim()
      ? raw.categoryField.trim()
      : null;
  if (!categoryField) {
    return { ok: false, error: "`binding.categoryField` is required." };
  }

  let args: string | undefined;
  if (raw.args !== undefined && raw.args !== null && raw.args !== "") {
    if (typeof raw.args !== "string") {
      return {
        ok: false,
        error: "`binding.args` must be a JSON-encoded object as a string.",
      };
    }
    try {
      const parsed: unknown = JSON.parse(raw.args);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("not an object");
      }
    } catch {
      return {
        ok: false,
        error: "`binding.args` isn't a JSON-encoded object.",
      };
    }
    args = raw.args;
  }

  const valueFields = Array.isArray(raw.valueFields)
    ? raw.valueFields
        .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
        .slice(0, MAX_SERIES)
    : undefined;

  const binding: ChartBindingSpec = {
    integration,
    tool: toolName,
    ...(args ? { args } : {}),
    ...(typeof raw.path === "string" && raw.path.trim()
      ? { path: raw.path.trim() }
      : {}),
    categoryField,
    ...(valueFields && valueFields.length > 0 ? { valueFields } : {}),
    ...(typeof raw.aggregate === "string"
      ? { aggregate: raw.aggregate as ChartAggregate }
      : {}),
    ...(typeof raw.limit === "number" && raw.limit > 0
      ? { limit: Math.floor(raw.limit) }
      : {}),
  };

  const response = await readBinding({
    integration,
    tool: toolName,
    ...(args ? { args } : {}),
  });
  if (!response.ok) return { ok: false, error: response.error };

  const mapped = applyChartBinding(response.data, binding);
  if (!mapped.ok) return { ok: false, error: mapped.error };

  return {
    ok: true,
    binding,
    categories: mapped.data.categories,
    series: mapped.data.series,
  };
}
