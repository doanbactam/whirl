// @ts-expect-error Bun provides this module to its test runner; the Convex
// tsconfig intentionally does not include Bun's ambient types.
import { describe, expect, test } from "bun:test";

import {
  defaultLockedModel,
  isClearedForLockedThread,
  NO_LOCKED_MODELS,
  type LockedModelPolicy,
} from "./lockedPolicy";

/* This module keeps the composer's picker and the turn handler in
   agreement, so what's tested is the agreement itself: an allowlist that
   stays shut until the server has answered, two namespaces that can't be
   confused for each other, and a fallback the handler will actually take. */

const policy = (over: Partial<LockedModelPolicy> = {}): LockedModelPolicy => ({
  tiers: ["Fast", "Basic", "Max"],
  slugs: ["moonshotai/kimi-k2.6"],
  known: true,
  ...over,
});

describe("isClearedForLockedThread", () => {
  test("clears a tier the server named", () => {
    for (const tier of ["Fast", "Basic", "Max"]) {
      expect(isClearedForLockedThread(tier, policy())).toBe(true);
    }
  });

  test("refuses a tier the server left out", () => {
    expect(isClearedForLockedThread("Auto", policy())).toBe(false);
    expect(isClearedForLockedThread("Image", policy())).toBe(false);
  });

  test("clears a catalog slug only when it's on the list", () => {
    expect(isClearedForLockedThread("moonshotai/kimi-k2.6", policy())).toBe(true);
    expect(isClearedForLockedThread("openai/gpt-5", policy())).toBe(false);
  });

  test("keeps the two namespaces apart", () => {
    // A tier key can't be smuggled in through the slug list, and a slug
    // can't ride the tier list — they're told apart by the slash.
    expect(
      isClearedForLockedThread("Auto", policy({ slugs: ["Auto"] })),
    ).toBe(false);
    expect(
      isClearedForLockedThread("some/model", policy({ tiers: ["some/model"] })),
    ).toBe(false);
  });

  test("refuses an unknown model outright", () => {
    expect(isClearedForLockedThread("", policy())).toBe(false);
    expect(isClearedForLockedThread("Nonsense", policy())).toBe(false);
  });

  test("clears nothing until the server has answered", () => {
    // The whole point: not knowing whether a model retains prompts is not a
    // reason to send it one.
    const unknown = policy({ known: false });
    expect(isClearedForLockedThread("Basic", unknown)).toBe(false);
    expect(isClearedForLockedThread("moonshotai/kimi-k2.6", unknown)).toBe(false);
    expect(isClearedForLockedThread("Basic", NO_LOCKED_MODELS)).toBe(false);
  });
});

describe("defaultLockedModel", () => {
  test("is a model the handler will accept", () => {
    const fallback = defaultLockedModel(policy());
    expect(fallback).not.toBeNull();
    expect(isClearedForLockedThread(fallback as string, policy())).toBe(true);
  });

  test("prefers a tier over a catalog model", () => {
    expect(defaultLockedModel(policy())).toBe("Fast");
  });

  test("falls back to a catalog model when no tier qualifies", () => {
    expect(defaultLockedModel(policy({ tiers: [] }))).toBe(
      "moonshotai/kimi-k2.6",
    );
  });

  test("is null when nothing qualifies, rather than a guess", () => {
    // The composer refuses the send on null. Redirecting to a model the
    // user didn't choose, in a chat whose whole promise is retention, would
    // be the wrong kind of helpful.
    expect(defaultLockedModel(policy({ tiers: [], slugs: [] }))).toBeNull();
    expect(defaultLockedModel(NO_LOCKED_MODELS)).toBeNull();
  });
});
