// @ts-expect-error Bun provides this module to its test runner; the Next app
// intentionally does not include Bun's ambient types in its client tsconfig.
import { describe, expect, test } from "bun:test";

import {
  formatFreeMessagesLeft,
  formatMessageCount,
  readUsageSummary,
} from "./plan";

describe("readUsageSummary", () => {
  test("reads a free plan as concrete messages", () => {
    const summary = readUsageSummary({
      products: [],
      features: {
        messages: {
          included_usage: 15,
          balance: 7,
          next_reset_at: 1_800_000_000_000,
        },
      },
    });

    expect(summary.planId).toBeNull();
    expect(summary.freeMessages).toEqual({
      remaining: 7,
      included: 15,
      used: 8,
    });
    expect(summary.remainingPct).toBeCloseTo(46.67, 1);
    expect(summary.nextResetAt).toBe(1_800_000_000_000);
  });

  test("keeps paid plans on their usage pool", () => {
    const summary = readUsageSummary({
      products: [{ id: "turbo", name: "Turbo", status: "active" }],
      features: {
        usage: { included_usage: 20, balance: 5 },
        messages: { included_usage: 15, balance: 14 },
      },
    });

    expect(summary.planId).toBe("turbo");
    expect(summary.planName).toBe("Turbo");
    expect(summary.freeMessages).toBeNull();
    expect(summary.remainingPct).toBe(25);
  });

  test("falls back to the configured free message allowance", () => {
    const summary = readUsageSummary({ products: [], features: {} });

    expect(summary.freeMessages).toEqual({
      remaining: 15,
      included: 15,
      used: 0,
    });
  });
});

describe("free message copy", () => {
  test("uses friendly zero, singular, and plural copy", () => {
    expect(
      formatFreeMessagesLeft({ remaining: 0, included: 15, used: 15 }),
    ).toBe("No free messages left");
    expect(
      formatFreeMessagesLeft({ remaining: 1, included: 15, used: 14 }),
    ).toBe("1 free message left");
    expect(
      formatFreeMessagesLeft({ remaining: 8, included: 15, used: 7 }),
    ).toBe("8 free messages left");
    expect(formatMessageCount(1)).toBe("1 message");
    expect(formatMessageCount(4)).toBe("4 messages");
  });

  test("compact cut drops \"free\" so the user menu row stays one line", () => {
    const compact = { compact: true };
    expect(
      formatFreeMessagesLeft({ remaining: 0, included: 15, used: 15 }, compact),
    ).toBe("No messages left");
    expect(
      formatFreeMessagesLeft({ remaining: 1, included: 15, used: 14 }, compact),
    ).toBe("1 message left");
    expect(
      formatFreeMessagesLeft({ remaining: 15, included: 15, used: 0 }, compact),
    ).toBe("15 messages left");
  });
});
