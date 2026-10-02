import { expect, test } from "bun:test";

import {
  extractStreamingField,
  sanitizeCodeFileName,
} from "../convex/inference/documents";

test("sanitizes code document filenames without changing valid extensions", () => {
  expect(sanitizeCodeFileName("../../src/index.ts", "typescript")).toBe(
    "index.ts",
  );
  expect(sanitizeCodeFileName('report:<draft>?.json', "json")).toBe(
    "report--draft--.json",
  );
});

test("falls back to an extension that matches the language", () => {
  expect(sanitizeCodeFileName("..", "python")).toBe("untitled.py");
  expect(sanitizeCodeFileName("", "unknown")).toBe("untitled.txt");
});

test("extracts code metadata while tool input is still streaming", () => {
  const partial =
    '{"title":"Example","fileName":"main.ts","language":"typescript","content":"const answer = 4';
  expect(extractStreamingField(partial, "fileName")).toBe("main.ts");
  expect(extractStreamingField(partial, "language")).toBe("typescript");
  expect(extractStreamingField(partial, "content")).toBe("const answer = 4");
});
