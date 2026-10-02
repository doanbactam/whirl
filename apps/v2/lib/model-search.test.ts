// @ts-expect-error Bun provides this module to its test runner; the Next app
// intentionally does not include Bun's ambient types in its client tsconfig.
import { describe, expect, test } from "bun:test";

import { foldText, scoreModel, scoreText, searchModels } from "./model-search";
import type { ComposerModel } from "./models";

function model(
  name: string,
  overrides: Partial<ComposerModel> = {},
): ComposerModel {
  return {
    key: name,
    name,
    aliases: [],
    vision: false,
    files: false,
    imageOutput: false,
    thinkingLevels: ["none"],
    whiteLabel: false,
    autoGates: false,
    ...overrides,
  };
}

const GPT4 = model("GPT-4", {
  key: "openai/gpt-4",
  fullName: "GPT-4",
  company: "OpenAI",
  aliases: ["openai/gpt-4", "openai", "gpt-4"],
  legacy: true,
});
const GPT4O_MINI = model("GPT-4o mini", {
  key: "openai/gpt-4o-mini",
  fullName: "GPT-4o mini",
  company: "OpenAI",
  aliases: ["openai/gpt-4o-mini", "openai", "gpt-4o mini"],
});
const SONNET = model("Claude Sonnet 4.5", {
  key: "anthropic/claude-sonnet-4.5",
  fullName: "Claude Sonnet 4.5",
  company: "Anthropic",
  aliases: ["anthropic/claude-sonnet-4.5", "anthropic", "claude sonnet 4.5"],
});

const CATALOG = [GPT4O_MINI, SONNET, GPT4];
const names = (models: ComposerModel[]) => models.map((m) => m.name);

describe("foldText", () => {
  test("flattens every separator to one space", () => {
    expect(foldText("GPT-4")).toBe("gpt 4");
    expect(foldText("openai/gpt-4")).toBe("openai gpt 4");
    expect(foldText("Claude Sonnet 4.5")).toBe("claude sonnet 4 5");
    expect(foldText("  gpt___4  ")).toBe("gpt 4");
  });

  test("drops accents", () => {
    expect(foldText("Mistral Némo")).toBe("mistral nemo");
  });
});

describe("scoreText", () => {
  test("punctuation in the query is irrelevant", () => {
    for (const query of ["GPT-4", "GPT 4", "gpt4", "gpt_4", "gpt.4"]) {
      expect(scoreText("GPT-4", query)).toBeGreaterThan(0);
    }
  });

  test("ranks exact over prefix over word-prefix over substring", () => {
    const exact = scoreText("Claude Sonnet 4.5", "claude sonnet 4.5");
    const prefix = scoreText("Claude Sonnet 4.5", "claude");
    const wordPrefix = scoreText("Claude Sonnet 4.5", "sonnet");
    const substring = scoreText("Claude Sonnet 4.5", "onnet");
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordPrefix);
    expect(wordPrefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(0);
  });

  test("finds every typed word in any order", () => {
    expect(scoreText("Claude Sonnet 4.5", "sonnet claude")).toBeGreaterThan(0);
  });

  test("is not fuzzy — a typo stays a miss", () => {
    expect(scoreText("GPT-4", "gtp4")).toBe(0);
    expect(scoreText("GPT-4", "gemini")).toBe(0);
  });

  test("an empty query matches nothing on its own", () => {
    expect(scoreText("GPT-4", "   ")).toBe(0);
  });
});

describe("scoreModel", () => {
  test("matches on name, full name, company and aliases", () => {
    expect(scoreModel(SONNET, "anthropic")).toBeGreaterThan(0);
    expect(scoreModel(SONNET, "claude-sonnet-4.5")).toBeGreaterThan(0);
  });

  test("the name outranks the company", () => {
    expect(scoreModel(SONNET, "claude")).toBeGreaterThan(
      scoreModel(SONNET, "anthropic"),
    );
  });

  test("a loose hit on a retired model yields to the current lineup", () => {
    const retired = scoreModel(GPT4, "gpt");
    const current = scoreModel(GPT4O_MINI, "gpt");
    expect(retired).toBeGreaterThan(0);
    expect(retired).toBeLessThan(current);
  });

  /* Typing the whole name is a direct request — retirement shouldn't
     bury it under a longer sibling that merely starts the same way. */
  test("an exact hit on a retired model keeps its full score", () => {
    expect(scoreModel(GPT4, "gpt 4")).toBe(
      scoreModel(model("GPT-4", { fullName: "GPT-4" }), "gpt 4"),
    );
  });
});

describe("searchModels", () => {
  /* The reported bug: "GPT 4" found nothing at all. */
  test("finds GPT-4 however the user spaces it", () => {
    for (const query of ["GPT-4", "GPT 4", "gpt4", "gpt 4"]) {
      expect(names(searchModels(CATALOG, query))).toContain("GPT-4");
    }
  });

  test("puts the exact model first, ahead of its longer siblings", () => {
    for (const query of ["gpt 4", "gpt-4", "gpt4", "GPT4"]) {
      expect(names(searchModels(CATALOG, query))[0]).toBe("GPT-4");
    }
  });

  test("a broad query still returns the whole family", () => {
    expect(names(searchModels(CATALOG, "gpt"))).toEqual([
      "GPT-4o mini",
      "GPT-4",
    ]);
  });

  test("an empty query passes the list straight through", () => {
    expect(searchModels(CATALOG, "  ")).toEqual(CATALOG);
  });

  test("no match returns nothing rather than everything", () => {
    expect(searchModels(CATALOG, "llama")).toEqual([]);
  });
});
