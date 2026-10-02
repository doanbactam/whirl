// @ts-expect-error Bun provides this module to its test runner; the Next app
// intentionally does not include Bun's ambient types in its client tsconfig.
import { expect, test } from "bun:test";

import { normalizeMathDelimiters as n } from "./math-delimiters";

test("inline \\(...\\) becomes $$", () => {
  expect(n("inline \\(x^2\\) end")).toBe("inline $$x^2$$ end");
});

test("multi-line \\[...\\] becomes $$", () => {
  expect(n("\\[\na = b\n\\]")).toBe("$$\na = b\n$$");
});

test("inline code is left alone", () => {
  const s = "code `\\(not math\\)` stays, but \\(y\\) converts";
  expect(n(s)).toBe("code `\\(not math\\)` stays, but $$y$$ converts");
});

test("dollar math passes through untouched", () => {
  expect(n("plain $$E=mc^2$$")).toBe("plain $$E=mc^2$$");
});

test("numbers in prose survive masking", () => {
  const s = "there are 0 and 1 and `x` and \\(z\\) here";
  expect(n(s)).toBe("there are 0 and 1 and `x` and $$z$$ here");
});

test("fenced code blocks are untouched", () => {
  const s = ["```c", "f(\\(x\\));", "```", "after \\(z\\)"].join("\n");
  expect(n(s)).toBe(["```c", "f(\\(x\\));", "```", "after $$z$$"].join("\n"));
});

test("unpaired opener stays literal while streaming", () => {
  expect(n("partial \\(x + ")).toBe("partial \\(x + ");
});
