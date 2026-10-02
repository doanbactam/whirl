/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import schema from "../schema";
import {
  MESSAGES_GATE,
  snapshotGateAllowed,
  type BillingCustomer,
} from "../inference/billing";
import {
  finalizeAssistantTurn,
  finalizeAssistantTurnArgs,
} from "../inference/finalize";

const billing = vi.hoisted(() => ({ get: vi.fn(), track: vi.fn() }));
vi.mock("autumn-js", () => ({
  Autumn: class {
    customers = { get: billing.get };
    track = billing.track;
  },
}));
vi.mock("../posthog", () => ({
  captureAiGeneration: vi.fn().mockResolvedValue(undefined),
  captureServerEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../braintrust", () => ({
  updateBraintrustSpan: vi.fn().mockResolvedValue(undefined),
  flushBraintrust: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../performance", () => ({
  captureBackendPerformance: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../supermemory", () => ({
  addSupermemoryDocument: vi.fn().mockResolvedValue(undefined),
}));

// Exercise the real finalizer and durable billing ledger without loading the
// unrelated streaming HTTP endpoints exported by inference.ts.
const modules = {
  ...import.meta.glob("../**/*.ts"),
  "../inference.ts": async () => ({
    finalizeAssistantTurn: internalAction({
      args: finalizeAssistantTurnArgs,
      handler: finalizeAssistantTurn,
    }),
  }),
};

async function prepare() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const threadId = await ctx.db.insert("threads", {
      userId: "alice",
      title: "Image pass",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const assistantId = await ctx.db.insert("messages", {
      threadId,
      userId: "alice",
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "complete",
    });
    return { threadId, assistantId };
  });
  return {
    t,
    args: {
      ...ids,
      streamId: "image-pass-test",
      customerId: "alice",
      model: "Image",
      isPaid: false,
      unmetered: false,
      incognito: true,
      memoryActive: false,
      memoryContainerTag: "test",
      usageFactor: 1,
      scaleFreeMessages: false,
      thinking: false,
      search: false,
      latencyMs: 100,
      cost: 0.0616,
      text: "",
      latestUserText: "Draw a cat",
      analyticsInput: [],
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("AUTUMN_SECRET_KEY", "test-only-placeholder");
  billing.get.mockResolvedValue({
    data: { features: { usage: { balance: 100 } } },
    error: null,
  });
  billing.track.mockResolvedValue({ error: null });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test.each([0, 0.5, 1, 2])(
  "a free image deducts one message with a %s usage multiplier",
  async (usageFactor) => {
    const { t, args } = await prepare();
    const turn = { ...args, usageFactor, scaleFreeMessages: true };
    await t.action(internal.inference.finalizeAssistantTurn, turn);
    expect(billing.track).toHaveBeenCalledExactlyOnceWith({
      customer_id: "alice",
      feature_id: "messages",
      value: 1,
      idempotency_key: `${args.assistantId}:${args.streamId}:message`,
    });
    await t.action(internal.inference.finalizeAssistantTurn, turn);
    expect(billing.track).toHaveBeenCalledTimes(1);
    const charges = await t.run((ctx) => ctx.db.query("usageCharges").take(2));
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({
      feature: "messages",
      amount: 1,
      status: "settled",
    });
  },
);

test("a free image still costs one message when the provider omits its dollar cost", async () => {
  const { t, args } = await prepare();
  await t.action(internal.inference.finalizeAssistantTurn, {
    ...args,
    cost: undefined,
  });
  expect(billing.track).toHaveBeenCalledWith(
    expect.objectContaining({ feature_id: "messages", value: 1 }),
  );
});

test("paid images use the dollar pool and free text retains its configured multiplier", async () => {
  const paid = await prepare();
  await paid.t.action(internal.inference.finalizeAssistantTurn, {
    ...paid.args,
    isPaid: true,
  });
  expect(billing.track).toHaveBeenCalledWith(
    expect.objectContaining({ feature_id: "ai_cost", value: 0.0616 }),
  );
  billing.track.mockClear();
  const free = await prepare();
  await free.t.action(internal.inference.finalizeAssistantTurn, {
    ...free.args,
    model: "Fast",
    scaleFreeMessages: true,
    usageFactor: 0.5,
  });
  expect(billing.track).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ feature_id: "messages", value: 0.5 }),
  );
});

test.each([
  [0, false],
  [0.5, false],
  [1, true],
] as const)(
  "the message gate requires one remaining message: %s",
  (balance, allowed) => {
    const customer: BillingCustomer = {
      id: "alice",
      created_at: 0,
      name: null,
      email: null,
      fingerprint: null,
      stripe_id: null,
      env: "sandbox" as BillingCustomer["env"],
      metadata: {},
      send_email_receipts: false,
      billing_controls: {},
      products: [],
      features: {
        messages: {
          id: "messages",
          name: "Messages",
          type: "single_use",
          balance,
        },
      },
    };
    expect(snapshotGateAllowed(customer, MESSAGES_GATE)).toBe(allowed);
  },
);
