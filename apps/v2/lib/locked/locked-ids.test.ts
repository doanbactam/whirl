// @ts-expect-error Bun provides this module to its test runner; the Next app
// intentionally does not include Bun's ambient types in its client tsconfig.
import { beforeEach, describe, expect, test } from "bun:test";

/* The store is what stands between a reload and a locked chat painting its
   contents, so what's tested is the part that has to survive one: what gets
   written down, and that the server's answer always wins over it. */

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
};
(globalThis as { window?: unknown }).window = globalThis;

const { forgetLocked, rememberLocked, syncLockedIds } = await import(
  "./locked-ids"
);

const persisted = (): string[] => JSON.parse(store.get("locked-threads") ?? "[]");

beforeEach(() => {
  store.clear();
  syncLockedIds([]);
});

describe("what gets written down", () => {
  test("locking a thread records it", () => {
    rememberLocked("t1");
    expect(persisted()).toEqual(["t1"]);
  });

  test("recording the same thread twice keeps one entry", () => {
    rememberLocked("t1");
    rememberLocked("t1");
    expect(persisted()).toEqual(["t1"]);
  });

  test("removing a lock forgets it", () => {
    rememberLocked("t1");
    rememberLocked("t2");
    forgetLocked("t1");
    expect(persisted()).toEqual(["t2"]);
  });

  test("forgetting something never recorded is a no-op", () => {
    rememberLocked("t1");
    forgetLocked("nope");
    expect(persisted()).toEqual(["t1"]);
  });
});

describe("the server's answer wins", () => {
  test("a thread locked elsewhere is picked up", () => {
    syncLockedIds([{ id: "t1", locked: true }, { id: "t2" }]);
    expect(persisted()).toEqual(["t1"]);
  });

  test("a thread unlocked elsewhere is dropped", () => {
    rememberLocked("t1");
    syncLockedIds([{ id: "t1", locked: false }]);
    expect(persisted()).toEqual([]);
  });

  test("a thread deleted elsewhere is dropped", () => {
    rememberLocked("gone");
    syncLockedIds([{ id: "t1", locked: true }]);
    expect(persisted()).toEqual(["t1"]);
  });

  test("an unchanged listing doesn't rewrite storage", () => {
    syncLockedIds([{ id: "t1", locked: true }]);
    store.delete("locked-threads");
    syncLockedIds([{ id: "t1", locked: true }]);
    // Nothing written back means the set was recognised as already correct.
    expect(store.has("locked-threads")).toBe(false);
  });
});

describe("storage that misbehaves", () => {
  test("garbage in storage reads as nothing rather than throwing", () => {
    store.set("locked-threads", "{not json");
    expect(() => syncLockedIds([{ id: "t1", locked: true }])).not.toThrow();
    expect(persisted()).toEqual(["t1"]);
  });

  test("non-string entries are dropped", () => {
    store.set("locked-threads", JSON.stringify(["t1", 7, null]));
    // A fresh sync rewrites the set from the server's answer regardless.
    syncLockedIds([{ id: "t1", locked: true }]);
    expect(persisted()).toEqual(["t1"]);
  });
});
