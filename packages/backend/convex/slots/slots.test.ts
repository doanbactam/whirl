/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import {
  currentSlotPlan,
  eligible,
  PERKS,
  perkExpiry,
  perkPrice,
  resolveSpin,
  type SlotPlan,
} from "./catalog";
import {
  guestOwner,
  newRedemptionCode,
  normalizeRedemptionCode,
} from "./guest";

const modules = import.meta.glob("../**/*.ts");
const billing = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("autumn-js", () => ({
  Autumn: class {
    customers = { get: billing.get };
  },
}));
const identity = {
  subject: "alice",
  issuer: "https://test.whirl.chat",
  tokenIdentifier: "https://test.whirl.chat|alice",
};
const guestKey = "a".repeat(64);
const owner = guestOwner(guestKey);
const code = "WHIRL-1234-5678-ABCD-EF01-2345-6789";

function testDb() {
  return convexTest(schema, modules);
}
async function fund(
  t: ReturnType<typeof testDb>,
  accountOwner: string,
  tokens = 20_000,
) {
  return t.run((ctx) =>
    ctx.db.insert("slotWallets", {
      owner: accountOwner,
      customerId: accountOwner.startsWith("guest:") ? accountOwner : "alice",
      tokens,
      revision: 0,
      spins: 0,
    }),
  );
}
function buyArgs(
  sku: string,
  accountOwner = owner,
  requestId = "request-0001",
) {
  return {
    owner: accountOwner,
    customerId: accountOwner,
    plan: "free" as const,
    requestId,
    revision: 0,
    sku,
    expectedPrice: PERKS.find((perk) => perk.id === sku)!.price,
    redemptionCode: code,
  };
}

beforeEach(() => {
  vi.stubEnv("AUTUMN_SECRET_KEY", "test-only-placeholder");
  billing.get
    .mockReset()
    .mockResolvedValue({ data: { products: [], features: {} }, error: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("game and economy", () => {
  test("upgrade prices fall with the current tier for matching pass durations", () => {
    const platinum = PERKS.find((perk) => perk.id === "platinum-month")!;
    expect(
      (["free", "mini", "turbo", "mega"] as const).map((plan) =>
        perkPrice(platinum, plan),
      ),
    ).toEqual([5_000, 4_500, 4_000, 3_000]);
    const megaWeek = PERKS.find((perk) => perk.id === "mega-week")!;
    expect(
      (["free", "mini", "turbo"] as const).map((plan) =>
        perkPrice(megaWeek, plan),
      ),
    ).toEqual([600, 450, 300]);
    for (const perk of PERKS) {
      expect(perkPrice(perk, "free")).toBe(perk.price);
      if (perk.plan) expect(perkPrice(perk, perk.plan)).toBe(perk.price);
      else expect(perkPrice(perk, "mega")).toBe(perk.price);
    }
  });

  test.each([
    ["mini", "turbo-week", 150],
    ["mini", "mega-month", 1_500],
    ["turbo", "mega-week", 300],
    ["turbo", "mega-month", 1_000],
    ["mega", "platinum-month", 3_000],
  ] as const)(
    "%s buys %s for %i tokens with one debit and one stock reservation",
    async (plan, sku, price) => {
      const t = testDb();
      await fund(t, identity.tokenIdentifier, price);
      billing.get.mockResolvedValue({
        data: { products: [{ id: plan, status: "active" }] },
        error: null,
      });
      const signedIn = t.withIdentity(identity);
      const args = {
        sku,
        expectedPrice: price,
        requestId: "upgrade-purchase",
        revision: 0,
      };
      const result = await signedIn.action(api.slotActions.play, args);
      expect(result.spent).toBe(price);
      expect(result.balance).toBe(0);
      const repeat = await signedIn.action(api.slotActions.play, args);
      expect(repeat._id).toBe(result._id);
      const account = await signedIn.query(api.slots.account, {});
      expect(account?.tokens).toBe(0);
      expect(account?.prizes).toHaveLength(1);
      const stock = (await t.query(api.slots.shop)).find(
        (perk) => perk.id === sku,
      )!;
      expect(stock.remaining).toBe(stock.stock - 1);
    },
  );

  test.each([1_000, 1, undefined])(
    "a stale or forged quote (%s) cannot alter the server price",
    async (expectedPrice) => {
      const t = testDb();
      await fund(t, identity.tokenIdentifier);
      billing.get.mockResolvedValue({
        data: { products: [{ id: "mini", status: "active" }] },
        error: null,
      });
      const signedIn = t.withIdentity(identity);
      await expect(
        signedIn.action(api.slotActions.play, {
          sku: "mega-month",
          expectedPrice,
          requestId: "stale-price-request",
          revision: 0,
        }),
      ).rejects.toThrow("price changed");
      const account = await signedIn.query(api.slots.account, {});
      expect(account?.tokens).toBe(20_000);
      expect(account?.prizes).toHaveLength(0);
      expect(
        (await t.query(api.slots.shop)).find((perk) => perk.id === "mega-month")
          ?.remaining,
      ).toBe(10);
    },
  );

  test("an upgrade still requires enough tokens for the discounted price", async () => {
    const t = testDb();
    await fund(t, identity.tokenIdentifier, 999);
    await expect(
      t.mutation(internal.slots.playInternal, {
        ...buyArgs("mega-month", identity.tokenIdentifier),
        plan: "turbo",
        expectedPrice: 1_000,
      }),
    ).rejects.toThrow("enough tokens");
    expect(
      (await t.withIdentity(identity).query(api.slots.account, {}))?.tokens,
    ).toBe(999);
    expect(
      (await t.query(api.slots.shop)).find((perk) => perk.id === "mega-month")
        ?.remaining,
    ).toBe(10);
  });

  test("the exact outcome space matches the displayed odds and 85.5% token return", () => {
    const counts = new Map<string, number>();
    let total = 0;
    for (let ticket = 0; ticket < 10_000; ticket++) {
      const result = resolveSpin(ticket, ticket % 5);
      const key = result.drop ? "perk" : String(result.payout);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      total += result.payout;
      if (!result.drop && result.payout === 0)
        expect(new Set(result.reels).size).toBe(3);
      if (result.payout === 10) expect(new Set(result.reels).size).toBe(2);
      if (result.payout > 10 || result.drop)
        expect(new Set(result.reels).size).toBe(1);
    }
    expect(Object.fromEntries(counts)).toEqual({
      "0": 6_200,
      "10": 2_200,
      "25": 1_000,
      "50": 300,
      "150": 90,
      "1000": 10,
      perk: 200,
    });
    expect(total / 100_000).toBe(0.855);
  });

  test("monthly passes clamp correctly at the end of a calendar month", () => {
    const perk = PERKS.find((p) => p.id === "mini-month")!;
    expect(
      new Date(perkExpiry(perk, Date.UTC(2027, 0, 31, 12))!).toISOString(),
    ).toBe("2027-02-28T12:00:00.000Z");
    expect(
      new Date(perkExpiry(perk, Date.UTC(2028, 0, 31, 12))!).toISOString(),
    ).toBe("2028-02-29T12:00:00.000Z");
  });

  test("free and paid perks keep their eligibility restrictions", () => {
    expect(
      eligible(
        PERKS.find((p) => p.id === "credits")!,
        "free",
      ),
    ).toBe(false);
    expect(
      eligible(
        PERKS.find((p) => p.id === "image")!,
        "mini",
      ),
    ).toBe(false);
    expect(PERKS.filter((p) => p.months === 1).map((p) => p.plan)).toEqual([
      "mini",
      "turbo",
      "mega",
      "platinum",
    ]);
  });

  test.each([
    ["free", ["mini", "turbo", "mega", "platinum"]],
    ["mini", ["mini", "turbo", "mega", "platinum"]],
    ["turbo", ["turbo", "mega", "platinum"]],
    ["mega", ["mega", "platinum"]],
    ["platinum", ["platinum"]],
    ["platinum_max", []],
  ] as [SlotPlan, string[]][])(
    "%s never sees lower-tier passes",
    (plan, expected) => {
      const available = PERKS.filter(
        (perk) => perk.plan && eligible(perk, plan),
      );
      expect([...new Set(available.map((perk) => perk.plan))]).toEqual(
        expected,
      );
      expect(available.every((perk) => eligible(perk, plan))).toBe(true);
    },
  );

  test("the highest active tier wins over product order, expired plans, and add-ons", () => {
    expect(
      currentSlotPlan({
        products: [
          { id: "mini", status: "active" },
          { id: "platinum_max", status: "expired" },
          { id: "platinum", status: "active", is_add_on: true },
          { id: "mega", status: "past_due" },
          { id: "turbo", status: "trialing" },
        ],
      }),
    ).toBe("mega");
    expect(
      currentSlotPlan({
        products: [{ id: "platinum_max", status: "trialing" }],
      }),
    ).toBe("platinum_max");
  });

  test.each(["mini-week", "mini-month", "turbo-week", "turbo-month"])(
    "the public action rejects %s for Mega without spending tokens or stock",
    async (sku) => {
      const t = testDb();
      await fund(t, identity.tokenIdentifier);
      billing.get.mockResolvedValue({
        data: { products: [{ id: "mega", status: "active" }] },
        error: null,
      });
      const signedIn = t.withIdentity(identity);
      await expect(
        signedIn.action(api.slotActions.play, {
          sku,
          requestId: "downgrade-purchase",
          revision: 0,
        }),
      ).rejects.toThrow("not available for your current plan");
      const account = await signedIn.query(api.slots.account, {});
      expect(account?.tokens).toBe(20_000);
      expect(account?.prizes).toHaveLength(0);
      const stock = (await t.query(api.slots.shop)).find(
        (perk) => perk.id === sku,
      )!;
      expect(stock.remaining).toBe(stock.stock);
    },
  );

  test("a perk spin refunds its stake when only lower-tier stock remains", async () => {
    const t = testDb();
    await t.run(async (ctx) => {
      for (const perk of PERKS.filter((perk) => eligible(perk, "mega")))
        await ctx.db.insert("slotStock", { sku: perk.id, claimed: perk.stock });
    });
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const result = await t.mutation(internal.slots.playInternal, {
      ...buyArgs("messages"),
      sku: undefined,
      plan: "mega",
    });
    expect(result.sku).toBeUndefined();
    expect(result.payout).toBe(10);
    expect(result.balance).toBe(100);
    expect(
      (await t.query(api.slots.shop)).find((perk) => perk.id === "mini-week")
        ?.remaining,
    ).toBe(100);
  });

  test("a guest gets 100 tokens only once and a repeat request is idempotent", async () => {
    const t = testDb();
    const first = await t.mutation(
      internal.slots.playInternal,
      buyArgs("messages"),
    );
    const repeat = await t.mutation(
      internal.slots.playInternal,
      buyArgs("messages"),
    );
    expect(first.balance).toBe(40);
    expect(repeat._id).toBe(first._id);
    const account = await t.query(api.slots.account, { guestKey });
    expect(account?.tokens).toBe(40);
    expect(account?.prizes).toHaveLength(1);
    expect(account?.prizes[0].redemptionCode).toBe(code);
  });

  test("rejects overspending without consuming stock or granting a prize", async () => {
    const t = testDb();
    await expect(
      t.mutation(internal.slots.playInternal, buyArgs("mini-month")),
    ).rejects.toThrow("enough tokens");
    expect(
      (await t.query(api.slots.shop)).find((p) => p.id === "mini-month")
        ?.remaining,
    ).toBe(40);
    expect((await t.query(api.slots.account, { guestKey }))?.tokens).toBe(100);
  });

  test("a stale revision cannot spend the wallet twice", async () => {
    const t = testDb();
    await fund(t, owner);
    await t.mutation(internal.slots.playInternal, buyArgs("messages"));
    await expect(
      t.mutation(
        internal.slots.playInternal,
        buyArgs("messages", owner, "request-0002"),
      ),
    ).rejects.toThrow("another tab");
  });

  test("paid users cannot buy free-only rewards, and guests cannot buy paid-only credits", async () => {
    const t = testDb();
    await fund(t, owner);
    await expect(
      t.mutation(internal.slots.playInternal, {
        ...buyArgs("messages"),
        plan: "mini" as const,
      }),
    ).rejects.toThrow("not available for your current plan");
    await expect(
      t.mutation(internal.slots.playInternal, buyArgs("credits")),
    ).rejects.toThrow("not available for your current plan");
  });

  test("at most two concurrent Platinum purchases can succeed", async () => {
    const t = testDb();
    for (const user of ["one", "two", "three"]) await fund(t, user);
    const attempts = await Promise.allSettled(
      ["one", "two", "three"].map((user) =>
        t.mutation(
          internal.slots.playInternal,
          buyArgs("platinum-month", user, `request-${user}`),
        ),
      ),
    );
    expect(
      attempts.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(2);
    expect(
      (await t.query(api.slots.shop)).find((p) => p.id === "platinum-month")
        ?.remaining,
    ).toBe(0);
  });

  test("a direct perk drop reserves stock and a spin cooldown applies", async () => {
    const t = testDb();
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const result = await t.mutation(internal.slots.playInternal, {
      ...buyArgs("messages"),
      sku: undefined,
    });
    expect(result.sku).toBeDefined();
    expect(result.reels).toEqual(["gift", "gift", "gift"]);
    expect(result.balance).toBe(90);
    const stock = (await t.query(api.slots.shop)).find(
      (p) => p.id === result.sku,
    )!;
    expect(stock.remaining).toBe(stock.stock - 1);
    await expect(
      t.mutation(internal.slots.playInternal, {
        ...buyArgs("messages"),
        sku: undefined,
        requestId: "request-next",
        revision: 1,
      }),
    ).rejects.toThrow("settle");
  });

  test("an empty eligible shelf returns the spin stake", async () => {
    const t = testDb();
    await t.run(async (ctx) => {
      for (const perk of PERKS)
        await ctx.db.insert("slotStock", { sku: perk.id, claimed: perk.stock });
    });
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const result = await t.mutation(internal.slots.playInternal, {
      ...buyArgs("messages"),
      sku: undefined,
    });
    expect(result.balance).toBe(100);
    expect(result.payout).toBe(10);
    expect(result.sku).toBeUndefined();
  });

  test("receipt retention is bounded and evicted requests cannot be replayed", async () => {
    const t = testDb();
    await fund(t, owner);
    for (let i = 0; i < 22; i++)
      await t.mutation(internal.slots.playInternal, {
        ...buyArgs("messages"),
        requestId: `request-${i.toString().padStart(4, "0")}`,
        redemptionCode: undefined,
        revision: i,
      });
    expect(
      (await t.query(api.slots.account, { guestKey }))?.history,
    ).toHaveLength(20);
    await expect(
      t.mutation(internal.slots.playInternal, {
        ...buyArgs("messages"),
        requestId: "request-0000",
      }),
    ).rejects.toThrow("another tab");
  });
});

describe("guest prize codes", () => {
  test("a lower-tier guest code stays unclaimed when redeemed by a higher-tier account", async () => {
    const t = testDb();
    await fund(t, owner);
    await t.mutation(internal.slots.playInternal, buyArgs("mini-week"));
    billing.get.mockResolvedValue({
      data: { products: [{ id: "mega", status: "active" }] },
      error: null,
    });
    const result = await t
      .withIdentity(identity)
      .action(api.slotCodes.redeem, { code });
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining("not available for your current plan"),
    });
    const saved = await t.query(api.slotCodes.guestPrizes, { guestKey });
    expect(saved).toHaveLength(1);
    expect(saved[0].redeemedBy).toBeUndefined();
    expect(
      (await t.withIdentity(identity).query(api.slots.account, {}))?.prizes,
    ).toHaveLength(0);
  });

  test("codes have 96 random bits and tolerate spaces, case and hyphens", () => {
    const generated = newRedemptionCode();
    expect(generated).toMatch(/^WHIRL(?:-[A-F0-9]{4}){6}$/);
    expect(
      normalizeRedemptionCode(
        `  ${generated.toLowerCase().replaceAll("-", " ")} `,
      ),
    ).toBe(generated);
    expect(() => guestOwner("guessable")).toThrow();
    expect(() => normalizeRedemptionCode("WHIRL-NOPE")).toThrow();
  });

  test("unregistered users can play without billing and receive a redeemable code", async () => {
    const t = testDb();
    const result = await t.action(api.slotActions.play, {
      guestKey,
      requestId: "guest-purchase-1",
      revision: 0,
      sku: "messages",
      expectedPrice: 60,
    });
    expect(result.balance).toBe(40);
    const prizes = await t.query(api.slotCodes.guestPrizes, { guestKey });
    expect(prizes[0].redemptionCode).toMatch(/^WHIRL(?:-[A-F0-9]{4}){6}$/);
  });

  test("guest wallet capabilities isolate private balances and codes", async () => {
    const t = testDb();
    await t.mutation(internal.slots.playInternal, buyArgs("messages"));
    expect(await t.query(api.slots.account, {})).toBeNull();
    expect(
      await t.query(api.slotCodes.guestPrizes, { guestKey: "b".repeat(64) }),
    ).toEqual([]);
    expect(
      (await t.withIdentity(identity).query(api.slots.account, { guestKey }))
        ?.prizes,
    ).toEqual([]);
  });

  test("redemption requires sign-in, transfers ownership, and never consumes more stock", async () => {
    const t = testDb();
    await t.mutation(internal.slots.playInternal, buyArgs("messages"));
    await expect(t.action(api.slotCodes.redeem, { code })).rejects.toThrow(
      "Sign in",
    );
    const signedIn = t.withIdentity(identity);
    const result = await signedIn.action(api.slotCodes.redeem, {
      code: code.toLowerCase(),
    });
    expect(result.ok).toBe(true);
    const prize = (await signedIn.query(api.slots.account, {}))?.prizes[0];
    expect(prize?.owner).toBe(identity.tokenIdentifier);
    expect(prize?.status).toBe("ready");
    expect(await t.query(api.slotCodes.guestPrizes, { guestKey })).toEqual([]);
    expect(
      (await t.query(api.slots.shop)).find((p) => p.id === "messages")
        ?.remaining,
    ).toBe(999);
  });

  test("simultaneous redeemers cannot both claim the same code", async () => {
    const t = testDb();
    await t.mutation(internal.slots.playInternal, buyArgs("messages"));
    const bob = t.withIdentity({
      subject: "bob",
      issuer: identity.issuer,
      tokenIdentifier: `${identity.issuer}|bob`,
    });
    const results = await Promise.all([
      t.withIdentity(identity).action(api.slotCodes.redeem, { code }),
      bob.action(api.slotCodes.redeem, { code }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)?.message).toContain(
      "already been redeemed",
    );
  });

  test("repeat redemption by the same owner is safe and unknown codes are rate-limited", async () => {
    vi.useFakeTimers();
    const t = testDb();
    await t.mutation(internal.slots.playInternal, buyArgs("messages"));
    const signedIn = t.withIdentity(identity);
    expect((await signedIn.action(api.slotCodes.redeem, { code })).ok).toBe(
      true,
    );
    vi.advanceTimersByTime(2_001);
    expect((await signedIn.action(api.slotCodes.redeem, { code })).ok).toBe(
      true,
    );
    vi.advanceTimersByTime(2_001);
    expect(
      (
        await signedIn.action(api.slotCodes.redeem, {
          code: "WHIRL-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA",
        })
      ).ok,
    ).toBe(false);
    expect(await signedIn.action(api.slotCodes.redeem, { code })).toMatchObject(
      {
        ok: false,
        message: expect.stringContaining("wait a moment"),
      },
    );
    expect((await signedIn.query(api.slots.account, {}))?.prizes).toHaveLength(
      1,
    );
  });

  test("a claimed prize cannot be activated by a different owner", async () => {
    const t = testDb();
    await t.mutation(internal.slots.playInternal, buyArgs("messages"));
    const result = await t
      .withIdentity(identity)
      .action(api.slotCodes.redeem, { code });
    if (!result.ok) throw new Error("Expected redemption");
    await expect(
      t.mutation(internal.slotRewards.beginInternal, {
        prizeId: result.prizeId,
        owner: "another-owner",
        plan: "free" as const,
      }),
    ).rejects.toThrow("does not belong");
  });

  test("image access stacks and expires, including in the server gate", async () => {
    vi.useFakeTimers();
    const t = testDb();
    await fund(t, identity.tokenIdentifier);
    await t.mutation(internal.slots.playInternal, {
      ...buyArgs("image", identity.tokenIdentifier),
      customerId: "alice",
      redemptionCode: undefined,
    });
    const account = await t.withIdentity(identity).query(api.slots.account, {});
    const prizeId = account!.prizes[0]._id;
    await t.mutation(internal.slotRewards.beginInternal, {
      prizeId,
      owner: identity.tokenIdentifier,
      plan: "free" as const,
    });
    expect(
      await t.query(internal.slots.imageAccessInternal, {
        customerId: "alice",
      }),
    ).toBe(true);
    expect(await t.withIdentity(identity).query(api.slots.imageAccess)).toBe(
      Date.now() + 86_400_000,
    );
    await t.mutation(internal.slotRewards.beginInternal, {
      prizeId,
      owner: identity.tokenIdentifier,
      plan: "free" as const,
    });
    vi.advanceTimersByTime(86_400_001);
    expect(
      await t.query(internal.slots.imageAccessInternal, {
        customerId: "alice",
      }),
    ).toBe(false);
    await t.finishInProgressScheduledFunctions();
  });
});
