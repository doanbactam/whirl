// @ts-expect-error Bun provides this module to its test runner; the Next app
// intentionally does not include Bun's ambient types in its client tsconfig.
import { describe, expect, test } from "bun:test";

import {
  createLock,
  formatRecoveryCode,
  isSealed,
  normalizeRecoveryCode,
  open,
  openLockWithPassword,
  openLockWithRecoveryCode,
  ratePassword,
  RECOVERY_CODE_LENGTH,
  rewrapWithPassword,
  seal,
  WrongKeyError,
} from "./crypto";

/* PBKDF2 at 600k rounds is the point of the thing, but it makes every lock
   here cost most of a second. Locks are minted once and reused. */
const PASSWORD = "correct horse battery staple";
const lock = await createLock(PASSWORD);

describe("sealing", () => {
  test("round-trips a message", async () => {
    const envelope = await seal(lock.contentKey, "the eagle lands at noon");
    expect(await open(lock.contentKey, envelope)).toBe("the eagle lands at noon");
  });

  test("round-trips unicode and newlines intact", async () => {
    const text = "héllo 🌀\nsecond line\ttabbed";
    expect(await open(lock.contentKey, await seal(lock.contentKey, text))).toBe(text);
  });

  test("round-trips an empty string", async () => {
    expect(await open(lock.contentKey, await seal(lock.contentKey, ""))).toBe("");
  });

  test("marks its output, and nothing else", async () => {
    expect(isSealed(await seal(lock.contentKey, "x"))).toBe(true);
    expect(isSealed("plain text")).toBe(false);
    expect(isSealed("wlk2.aa.bb")).toBe(false);
  });

  test("never repeats a ciphertext for the same plaintext", async () => {
    const first = await seal(lock.contentKey, "same");
    const second = await seal(lock.contentKey, "same");
    expect(first).not.toBe(second);
  });

  test("refuses a tampered blob", async () => {
    const envelope = await seal(lock.contentKey, "untouched");
    const [prefix, iv, body] = envelope.split(".");
    const flipped = `${body.slice(0, -2)}${body.slice(-2) === "AA" ? "AB" : "AA"}`;
    await expect(
      open(lock.contentKey, `${prefix}.${iv}.${flipped}`),
    ).rejects.toThrow();
  });

  test("refuses another thread's key", async () => {
    const other = await createLock(PASSWORD);
    const envelope = await seal(lock.contentKey, "mine");
    await expect(open(other.contentKey, envelope)).rejects.toThrow();
  });
});

describe("opening a lock", () => {
  test("the password opens it", async () => {
    const key = await openLockWithPassword(lock.envelope, PASSWORD);
    expect(await open(key, await seal(lock.contentKey, "shared"))).toBe("shared");
  });

  test("the recovery code opens the same key", async () => {
    const key = await openLockWithRecoveryCode(lock.envelope, lock.recoveryCode);
    expect(await open(key, await seal(lock.contentKey, "shared"))).toBe("shared");
  });

  test("a formatted recovery code opens it too", async () => {
    const key = await openLockWithRecoveryCode(
      lock.envelope,
      formatRecoveryCode(lock.recoveryCode).toLowerCase(),
    );
    expect(await open(key, await seal(lock.contentKey, "shared"))).toBe("shared");
  });

  test("a wrong password is a WrongKeyError, not a crash", async () => {
    await expect(
      openLockWithPassword(lock.envelope, `${PASSWORD}!`),
    ).rejects.toBeInstanceOf(WrongKeyError);
  });

  test("a wrong recovery code is a WrongKeyError", async () => {
    const other = await createLock(PASSWORD);
    await expect(
      openLockWithRecoveryCode(lock.envelope, other.recoveryCode),
    ).rejects.toBeInstanceOf(WrongKeyError);
  });

  test("a short recovery code says so before doing any work", async () => {
    await expect(openLockWithRecoveryCode(lock.envelope, "ABC")).rejects.toThrow(
      /3/,
    );
  });
});

describe("recovery codes", () => {
  test("are the advertised length", () => {
    expect(lock.recoveryCode).toHaveLength(RECOVERY_CODE_LENGTH);
  });

  test("format into readable groups and fold back", () => {
    const printed = formatRecoveryCode(lock.recoveryCode);
    expect(printed).toContain("-");
    expect(normalizeRecoveryCode(printed)).toBe(lock.recoveryCode);
  });

  test("forgive the glyphs people mistype", () => {
    // O/I/L/U are not in the alphabet, so a reader's slip lands on the
    // character that was actually printed.
    expect(normalizeRecoveryCode("o i l u")).toBe("011V");
    expect(normalizeRecoveryCode("ab-cd ef")).toBe("ABCDEF");
  });

  test("never contain the ambiguous glyphs in the first place", async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const minted = await createLock("passwordpassword");
      expect(minted.recoveryCode).not.toMatch(/[ILOU]/);
    }
  });
});

describe("changing the password", () => {
  test("the new password opens it and the old one stops working", async () => {
    const rewrapped = await rewrapWithPassword(
      lock.envelope,
      lock.contentKey,
      "a whole new phrase",
    );
    const key = await openLockWithPassword(rewrapped, "a whole new phrase");
    expect(await open(key, await seal(lock.contentKey, "still mine"))).toBe(
      "still mine",
    );
    await expect(
      openLockWithPassword(rewrapped, PASSWORD),
    ).rejects.toBeInstanceOf(WrongKeyError);
  });

  test("leaves the printed recovery code working", async () => {
    const rewrapped = await rewrapWithPassword(
      lock.envelope,
      lock.contentKey,
      "another phrase entirely",
    );
    const key = await openLockWithRecoveryCode(rewrapped, lock.recoveryCode);
    expect(await open(key, await seal(lock.contentKey, "recovered"))).toBe(
      "recovered",
    );
  });
});

describe("ratePassword", () => {
  test("calls out the obvious ones", () => {
    expect(ratePassword("aaaaaaaaaaaa").score).toBe(0);
    expect(ratePassword("password123").score).toBe(0);
    expect(ratePassword("12345678").score).toBe(0);
  });

  test("rewards length over decoration", () => {
    expect(ratePassword("Xy7!").score).toBeLessThan(
      ratePassword("a rather long passphrase").score,
    );
  });

  test("stops nagging once it's genuinely strong", () => {
    expect(ratePassword("a rather long passphrase 42").hint).toBeNull();
  });

  test("has a label for every score", () => {
    for (const candidate of ["", "short", "moderate1", "a longer one 4!", "an extremely long passphrase 42!"]) {
      expect(ratePassword(candidate).label).toBeTruthy();
    }
  });
});
