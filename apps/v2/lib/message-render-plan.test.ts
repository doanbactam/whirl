// @ts-expect-error Bun provides this module to its test runner; the Next app
// intentionally does not include Bun's ambient types in its client tsconfig.
import { describe, expect, test } from "bun:test";

import type { MessagePhase } from "./messages";
import { buildMessageRenderPlan } from "./message-render-plan";

function phase(
  kind: string,
  contentOffset?: number,
): MessagePhase {
  return { kind, contentOffset };
}

describe("buildMessageRenderPlan", () => {
  test("places tool activity between the prose around its content offset", () => {
    const plan = buildMessageRenderPlan("Before.After.", [
      phase("search", 7),
    ]);

    expect(plan.map((item) => item.type)).toEqual([
      "text",
      "phase",
      "text",
    ]);
    expect(plan[0]).toMatchObject({ type: "text", text: "Before." });
    expect(plan[1]).toMatchObject({
      type: "phase",
      phase: { kind: "search" },
    });
    expect(plan[2]).toMatchObject({ type: "text", text: "After." });
  });

  test("forms multiple stacks when prose separates tool runs", () => {
    const content = "First explanation. Second explanation.";
    const secondOffset = content.indexOf(" Second");
    const plan = buildMessageRenderPlan(content, [
      phase("search", 0),
      phase("fetch", 0),
      phase("calc", secondOffset),
      phase("mcp", secondOffset),
    ]);

    expect(plan.map((item) => item.type)).toEqual([
      "group",
      "text",
      "group",
      "text",
    ]);
    expect(plan[0]).toMatchObject({
      type: "group",
      phases: [
        { phase: { kind: "search" } },
        { phase: { kind: "fetch" } },
      ],
    });
    expect(plan[2]).toMatchObject({
      type: "group",
      phases: [
        { phase: { kind: "calc" } },
        { phase: { kind: "mcp" } },
      ],
    });
  });

  test("keeps rich phases inline and breaks compact stacks around them", () => {
    const plan = buildMessageRenderPlan("", [
      phase("search", 0),
      phase("weather", 0),
      phase("fetch", 0),
      phase("calc", 0),
    ]);

    expect(plan.map((item) => item.type)).toEqual([
      "phase",
      "phase",
      "group",
    ]);
    expect(plan[1]).toMatchObject({
      type: "phase",
      phase: { kind: "weather" },
    });
  });

  test("does not stack a thought with only one tool call", () => {
    const plan = buildMessageRenderPlan("", [
      phase("thought", 0),
      phase("search", 0),
    ]);

    expect(plan.map((item) => item.type)).toEqual(["phase", "phase"]);
  });

  test("stacks a lone tool once thoughts surround it", () => {
    const plan = buildMessageRenderPlan("", [
      phase("thought", 0),
      phase("skill", 0),
      phase("thought", 0),
    ]);

    expect(plan.map((item) => item.type)).toEqual(["group"]);
    expect(plan[0]).toMatchObject({
      type: "group",
      phases: [
        { phase: { kind: "thought" } },
        { phase: { kind: "skill" } },
        { phase: { kind: "thought" } },
      ],
    });
  });

  test("leaves a run of pure thoughts unstacked", () => {
    const plan = buildMessageRenderPlan("", [
      phase("thought", 0),
      phase("thought", 0),
      phase("thought", 0),
    ]);

    expect(plan.map((item) => item.type)).toEqual([
      "phase",
      "phase",
      "phase",
    ]);
  });

  test("renders phases without offsets after the prose tail", () => {
    const plan = buildMessageRenderPlan("Done writing.", [
      phase("search"),
      phase("fetch"),
    ]);

    expect(plan.map((item) => item.type)).toEqual(["text", "group"]);
  });
});
