import { expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";

import {
  buildFallbackReply,
  describeToolWork,
  repairFinalReply,
} from "../convex/inference/replyRepair";

const TRACE = {
  userId: "user_1",
  assistantId: "assistant_1",
  threadId: "thread_1",
  tier: "Auto",
  modelSlug: "openrouter/auto",
  toolCalls: 15,
};

function reply(text: string, provider: string) {
  return {
    content: text ? [{ type: "text" as const, text }] : [],
    // The shape that started all this: a clean `stop` over an empty body.
    finishReason: { unified: "stop" as const },
    usage: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
    warnings: [],
    providerMetadata: { openrouter: { provider } },
  };
}

function repairWith(model: MockLanguageModelV4) {
  return repairFinalReply({
    model,
    systemPrompt: "You are whirl.",
    messages: [{ role: "user", content: "which file holds the theme tokens?" }],
    toolNames: ["mcp_call_tool", "mcp_call_tool", "fetchUrl"],
    trace: TRACE,
  });
}

test("an empty body is a failure, not an answer, and reroutes the retry", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async ({ providerOptions }) => {
      const routing = (
        providerOptions?.openrouter as
          | { provider?: { ignore?: string[] } }
          | undefined
      )?.provider;
      // First pass: no routing preference, and Bedrock answers with nothing.
      if (!routing) return reply("", "amazon-bedrock");
      // Second pass must route around whoever just came back empty.
      expect(routing.ignore).toEqual(["amazon-bedrock"]);
      return reply("The theme tokens live in `app/globals.css`.", "fireworks");
    },
  });

  const repair = await repairWith(model);
  expect(repair.source).toBe("repair_retry");
  expect(repair.text).toBe("The theme tokens live in `app/globals.css`.");
  expect(repair.attempts.map((attempt) => attempt.empty)).toEqual([true, false]);
  expect(repair.attempts[0]?.provider).toBe("amazon-bedrock");
  expect(repair.attempts[0]?.finishReason).toBe("stop");
});

test("two empty bodies fall back to a line describing the work that happened", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async () => reply("", "amazon-bedrock"),
  });

  const repair = await repairWith(model);
  expect(repair.source).toBe("fallback");
  expect(repair.attempts).toHaveLength(2);
  expect(repair.attempts.every((attempt) => attempt.empty)).toBe(true);
  expect(repair.text).toContain("used your connected apps");
  expect(repair.text.trim().length).toBeGreaterThan(0);
});

test("a thrown repair still returns usable text rather than taking the turn down", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("upstream rate limited");
    },
  });

  const repair = await repairWith(model);
  expect(repair.source).toBe("fallback");
  expect(repair.attempts.every((attempt) => attempt.empty)).toBe(false);
  expect(repair.attempts[0]?.error).toContain("upstream rate limited");
});

test("a first-pass answer is taken as-is", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async () => reply("Both files, actually.", "anthropic"),
  });

  const repair = await repairWith(model);
  expect(repair.source).toBe("repair");
  expect(repair.text).toBe("Both files, actually.");
  expect(repair.attempts).toHaveLength(1);
});

test("tool work reads as plain English, deduped, in the order it happened", () => {
  expect(
    describeToolWork([
      "answerQuestion",
      "fetchUrl",
      "answerQuestion",
      "mcp_call_tool",
    ]),
  ).toBe("searched the web, read through some pages and used your connected apps");
  expect(describeToolWork(["getWeather"])).toBe("checked the weather");
});

test("unrecognized tools are left out rather than named to the user", () => {
  expect(describeToolWork(["some_integration_tool"])).toBe("");
  expect(buildFallbackReply(["some_integration_tool"])).toBe(
    "The model returned an empty response twice in a row, so there's no reply to show. Please send the message again.",
  );
});
