import { describe, expect, test } from "bun:test";

import { createChartTool, normalizeChartSpec } from "../convex/inference/chart";

/* The chart tool's input is the one place a model can hand us a shape the
   renderer can't draw, so the guard rails get real coverage: the caps, the
   alignment rule, and the messages that tell the model how to fix it.

   The model writes names and numbers as parallel flat arrays (`series` +
   `values`) because nested arrays of objects don't survive every model's tool
   grammar; the object spelling is still accepted, and covered here too. */

const bars = {
  type: "bar",
  title: "Revenue by quarter",
  categories: ["Q1", "Q2", "Q3"],
  series: ["Revenue"],
  values: [[10, 20, 30]],
};

describe("normalizeChartSpec", () => {
  test("keeps a well-formed spec intact", () => {
    const spec = normalizeChartSpec(bars);
    expect(spec.type).toBe("bar");
    expect(spec.categories).toEqual(["Q1", "Q2", "Q3"]);
    expect(spec.series).toEqual([{ name: "Revenue", values: [10, 20, 30] }]);
  });

  test("pairs each row of values with its series, in order", () => {
    const spec = normalizeChartSpec({
      ...bars,
      series: ["Organic", "Paid"],
      values: [
        [10, 20, 30],
        [1, 2, 3],
      ],
    });
    expect(spec.series).toEqual([
      { name: "Organic", values: [10, 20, 30] },
      { name: "Paid", values: [1, 2, 3] },
    ]);
  });

  test("takes one series written as a bare row of numbers", () => {
    const spec = normalizeChartSpec({ ...bars, values: [10, 20, 30] });
    expect(spec.series[0].values).toEqual([10, 20, 30]);
  });

  test("still takes the object spelling the binding resolver produces", () => {
    const spec = normalizeChartSpec({
      ...bars,
      series: [{ name: "Revenue", values: [10, 20, 30] }],
      values: undefined,
    });
    expect(spec.series).toEqual([{ name: "Revenue", values: [10, 20, 30] }]);
  });

  test("preserves nulls as gaps rather than zeroing them", () => {
    const spec = normalizeChartSpec({
      ...bars,
      type: "line",
      values: [[10, null, 30]],
    });
    expect(spec.series[0].values).toEqual([10, null, 30]);
  });

  test("reads scatter points off the paired x and y rows", () => {
    const spec = normalizeChartSpec({
      type: "scatter",
      title: "Latency vs. load",
      series: ["p95"],
      pointsX: [[1, 2]],
      pointsY: [[10, 20]],
    });
    expect(spec.series[0].points).toEqual([
      { x: 1, y: 10 },
      { x: 2, y: 20 },
    ]);
  });

  test("refuses scatter rows that don't pair up", () => {
    expect(() =>
      normalizeChartSpec({
        type: "scatter",
        title: "Latency vs. load",
        series: ["p95"],
        pointsX: [[1, 2, 3]],
        pointsY: [[10, 20]],
      }),
    ).toThrow(/3 x values but 2 y values/);
  });

  test("rejects values that don't line up with the categories", () => {
    expect(() =>
      normalizeChartSpec({ ...bars, values: [[10, 20]] }),
    ).toThrow(/2 entries but there are 3 categories/);
  });

  test("says which series has no numbers at all", () => {
    expect(() =>
      normalizeChartSpec({
        ...bars,
        series: ["Organic", "Paid"],
        values: [[10, 20, 30]],
      }),
    ).toThrow(/"Paid" has no numbers/);
  });

  test("caps series at the palette's eight slots", () => {
    expect(() =>
      normalizeChartSpec({
        ...bars,
        series: Array.from({ length: 9 }, (_, index) => `S${index}`),
        values: Array.from({ length: 9 }, () => [1, 2, 3]),
      }),
    ).toThrow(/at most 8 series/);
  });

  test("caps scatter tighter, since its dots compare all-pairs", () => {
    expect(() =>
      normalizeChartSpec({
        type: "scatter",
        title: "Latency",
        series: Array.from({ length: 4 }, (_, index) => `S${index}`),
        pointsX: Array.from({ length: 4 }, () => [1]),
        pointsY: Array.from({ length: 4 }, () => [1]),
      }),
    ).toThrow(/at most 3 series/);
  });

  test("refuses a pie with more than one series", () => {
    expect(() =>
      normalizeChartSpec({
        ...bars,
        type: "pie",
        series: ["A", "B"],
        values: [
          [1, 2, 3],
          [1, 2, 3],
        ],
      }),
    ).toThrow(/exactly one series/);
  });

  test("refuses negative pie slices", () => {
    expect(() =>
      normalizeChartSpec({ ...bars, type: "pie", values: [[5, -2, 3]] }),
    ).toThrow(/can't show negative values/);
  });

  test("refuses non-finite numbers", () => {
    expect(() =>
      normalizeChartSpec({ ...bars, values: [[10, Number.NaN, 30]] }),
    ).toThrow(/finite number/);
  });

  test("enforces the total point budget", () => {
    const categories = Array.from({ length: 100 }, (_, i) => `c${i}`);
    expect(() =>
      normalizeChartSpec({
        type: "line",
        title: "Big",
        categories,
        series: Array.from({ length: 7 }, (_, index) => `S${index}`),
        values: Array.from({ length: 7 }, () => categories.map(() => 1)),
      }),
    ).toThrow(/700 data points/);
  });

  test("drops `stacked` on types that can't stack", () => {
    const spec = normalizeChartSpec({
      ...bars,
      type: "pie",
      stacked: true,
    });
    expect(spec.stacked).toBeUndefined();
    expect(normalizeChartSpec({ ...bars, stacked: true }).stacked).toBe(true);
  });

  test("keeps a currency code only when the format asks for one", () => {
    expect(
      normalizeChartSpec({ ...bars, format: "currency", currency: "usd" })
        .currency,
    ).toBe("USD");
    expect(normalizeChartSpec({ ...bars, currency: "USD" }).currency).toBe(
      undefined,
    );
  });

  test("needs at least two categories to be worth a chart", () => {
    expect(() =>
      normalizeChartSpec({
        ...bars,
        categories: ["Q1"],
        values: [[10]],
      }),
    ).toThrow(/at least 2 categories/);
  });
});

/* Live bindings are a refresh, not the data. Production proved what happens
   when they're treated as load-bearing: a PostHog server that only answers
   `exec` bounced every tool name the model guessed, and five calls carrying
   perfectly good numbers were thrown away over it — the user got no chart at
   all, just an ASCII one the model drew in desperation. */
describe("a binding that won't read", () => {
  const chartCall = async ({
    readable,
    values,
  }: {
    readable: boolean;
    values?: number[][];
  }) => {
    let drawn: unknown = null;
    let rejected = false;
    const tool = createChartTool({
      onResult: async (spec) => {
        drawn = spec;
      },
      onReject: async () => {
        rejected = true;
      },
      connectedIntegrations: ["PostHog"],
      readBinding: async () =>
        readable
          ? { ok: true as const, data: [{ day: "Mon", visitors: 4 }, { day: "Tue", visitors: 9 }] }
          : { ok: false as const, error: 'Unknown command "list_tools"' },
    });
    const output = (await tool.execute!(
      {
        type: "line",
        title: "Visitors",
        categories: ["Mon", "Tue"],
        series: ["Visitors"],
        ...(values ? { values } : {}),
        binding: {
          integration: "PostHog",
          tool: "list_tools",
          categoryField: "day",
          valueFields: ["visitors"],
        },
      },
      {} as never,
    )) as { error?: string; note?: string };
    return { drawn, rejected, output };
  };

  test("still draws the numbers the model wrote", async () => {
    const { drawn, rejected, output } = await chartCall({
      readable: false,
      values: [[4, 9]],
    });
    expect(rejected).toBe(false);
    expect(output.error).toBeUndefined();
    expect((drawn as { series: unknown[] }).series).toEqual([
      { name: "Visitors", values: [4, 9] },
    ]);
    // No live footnote on a chart that can't refresh itself.
    expect((drawn as { binding?: unknown }).binding).toBeUndefined();
    expect(output.note).toMatch(/live link was dropped/);
  });

  test("only gives up when the failed source left nothing to draw", async () => {
    const { drawn, rejected, output } = await chartCall({ readable: false });
    expect(rejected).toBe(true);
    expect(drawn).toBeNull();
    expect(output.error).toMatch(/couldn't be read/);
    expect(output.error).toMatch(/Don't retry the binding/);
  });

  test("keeps the live link when the source reads", async () => {
    const { drawn, rejected } = await chartCall({ readable: true });
    expect(rejected).toBe(false);
    expect((drawn as { binding?: { integration: string } }).binding?.integration).toBe(
      "PostHog",
    );
  });
});

/* The regression that started all of this: with the data shaped as an array of
   objects, several models — grok-4.5 through OpenRouter most reliably — sent
   the call with that argument missing entirely, so the chart never came and
   nothing anywhere recorded an error. Keep every array in the schema an array
   of scalars. */
test("the tool asks for no array of objects", () => {
  const tool = createChartTool({
    onResult: async () => {},
    onReject: async () => {},
  });
  const schema = (tool.inputSchema as { jsonSchema: unknown }).jsonSchema;

  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== "object") return;
    const entry = node as Record<string, unknown>;
    const items = entry.items as Record<string, unknown> | undefined;
    if (entry.type === "array" && items?.type === "object") {
      throw new Error(`${path} is an array of objects`);
    }
    for (const [key, value] of Object.entries(entry)) {
      walk(value, `${path}.${key}`);
    }
  };

  expect(() => walk(schema, "input")).not.toThrow();
});
