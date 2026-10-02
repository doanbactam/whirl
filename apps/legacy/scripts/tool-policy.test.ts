// @ts-nocheck -- Bun supplies this module at test runtime; app typecheck is Node-only.
import { describe, expect, test } from "bun:test";

import {
  decideToolStep,
  RUNAWAY_TOOL_CALL_LIMIT,
} from "@whirl/backend/convex/inference/toolPolicy";

const MAX_STEPS = 16;

const step = (...calls: { toolName: string; input?: unknown }[]) => ({
  toolCalls: calls,
});

const call = (toolName: string, input?: unknown) => ({ toolName, input });

describe("decideToolStep", () => {
  test("a fresh turn runs unrestricted", () => {
    expect(decideToolStep([], { maxSteps: MAX_STEPS })).toEqual({
      forceFinalResponse: false,
      repeatedTools: [],
      totalToolCalls: 0,
      duplicateToolCalls: 0,
    });
  });

  test("many distinct calls are progress, not a loop", () => {
    // The Stripe→Gmail regression: a real multi-integration errand makes 8+
    // gateway calls with different inputs and must keep every tool available.
    const steps = Array.from({ length: 9 }, (_, i) =>
      step(call("mcp_call_tool", { integration: "Stripe", args: `q${i}` })),
    );

    const decision = decideToolStep(steps, { maxSteps: MAX_STEPS });

    expect(decision.forceFinalResponse).toBe(false);
    expect(decision.repeatedTools).toEqual([]);
    expect(decision.totalToolCalls).toBe(9);
  });

  test("one identical repeat draws a warning without ending the turn", () => {
    const listGmail = call("mcp_list_tools", { integration: "Gmail" });
    const decision = decideToolStep(
      [step(listGmail), step(call("mcp_call_tool", { a: 1 })), step(listGmail)],
      { maxSteps: MAX_STEPS },
    );

    expect(decision.repeatedTools).toEqual(["mcp_list_tools"]);
    expect(decision.duplicateToolCalls).toBe(1);
    expect(decision.forceFinalResponse).toBe(false);
  });

  test("the same call three times forces the final response", () => {
    const same = call("searchChatHistory", { query: "diego" });
    const decision = decideToolStep([step(same), step(same), step(same)], {
      maxSteps: MAX_STEPS,
    });

    expect(decision.forceFinalResponse).toBe(true);
  });

  test("scattered duplicates across signatures still count as a loop", () => {
    // Two repeats each of three different calls: no single signature hits the
    // identical-call ceiling, but six duplicated calls is a spiral all the same.
    const a = call("mcp_call_tool", { q: "a" });
    const b = call("mcp_call_tool", { q: "b" });
    const c = call("fetchUrl", { url: "https://x.test" });
    const decision = decideToolStep(
      [step(a, a), step(a, b), step(b, b), step(c, c), step(c)],
      { maxSteps: MAX_STEPS },
    );

    expect(decision.duplicateToolCalls).toBe(6);
    expect(decision.forceFinalResponse).toBe(true);
  });

  test("same tool with different inputs never counts as a repeat", () => {
    const decision = decideToolStep(
      [
        step(call("calculate", { expression: "1+1" })),
        step(call("calculate", { expression: "2+2" })),
      ],
      { maxSteps: MAX_STEPS },
    );

    expect(decision.repeatedTools).toEqual([]);
    expect(decision.forceFinalResponse).toBe(false);
  });

  test("the runaway backstop forces the final response", () => {
    const calls = Array.from({ length: RUNAWAY_TOOL_CALL_LIMIT }, (_, i) =>
      call("mcp_call_tool", { q: i }),
    );
    const decision = decideToolStep([step(...calls)], { maxSteps: MAX_STEPS });

    expect(decision.forceFinalResponse).toBe(true);
    expect(decision.totalToolCalls).toBe(RUNAWAY_TOOL_CALL_LIMIT);
  });

  test("the last allowed step is reserved for the answer", () => {
    const steps = Array.from({ length: MAX_STEPS - 1 }, (_, i) =>
      step(call("mcp_call_tool", { q: i })),
    );

    expect(
      decideToolStep(steps, { maxSteps: MAX_STEPS }).forceFinalResponse,
    ).toBe(true);
    expect(
      decideToolStep(steps.slice(0, -1), { maxSteps: MAX_STEPS })
        .forceFinalResponse,
    ).toBe(false);
  });
});
