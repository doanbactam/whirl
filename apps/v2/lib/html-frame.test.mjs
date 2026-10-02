import { describe, expect, test } from "bun:test";

import { buildHtmlSrcDoc } from "./html-frame.ts";

describe("buildHtmlSrcDoc", () => {
  test("contains oversized authored layouts inside the sandbox", () => {
    const doc = buildHtmlSrcDoc(
      '<div style="width: 1200px">wide visualization</div>',
      { dark: false },
    );

    expect(doc).toContain("overflow-x: auto");
    expect(doc).toContain("max-width: 100%");
    expect(doc).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    );
  });
});
