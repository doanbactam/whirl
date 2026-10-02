// @ts-expect-error Bun provides this module to its test runner; the Next app
// intentionally does not include Bun's ambient types in its client tsconfig.
import { describe, expect, test } from "bun:test";

import {
  assistantActivityState,
  furthestAssistantText,
} from "./assistant-state";

describe("furthestAssistantText", () => {
  test("keeps fast local text while the persisted stream is empty", () => {
    expect(
      furthestAssistantText(
        "A complete local burst",
        "",
        "",
      ),
    ).toBe("A complete local burst");
  });

  test("does not regress to a shorter persisted snapshot during handoff", () => {
    expect(
      furthestAssistantText(
        "The local stream is already here",
        "The local stream",
        "",
      ),
    ).toBe("The local stream is already here");
  });

  test("advances once the persisted snapshot moves further", () => {
    expect(
      furthestAssistantText(
        "The local stream",
        "The local stream has now persisted",
        "",
      ),
    ).toBe("The local stream has now persisted");
  });
});

describe("assistantActivityState", () => {
  const completedTool = {
    kind: "mcp",
    server: "Linear",
    tool: "get_issue",
    pending: false,
  };

  test("keeps activity in progress during a gap after a tool call", () => {
    expect(
      assistantActivityState({
        phases: [completedTool],
        terminal: false,
        canShowActivity: true,
        showText: true,
        richerActivityWorking: false,
      }),
    ).toEqual({ active: true, settled: false });
  });

  test("does not settle between consecutive tool calls", () => {
    const gap = assistantActivityState({
      phases: [completedTool],
      terminal: false,
      canShowActivity: true,
      showText: true,
      richerActivityWorking: false,
    });
    const nextCall = assistantActivityState({
      phases: [
        completedTool,
        {
          kind: "mcp",
          server: "Linear",
          tool: "list_comments",
          pending: true,
        },
      ],
      terminal: false,
      canShowActivity: true,
      showText: true,
      richerActivityWorking: false,
    });

    expect(gap).toEqual({ active: true, settled: false });
    expect(nextCall).toEqual({ active: true, settled: false });
  });

  test("settles compact activity only when the turn is terminal", () => {
    expect(
      assistantActivityState({
        phases: [completedTool],
        terminal: true,
        canShowActivity: false,
        showText: true,
        richerActivityWorking: false,
      }),
    ).toEqual({ active: false, settled: true });
  });

  test("does not mark a non-terminal interruption as completed", () => {
    expect(
      assistantActivityState({
        phases: [completedTool],
        terminal: false,
        canShowActivity: false,
        showText: true,
        richerActivityWorking: false,
      }),
    ).toEqual({ active: false, settled: false });
  });

  test("still hides plain activity as soon as prose is visible", () => {
    expect(
      assistantActivityState({
        phases: [],
        terminal: false,
        canShowActivity: true,
        showText: true,
        richerActivityWorking: false,
      }),
    ).toEqual({ active: false, settled: true });
  });
});
