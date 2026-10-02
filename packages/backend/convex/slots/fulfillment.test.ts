/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

const billing = vi.hoisted(() => ({
  get: vi.fn(),
  track: vi.fn(),
  create: vi.fn(),
}));
vi.mock("autumn-js", () => ({
  Autumn: class {
    customers = { get: billing.get };
    track = billing.track;
    balances = { create: billing.create };
  },
}));

const modules = import.meta.glob("../**/*.ts");
const owner = "https://test.whirl.chat|alice";
const free = { products: [], features: { messages: { balance: 15 } } };
const paid = { products: [{ id: "mini", status: "active" }], features: {} };

async function prepare(sku: string) {
  const t = convexTest(schema, modules);
  const prizeId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("slotPrizes", {
      owner,
      customerId: "alice",
      sku,
      source: "spin",
      status: "activating",
      createdAt: Date.now(),
      startsAt: Date.now(),
      expiresAt: Date.now() + 604_800_000,
    });
    await ctx.db.insert("slotWallets", {
      owner,
      customerId: "alice",
      tokens: 100,
      revision: 0,
      spins: 0,
      activationId: id,
    });
    return id;
  });
  return { t, prizeId };
}
async function prize(
  t: Awaited<ReturnType<typeof prepare>>["t"],
  prizeId: Id<"slotPrizes">,
) {
  return t.run((ctx) => ctx.db.get(prizeId));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("AUTUMN_SECRET_KEY", "test-only-placeholder");
  billing.get.mockResolvedValue({ data: free, error: null });
  billing.track.mockResolvedValue({ data: {}, error: null });
  billing.create.mockResolvedValue({ data: {}, error: null });
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("reward fulfillment", () => {
  test("an older lower-tier prize cannot activate after the user upgrades", async () => {
    const { t, prizeId } = await prepare("mini-month");
    await t.run((ctx) => ctx.db.patch(prizeId, { status: "ready" }));
    await expect(
      t.mutation(internal.slotRewards.beginInternal, {
        prizeId,
        owner,
        plan: "mega",
      }),
    ).rejects.toThrow("not available for your current plan");
    expect((await prize(t, prizeId))?.status).toBe("ready");

    // Recheck at fulfillment too, in case the tier changed after activation began.
    await t.run((ctx) => ctx.db.patch(prizeId, { status: "activating" }));
    billing.get.mockResolvedValue({
      data: { products: [{ id: "mega", status: "active" }] },
      error: null,
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await t.action(internal.slotActions.fulfill, { prizeId });
    expect(fetch).not.toHaveBeenCalled();
    expect((await prize(t, prizeId))?.status).toBe("ready");
  });

  test.each([
    null,
    {},
    { customer_id: "alice", payment_url: "https://checkout.example.test" },
  ])(
    "an incomplete or unexpected success response requires review: %j",
    async (body) => {
      const { t, prizeId } = await prepare("mini-week");
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify(body), { status: 200 }),
          ),
      );
      await t.action(internal.slotActions.fulfill, { prizeId });
      expect((await prize(t, prizeId))?.status).toBe("review");
    },
  );
  test("credits the real message balance with a stable idempotency key", async () => {
    const { t, prizeId } = await prepare("messages");
    await t.action(internal.slotActions.fulfill, { prizeId });
    expect(billing.track).toHaveBeenCalledExactlyOnceWith({
      customer_id: "alice",
      feature_id: "messages",
      value: -25,
      idempotency_key: `slot-prize:${prizeId}`,
    });
    expect((await prize(t, prizeId))?.status).toBe("active");
    await t.action(internal.slotActions.fulfill, { prizeId });
    expect(billing.track).toHaveBeenCalledTimes(1);
    expect(
      await t.run((ctx) => ctx.db.query("slotWallets").first()),
    ).not.toHaveProperty("activationId");
  });

  test("credit retries reuse their receipt key after a provider failure", async () => {
    const { t, prizeId } = await prepare("messages");
    billing.track.mockResolvedValueOnce({
      data: null,
      error: { message: "Timeout" },
    });
    await t.action(internal.slotActions.fulfill, { prizeId });
    expect((await prize(t, prizeId))?.status).toBe("ready");
    await t.run((ctx) => ctx.db.patch(prizeId, { status: "activating" }));
    await t.action(internal.slotActions.fulfill, { prizeId });
    expect(billing.track.mock.calls[0][0].idempotency_key).toBe(
      billing.track.mock.calls[1][0].idempotency_key,
    );
    expect((await prize(t, prizeId))?.status).toBe("active");
  });

  test("creates an extra-usage bucket for paid users who never bought credits", async () => {
    const { t, prizeId } = await prepare("credits");
    billing.get.mockResolvedValue({ data: paid, error: null });
    await t.action(internal.slotActions.fulfill, { prizeId });
    expect(billing.create).toHaveBeenCalledExactlyOnceWith({
      customer_id: "alice",
      feature_id: "extra_usage",
      granted_balance: 2,
    });
    expect(billing.track).not.toHaveBeenCalled();
    expect((await prize(t, prizeId))?.status).toBe("active");
  });

  test("an ambiguous first-balance grant cannot be replayed", async () => {
    const { t, prizeId } = await prepare("credits");
    billing.get.mockResolvedValue({ data: paid, error: null });
    billing.create.mockRejectedValue(
      new Error("Lost connection after sending"),
    );
    await t.action(internal.slotActions.fulfill, { prizeId });
    expect((await prize(t, prizeId))?.status).toBe("review");
    await expect(
      t.mutation(internal.slotRewards.beginInternal, {
        prizeId,
        owner,
        plan: "mini" as const,
      }),
    ).rejects.toThrow("billing check");
    await t.action(internal.slotActions.fulfill, { prizeId });
    expect(billing.create).toHaveBeenCalledTimes(1);
  });

  test("plan passes explicitly disable billing and automatic renewal", async () => {
    const { t, prizeId } = await prepare("mini-week");
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ customer_id: "alice", payment_url: null }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    await t.action(internal.slotActions.fulfill, { prizeId });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(
      "https://api.useautumn.com/v1/billing.attach",
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      customer_id: "alice",
      plan_id: "mini",
      customize: { price: null, free_trial: null },
      ends_at: Date.now() + 604_800_000,
      no_billing_changes: true,
      redirect_mode: "never",
      plan_schedule: "immediate",
    });
    expect((await prize(t, prizeId))?.status).toBe("active");
  });

  test.each([500, 502])(
    "an ambiguous plan response (%s) requires reconciliation",
    async (status) => {
      const { t, prizeId } = await prepare("platinum-month");
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response("Failed", { status }));
      vi.stubGlobal("fetch", fetch);
      await t.action(internal.slotActions.fulfill, { prizeId });
      expect((await prize(t, prizeId))?.status).toBe("review");
      await t.action(internal.slotActions.fulfill, { prizeId });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  test("a rejected plan request stays in the prize tray", async () => {
    const { t, prizeId } = await prepare("mini-week");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Unavailable", { status: 400 })),
    );
    await t.action(internal.slotActions.fulfill, { prizeId });
    expect((await prize(t, prizeId))?.status).toBe("ready");
  });

  test("an existing subscription or a billing outage never becomes a free-plan assumption", async () => {
    const { t, prizeId } = await prepare("mini-week");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    billing.get.mockResolvedValue({ data: paid, error: null });
    await t.action(internal.slotActions.fulfill, { prizeId });
    expect(fetch).not.toHaveBeenCalled();
    expect((await prize(t, prizeId))?.status).toBe("ready");
    billing.get.mockResolvedValue({ data: null, error: "unavailable" });
    await t.run((ctx) => ctx.db.patch(prizeId, { status: "activating" }));
    await t.action(internal.slotActions.fulfill, { prizeId });
    expect(fetch).not.toHaveBeenCalled();
    expect((await prize(t, prizeId))?.status).toBe("ready");
  });

  test("a killed plan activation is recovered to review and releases the account lock", async () => {
    const { t, prizeId } = await prepare("mega-month");
    await t.mutation(internal.slotRewards.recover, {
      prizeId,
      startsAt: Date.now(),
    });
    expect((await prize(t, prizeId))?.status).toBe("review");
    expect(
      await t.run((ctx) => ctx.db.query("slotWallets").first()),
    ).not.toHaveProperty("activationId");
  });

  test("a paid user can keep a pass but cannot replace their subscription with it", async () => {
    const { t, prizeId } = await prepare("turbo-month");
    await t.run(async (ctx) => {
      await ctx.db.patch(prizeId, { status: "ready" });
      const wallet = await ctx.db.query("slotWallets").first();
      await ctx.db.patch(wallet!._id, { activationId: undefined });
    });
    await expect(
      t.mutation(internal.slotRewards.beginInternal, {
        prizeId,
        owner,
        plan: "mini" as const,
      }),
    ).rejects.toThrow("already have a paid plan");
    expect((await prize(t, prizeId))?.status).toBe("ready");
  });
});
