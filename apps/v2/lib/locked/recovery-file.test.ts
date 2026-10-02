// @ts-expect-error Bun provides this module to its test runner; the Next app
// intentionally does not include Bun's ambient types in its client tsconfig.
import { describe, expect, test } from "bun:test";

import { formatRecoveryCode, RECOVERY_CODE_LENGTH } from "./crypto";
import {
  readRecoveryKeyFromFile,
  recoveryFileContents,
  recoveryFileName,
} from "./recovery-file";

/* Not a real key — a valid-shaped one. The alphabet has no I, L, O or U. */
const CODE = "ABCDE12345FGHJK67890MNPQR12345STVWX67890".slice(
  0,
  RECOVERY_CODE_LENGTH,
);

const FILE = recoveryFileContents({
  code: CODE,
  threadName: "Tax stuff",
  createdAt: new Date(1_800_000_000_000),
});

describe("the recovery file", () => {
  test("carries the key where a person can find it", () => {
    expect(FILE).toContain(formatRecoveryCode(CODE));
    expect(FILE).toContain("Tax stuff");
  });

  test("says what happens if it's lost", () => {
    expect(FILE.toLowerCase()).toContain("password");
    expect(FILE.toLowerCase()).toContain("recovery key");
  });

  test("reads its own key back", () => {
    expect(readRecoveryKeyFromFile(FILE, RECOVERY_CODE_LENGTH)).toBe(CODE);
  });
});

describe("readRecoveryKeyFromFile", () => {
  test("finds a bare key pasted into a note", () => {
    expect(
      readRecoveryKeyFromFile(
        `whirl key\n${formatRecoveryCode(CODE)}\n`,
        RECOVERY_CODE_LENGTH,
      ),
    ).toBe(CODE);
  });

  test("finds one with no formatting at all", () => {
    expect(readRecoveryKeyFromFile(CODE, RECOVERY_CODE_LENGTH)).toBe(CODE);
  });

  test("survives CRLF", () => {
    expect(
      readRecoveryKeyFromFile(
        `header\r\n${formatRecoveryCode(CODE)}\r\n`,
        RECOVERY_CODE_LENGTH,
      ),
    ).toBe(CODE);
  });

  test("returns null when there's no key in the file", () => {
    expect(
      readRecoveryKeyFromFile("just some notes\nnothing here", RECOVERY_CODE_LENGTH),
    ).toBeNull();
  });

  test("returns null for a key of the wrong length", () => {
    expect(
      readRecoveryKeyFromFile(CODE.slice(0, -3), RECOVERY_CODE_LENGTH),
    ).toBeNull();
  });
});

describe("recoveryFileName", () => {
  test("slugs the chat name and stamps the day", () => {
    const name = recoveryFileName("Tax stuff!", new Date(1_800_000_000_000));
    expect(name).toMatch(/^whirl-recovery-key-tax-stuff-\d{4}-\d{2}-\d{2}\.txt$/);
  });

  test("falls back when the name slugs to nothing", () => {
    expect(recoveryFileName("!!!", new Date(1_800_000_000_000))).toContain(
      "locked-chat",
    );
  });

  test("doesn't run away on a very long name", () => {
    const name = recoveryFileName("x".repeat(300), new Date(1_800_000_000_000));
    expect(name.length).toBeLessThan(80);
  });
});
