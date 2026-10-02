// @ts-expect-error Bun provides this module to its test runner; the Next app
// intentionally does not include Bun's ambient types in its client tsconfig.
import { beforeEach, describe, expect, mock, test } from "bun:test";

/* posthog-js is a browser module, so the guard is tested against a stand-in
   that records what it was asked to do. What matters is the sequencing —
   when recording stops, when it resumes, and the cases where it must not
   resume at all — and none of that needs a real recorder. */

let running = false;
let loaded = true;
const calls: string[] = [];

mock.module("posthog-js", () => ({
  default: {
    get __loaded() {
      return loaded;
    },
    sessionRecordingStarted: () => running,
    stopSessionRecording: () => {
      calls.push("stop");
      running = false;
    },
    startSessionRecording: () => {
      calls.push("start");
      running = true;
    },
  },
}));

const { suppressReplay, MASK_TEXT, NO_CAPTURE } = await import(
  "./replay-guard",
);

beforeEach(() => {
  running = true;
  loaded = true;
  calls.length = 0;
});

describe("suppressReplay", () => {
  test("stops recording, and resumes it on release", () => {
    const release = suppressReplay();
    expect(calls).toEqual(["stop"]);
    expect(running).toBe(false);

    release();
    expect(calls).toEqual(["stop", "start"]);
    expect(running).toBe(true);
  });

  test("the last hold to leave is the one that resumes", () => {
    const first = suppressReplay();
    const second = suppressReplay();
    expect(calls).toEqual(["stop"]);

    first();
    expect(calls).toEqual(["stop"]);
    expect(running).toBe(false);

    second();
    expect(calls).toEqual(["stop", "start"]);
  });

  test("releasing twice does not resume early", () => {
    const first = suppressReplay();
    const second = suppressReplay();
    first();
    first();
    expect(running).toBe(false);

    second();
    expect(running).toBe(true);
  });

  test("never turns recording on for someone who had it off", () => {
    running = false;
    const release = suppressReplay();
    release();
    expect(calls).toEqual([]);
    expect(running).toBe(false);
  });

  test("does nothing when PostHog never loaded", () => {
    loaded = false;
    const release = suppressReplay();
    release();
    expect(calls).toEqual([]);
  });

  test("a hold taken while already suppressed keeps it suppressed", () => {
    const first = suppressReplay();
    expect(running).toBe(false);
    const second = suppressReplay();
    expect(calls).toEqual(["stop"]);
    second();
    expect(running).toBe(false);
    first();
    expect(running).toBe(true);
  });
});

describe("the masking classes", () => {
  test("MASK_TEXT carries both halves of the job", () => {
    /* rrweb's default maskTextClass censors the words in a replay;
       autocapture reads ph-sensitive before it ships the text of a clicked
       element. Neither one covers the other, so a chat needs both. */
    expect(MASK_TEXT.split(" ")).toEqual(["ph-mask", "ph-sensitive"]);
  });

  test("NO_CAPTURE is the block class, and is not the mask", () => {
    // PostHog's blockClass default. Blunter on purpose — it removes the
    // element rather than censoring it — so it must stay distinct.
    expect(NO_CAPTURE).toBe("ph-no-capture");
    expect(MASK_TEXT).not.toContain(NO_CAPTURE);
  });
});
