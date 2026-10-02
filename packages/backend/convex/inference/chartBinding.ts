/* Turning an integration's response into chart series.
 *
 * This is the fragile seam in a live chart: the model writes a field mapping
 * without having seen the response, and a wrong field name would otherwise
 * produce an empty chart rather than an error. Two things keep that honest:
 *
 *  1. every failure here is a specific, actionable message that names what was
 *     actually available, and
 *  2. createChart RUNS the binding once at authoring time and hands these
 *     errors back to the model, so a mapping that doesn't fit never reaches
 *     the user in the first place.
 *
 * Shared by the tool (authoring) and artifactData (every later render), so
 * both agree exactly on what a binding means.
 */

import type { ChartSeries } from "./chart";

export type ChartAggregate = "none" | "count" | "sum" | "average";

/**
 * A live chart's data source, as persisted on the phase. The integration and
 * tool are fixed here at authoring time; nothing on the client can change
 * them, which is the same rule react artifact bindings follow.
 */
export type ChartBindingSpec = ChartBindingMapping & {
  integration: string;
  tool: string;
  /** JSON-encoded arguments object. */
  args?: string;
};

export type ChartBindingMapping = {
  /** Dot path to the array of rows; inferred when absent. */
  path?: string;
  /** Field whose value becomes the category (x axis / slice). Dot paths ok. */
  categoryField: string;
  /** Numeric fields, one series each. Unused when aggregating by count. */
  valueFields?: string[];
  aggregate?: ChartAggregate;
  /** Keep only the largest N categories, by first series. */
  limit?: number;
};

export type ChartBindingData = {
  categories: string[];
  series: ChartSeries[];
  /** How many rows the mapping actually read. */
  rowCount: number;
};

export type ChartBindingResult =
  | { ok: true; data: ChartBindingData }
  | { ok: false; error: string };

/** Matches the chart tool's own ceiling; a live source must not exceed it. */
const MAX_CATEGORIES = 150;
const MAX_VALUE_FIELDS = 8;
/** How many field names to name back when something didn't match. */
const MAX_NAMED_FIELDS = 25;

type Row = Record<string, unknown>;

/** Read a possibly-nested field. `state.name` is extremely common in the wild. */
function readPath(source: unknown, path: string): unknown {
  let current = source;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Every leaf path on a row, so an error can say what WAS there. */
function describeFields(row: Row): string[] {
  const out: string[] = [];
  const walk = (value: unknown, prefix: string, depth: number) => {
    if (out.length >= MAX_NAMED_FIELDS) return;
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value as Row)) {
      if (out.length >= MAX_NAMED_FIELDS) return;
      const path = prefix ? `${prefix}.${key}` : key;
      if (child && typeof child === "object" && !Array.isArray(child) && depth < 2) {
        walk(child, path, depth + 1);
      } else {
        out.push(path);
      }
    }
  };
  walk(row, "", 0);
  return out;
}

/**
 * Find the rows. An explicit path wins; otherwise take the response if it's
 * already an array, else the first array-of-objects hanging off it — MCP
 * servers habitually wrap results as `{ issues: [...] }` or
 * `{ results: { items: [...] } }`, and making the model guess the wrapper is
 * exactly the sort of blind detail this shouldn't hinge on.
 */
function locateRows(
  response: unknown,
  path?: string,
): { ok: true; rows: Row[] } | { ok: false; error: string } {
  if (path) {
    const found = readPath(response, path);
    if (!Array.isArray(found)) {
      return {
        ok: false,
        error: `No array at path "${path}" in the response.${topLevelHint(response)}`,
      };
    }
    return { ok: true, rows: found.filter(isRow) };
  }

  if (Array.isArray(response)) return { ok: true, rows: response.filter(isRow) };

  if (response && typeof response === "object") {
    /* An empty array is still THE array — `{ issues: [] }` means the query
       came back empty, not that the rows are hiding somewhere else, and
       saying so is the difference between a fixable mapping and a wild
       goose chase. Kept as a fallback so a populated array elsewhere still
       wins. */
    let emptyFallback: Row[] | null = null;
    const queue: { value: unknown; depth: number }[] = [
      { value: response, depth: 0 },
    ];
    while (queue.length > 0) {
      const { value, depth } = queue.shift()!;
      if (!value || typeof value !== "object" || depth > 2) continue;
      for (const child of Object.values(value as Row)) {
        if (Array.isArray(child)) {
          if (child.some(isRow)) return { ok: true, rows: child.filter(isRow) };
          if (child.length === 0) emptyFallback ??= [];
        }
        if (child && typeof child === "object" && !Array.isArray(child)) {
          queue.push({ value: child, depth: depth + 1 });
        }
      }
    }
    if (emptyFallback) return { ok: true, rows: emptyFallback };
  }

  return {
    ok: false,
    error: `The response has no array of records to chart.${topLevelHint(response)} Pass \`path\` if the rows are somewhere else, or chart the numbers directly instead of binding.`,
  };
}

function isRow(value: unknown): value is Row {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function topLevelHint(response: unknown): string {
  if (!response || typeof response !== "object") return "";
  const keys = Object.keys(response as Row).slice(0, MAX_NAMED_FIELDS);
  return keys.length > 0 ? ` Top-level keys: ${keys.join(", ")}.` : "";
}

/** Numbers arrive as strings often enough that refusing them is just rude. */
function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s]/g, ""));
    return Number.isFinite(parsed) && value.trim() !== "" ? parsed : null;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  return null;
}

function toCategory(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Unknown";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    const named = (value as Row).name ?? (value as Row).title ?? (value as Row).id;
    if (typeof named === "string" || typeof named === "number") {
      return String(named);
    }
  }
  return "Unknown";
}

/**
 * Apply a mapping to a parsed integration response. Pure — no I/O, no clock —
 * so the authoring check and every later render can't disagree.
 */
export function applyChartBinding(
  response: unknown,
  mapping: ChartBindingMapping,
): ChartBindingResult {
  const located = locateRows(response, mapping.path);
  if (!located.ok) return { ok: false, error: located.error };

  const rows = located.rows;
  if (rows.length === 0) {
    return {
      ok: false,
      error:
        "The integration returned no records, so there's nothing to chart yet.",
    };
  }

  const aggregate = mapping.aggregate ?? "none";
  const valueFields = (mapping.valueFields ?? []).slice(0, MAX_VALUE_FIELDS);

  if (aggregate !== "count" && valueFields.length === 0) {
    return {
      ok: false,
      error:
        "Give at least one `valueFields` entry, or set `aggregate` to \"count\" to chart how many records fall in each category.",
    };
  }

  /* Name the fields that DO exist when one doesn't — this is the message that
     turns a silent empty chart into a fixable mistake. */
  const sample = rows.find((row) => readPath(row, mapping.categoryField) !== undefined);
  if (!sample) {
    return {
      ok: false,
      error: `No record has a "${mapping.categoryField}" field. Available fields: ${describeFields(rows[0]).join(", ") || "(none)"}.`,
    };
  }
  for (const field of valueFields) {
    const hasNumber = rows.some((row) => toNumber(readPath(row, field)) !== null);
    if (!hasNumber) {
      return {
        ok: false,
        error: `"${field}" is never a number on these records. Available fields: ${describeFields(rows[0]).join(", ") || "(none)"}.`,
      };
    }
  }

  if (aggregate === "none") {
    const categories = rows.slice(0, MAX_CATEGORIES).map((row) =>
      toCategory(readPath(row, mapping.categoryField)),
    );
    const series: ChartSeries[] = valueFields.map((field) => ({
      name: field.split(".").at(-1) ?? field,
      values: rows
        .slice(0, MAX_CATEGORIES)
        .map((row) => toNumber(readPath(row, field))),
    }));
    return applyLimit({ categories, series, rowCount: rows.length }, mapping.limit);
  }

  /* Grouped. Insertion-ordered so a source that already sorted sensibly keeps
     its order until `limit` re-ranks it. */
  const buckets = new Map<string, { count: number; sums: number[] }>();
  for (const row of rows) {
    const key = toCategory(readPath(row, mapping.categoryField));
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { count: 0, sums: valueFields.map(() => 0) };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    valueFields.forEach((field, index) => {
      bucket.sums[index] += toNumber(readPath(row, field)) ?? 0;
    });
  }

  const categories = [...buckets.keys()].slice(0, MAX_CATEGORIES);
  const series: ChartSeries[] =
    aggregate === "count"
      ? [
          {
            name: "Count",
            values: categories.map((key) => buckets.get(key)?.count ?? 0),
          },
        ]
      : valueFields.map((field, index) => ({
          name: field.split(".").at(-1) ?? field,
          values: categories.map((key) => {
            const bucket = buckets.get(key);
            if (!bucket) return null;
            return aggregate === "average"
              ? bucket.sums[index] / Math.max(bucket.count, 1)
              : bucket.sums[index];
          }),
        }));

  return applyLimit(
    { categories, series, rowCount: rows.length },
    mapping.limit,
  );
}

/** Keep the biggest N categories by the first series, preserving their order. */
function applyLimit(
  data: ChartBindingData,
  limit?: number,
): ChartBindingResult {
  if (!limit || limit <= 0 || data.categories.length <= limit) {
    return { ok: true, data };
  }
  const first = data.series[0]?.values ?? [];
  const keep = data.categories
    .map((_, index) => index)
    .sort((a, b) => (first[b] ?? 0) - (first[a] ?? 0))
    .slice(0, limit)
    .sort((a, b) => a - b);

  return {
    ok: true,
    data: {
      rowCount: data.rowCount,
      categories: keep.map((index) => data.categories[index]),
      series: data.series.map((s) => ({
        name: s.name,
        values: keep.map((index) => s.values?.[index] ?? null),
      })),
    },
  };
}
