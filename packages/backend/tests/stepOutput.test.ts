import { expect, test } from "bun:test";

import { StepOutputBuffer } from "../convex/inference/stepOutput";

const LEAKED_CALL =
  '{"name": "search_code", "arguments": {"query": "repo:acme/storefront path:app/auth", "perPage": 10}}';

test("releases a clean final answer", () => {
  const buffer = new StepOutputBuffer();
  buffer.add("Drafted it to Diego. Nothing was sent.");
  expect(buffer.finish("stop")).toBe("Drafted it to Diego. Nothing was sent.");
});

test("drops narration from a step that proceeds to a tool call", () => {
  const buffer = new StepOutputBuffer();
  buffer.add("Looking up Diego, then I will search Gmail.");
  buffer.markToolCall();
  expect(buffer.finish("tool-calls")).toBe("");
});

test("drops narration when the step ended on tool calls the buffer never saw", () => {
  // Rejected calls to a deactivated tool can finish a step without any tool
  // events reaching us; the provider's finishReason is the backstop.
  const buffer = new StepOutputBuffer();
  buffer.add("Finding Diego on the cancelled Stripe seats, then drafting.");
  expect(buffer.finish("tool-calls")).toBe("");
});

// Content is never judged here. Text-sniffing for leaked scratch work kept
// destroying finished replies — an answer about env vars, about a failed tool
// call, about a JSON body — so what a reply may say is the system prompt's
// job (OUTPUT_HYGIENE_SYSTEM_INSTRUCTION), not this buffer's.
test("a finished step is released whatever it says", () => {
  for (const answer of [
    "For the frontend you need NEXT_PUBLIC_CONVEX_URL and CLERK_SECRET_KEY.",
    "The system instruction for your bot lives in prompts.ts.",
    "Tool use for this reply is over, so here's the summary.",
    `Send this body: ${LEAKED_CALL}`,
  ]) {
    const buffer = new StepOutputBuffer();
    buffer.add(answer);
    expect(buffer.finish("stop")).toBe(answer);
  }
});

test("an empty step stays empty", () => {
  const buffer = new StepOutputBuffer();
  expect(buffer.finish("stop")).toBe("");
});
