// @ts-expect-error Bun provides this module to its test runner; the Next app
// intentionally does not include Bun's ambient types in its client tsconfig.
import { describe, expect, test } from "bun:test";

import { jsonEqual } from "./json-equal";
import { reconcileMessageIdentities } from "./message-identity";
import type { ChatMessage } from "./messages";

function message(
  id: string,
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    role: "assistant",
    content: `reply ${id}`,
    createdAt: 1,
    status: "complete",
    ...overrides,
  };
}

/* A fresh snapshot off the wire: same values, all-new object identities,
   which is exactly what Convex hands back on every update. */
function resend(messages: ChatMessage[]): ChatMessage[] {
  return JSON.parse(JSON.stringify(messages)) as ChatMessage[];
}

describe("jsonEqual", () => {
  test("compares nested arrays and objects by value", () => {
    expect(
      jsonEqual(
        { phases: [{ kind: "search", items: [{ url: "a" }] }] },
        { phases: [{ kind: "search", items: [{ url: "a" }] }] },
      ),
    ).toBe(true);
    expect(
      jsonEqual(
        { phases: [{ kind: "search", items: [{ url: "a" }] }] },
        { phases: [{ kind: "search", items: [{ url: "b" }] }] },
      ),
    ).toBe(false);
  });

  test("separates missing keys from undefined values", () => {
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonEqual({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(
      false,
    );
  });

  test("does not confuse an array with an object", () => {
    expect(jsonEqual([], {})).toBe(false);
    expect(jsonEqual(null, {})).toBe(false);
  });
});

describe("reconcileMessageIdentities", () => {
  test("hands back the same array when nothing changed", () => {
    const previous = [message("a"), message("b")];
    expect(reconcileMessageIdentities(previous, resend(previous))).toBe(
      previous,
    );
  });

  test("keeps settled rows by reference when only the tail moves", () => {
    const previous = [message("a"), message("b", { content: "half" })];
    const next = resend(previous);
    next[1].content = "half a reply";

    const result = reconcileMessageIdentities(previous, next);

    expect(result).not.toBe(previous);
    /* The whole point: untouched history keeps its identity, so its rows
       skip re-rendering while the live reply streams. */
    expect(result[0]).toBe(previous[0]);
    expect(result[1]).toBe(next[1]);
    expect(result[1].content).toBe("half a reply");
  });

  test("notices a phase landing deep inside a message", () => {
    const previous = [message("a", { phases: [{ kind: "search", ok: true }] })];
    const next = resend(previous);
    next[0].phases = [{ kind: "search", ok: true, sources: 3 }];

    const result = reconcileMessageIdentities(previous, next);

    expect(result[0]).toBe(next[0]);
    expect(result[0].phases?.[0].sources).toBe(3);
  });

  test("carries a new message in without disturbing the ones before it", () => {
    const previous = [message("a"), message("b")];
    const next = [...resend(previous), message("c")];

    const result = reconcileMessageIdentities(previous, next);

    expect(result).toHaveLength(3);
    expect(result[0]).toBe(previous[0]);
    expect(result[1]).toBe(previous[1]);
    expect(result[2].id).toBe("c");
  });

  test("drops rows that a rollback removed", () => {
    const previous = [message("a"), message("b"), message("c")];
    const next = resend([previous[0]]);

    const result = reconcileMessageIdentities(previous, next);

    expect(result.map((entry) => entry.id)).toEqual(["a"]);
    expect(result[0]).toBe(previous[0]);
  });

  test("reuses identity but reports the change when a row is reordered", () => {
    const previous = [message("a"), message("b")];
    const next = [resend(previous)[1], resend(previous)[0]];

    const result = reconcileMessageIdentities(previous, next);

    expect(result).not.toBe(previous);
    expect(result.map((entry) => entry.id)).toEqual(["b", "a"]);
  });

  test("has no previous snapshot to reuse on the first render", () => {
    const next = [message("a")];
    expect(reconcileMessageIdentities(undefined, next)).toBe(next);
    expect(reconcileMessageIdentities([], next)).toBe(next);
  });
});
