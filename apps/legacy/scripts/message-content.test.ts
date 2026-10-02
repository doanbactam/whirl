// @ts-nocheck -- Bun supplies this module at test runtime; app typecheck is Node-only.
import { describe, expect, test } from "bun:test";

import {
  assistantHistoryEvents,
  historyEventsBlock,
  messageContentForModel,
  withHistoryEvents,
} from "@whirl/backend/convex/inference/attachments";

describe("assistantHistoryEvents", () => {
  test("tells a follow-up model not to repeat completed integration actions", () => {
    const events = assistantHistoryEvents({
      content: "Done.",
      phases: [
        {
          kind: "mcp",
          server: "Gmail",
          tool: "draft_email",
          ok: true,
        },
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toContain("Gmail · draft_email (succeeded)");
    expect(events[0]).toContain("Do not repeat the same action");
  });

  test("does not replay pending integration actions", () => {
    const events = assistantHistoryEvents({
      content: "Still working.",
      phases: [{ kind: "mcp", server: "Stripe", tool: "search", pending: true }],
    });

    expect(events).toEqual([]);
  });

  test("records a painted image with its stored URL", () => {
    const events = assistantHistoryEvents({
      content: "",
      phases: [
        {
          kind: "image",
          prompt: "a platinum badge",
          images: ["https://example.com/api/storage/abc"],
        },
      ],
    });

    expect(events[0]).toContain("a platinum badge");
    expect(events[0]).toContain("https://example.com/api/storage/abc");
  });
});

describe("messageContentForModel", () => {
  test("leaves assistant turns as pure prose", () => {
    const content = messageContentForModel({
      role: "assistant",
      content: "Here you go.",
    });

    expect(content).toBe("Here you go.");
  });
});

describe("withHistoryEvents", () => {
  test("fronts the user turn with a labelled log block", () => {
    const content = withHistoryEvents("make another one", ["whirl did a thing"]);

    expect(Array.isArray(content)).toBe(true);
    expect(content[0].text).toBe(historyEventsBlock(["whirl did a thing"]));
    expect(content[0].text).toContain("<whirl_system_log>");
    expect(content[0].text).toContain("never write a link");
    expect(content[1]).toEqual({ type: "text", text: "make another one" });
  });

  test("passes content through untouched when nothing happened", () => {
    expect(withHistoryEvents("hey", [])).toBe("hey");
  });
});
