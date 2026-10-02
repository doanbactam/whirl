/* Screenshots a route in headless Chrome under phone emulation, so mobile
   work can be looked at instead of guessed at. Sibling to console-check.mjs
   and it follows the same rules: fresh profile per run, one page target.

   usage: bun scripts/shot.mjs <path> <out.png> [--w 390] [--h 844]
                               [--dpr 3] [--desktop] [--dark]
                               [--wait 4000] [--eval "<js>"] [--full]
                               [--swipe x1,y1,x2,y2] [--hold]

   --swipe drags a real finger across the page (CDP touch events, not
   synthesised clicks), which is the only way to exercise the drawer gesture
   in lib/use-drawer-swipe.ts. --hold shoots mid-drag, before the release. */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const positional = args.filter((value) => !value.startsWith("--"));
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};
const has = (name) => args.includes(`--${name}`);

const PATHNAME = positional[0] ?? "/";
const OUT = resolve(positional[1] ?? "shot.png");
const DESKTOP = has("desktop");
const WIDTH = Number(flag("w", DESKTOP ? 1440 : 390));
const HEIGHT = Number(flag("h", DESKTOP ? 900 : 844));
const DPR = Number(flag("dpr", DESKTOP ? 2 : 3));
const WAIT = Number(flag("wait", 4500));
const EVAL = flag("eval", null);
const ORIGIN = process.env.CHECK_ORIGIN ?? "http://localhost:3000";
const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/* Emulation.setDeviceMetricsOverride({ mobile: true }) does NOT move the
   pointer and hover media features — a page emulated at phone size still
   answers `(pointer: fine)` and `(hover: hover)`, so every
   coarse-pointer-gated rule renders as if it were on a desktop and a
   screenshot quietly lies about what a phone sees. Blink only exposes those
   through a launch flag. Values are Blink's own bitfields: hover none = 1,
   pointer coarse = 2 (fine is 4). */
const COARSE_POINTER =
  "--blink-settings=primaryHoverType=1,availableHoverTypes=1," +
  "primaryPointerType=2,availablePointerTypes=2";

const PORT = 9334 + (Number(process.env.SHOT_PORT_OFFSET ?? 0) | 0);
const profile = mkdtempSync(join(tmpdir(), "whirl-shot-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-color-profile=srgb",
    ...(DESKTOP ? [] : [COARSE_POINTER]),
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function firstPage() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (response.ok) {
        const list = await response.json();
        const page = list.find((target) => target.type === "page");
        if (page) return page;
      }
    } catch {
      // Chrome hasn't opened the port yet.
    }
    await sleep(250);
  }
  throw new Error(`Chrome never came up on ${PORT}.`);
}

const page = await firstPage();
const socket = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const messageId = ++id;
    pending.set(messageId, {
      resolve,
      reject: (error) => reject(new Error(`${method}: ${error.message}`)),
    });
    socket.send(JSON.stringify({ id: messageId, method, params }));
  });

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const waiter = message.id && pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});

await new Promise((resolve) => socket.addEventListener("open", resolve));

await call("Page.enable");
await call("Runtime.enable");
/* A headless page has no window focus, so `document.activeElement` moves but
   CSS `:focus` never matches — which makes every focus-gated rule look
   broken when it isn't (and, worse, look fine when it is). */
await call("Emulation.setFocusEmulationEnabled", { enabled: true });
await call("Emulation.setDeviceMetricsOverride", {
  width: WIDTH,
  height: HEIGHT,
  deviceScaleFactor: DPR,
  mobile: !DESKTOP,
  screenWidth: WIDTH,
  screenHeight: HEIGHT,
});
if (!DESKTOP) {
  await call("Emulation.setUserAgentOverride", {
    userAgent: IPHONE_UA,
    platform: "iPhone",
  });
  await call("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 5,
  });
}
await call("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-color-scheme", value: has("dark") ? "dark" : "light" }],
});
/* The same key lib/theme.ts and the layout's boot script read. */
if (has("dark")) {
  await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `try { localStorage.setItem("theme", "dark"); } catch {}`,
  });
}

await call("Page.navigate", { url: `${ORIGIN}${PATHNAME}` });
await sleep(WAIT);

if (EVAL) {
  const result = await call("Runtime.evaluate", {
    expression: EVAL,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    console.log(
      `eval threw: ${result.exceptionDetails.exception?.description ?? ""}`,
    );
  } else if (result.result?.value !== undefined) {
    console.log(`eval → ${JSON.stringify(result.result.value)}`);
  }
  await sleep(Number(flag("settle", 1200)));
}

const SWIPE = flag("swipe", null);
if (SWIPE) {
  const [x1, y1, x2, y2] = SWIPE.split(",").map(Number);
  const touch = (type, x, y) =>
    call("Input.dispatchTouchEvent", {
      type,
      touchPoints:
        type === "touchEnd" ? [] : [{ x: Math.round(x), y: Math.round(y) }],
    });

  await touch("touchStart", x1, y1);
  /* Stepped, with a beat between frames: the gesture locks its axis on the
     first few pixels and measures velocity off the timestamps, so one giant
     jump would read as neither a drag nor a flick. */
  const STEPS = 14;
  for (let step = 1; step <= STEPS; step += 1) {
    const progress = step / STEPS;
    await touch("touchMove", x1 + (x2 - x1) * progress, y1 + (y2 - y1) * progress);
    await sleep(16);
  }
  if (has("hold")) {
    await sleep(200);
  } else {
    await touch("touchEnd", x2, y2);
    await sleep(Number(flag("settle", 600)));
  }
}

const shot = await call("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: has("full"),
  ...(has("full") ? {} : { clip: undefined }),
});
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.from(shot.data, "base64"));
console.log(`wrote ${OUT} (${WIDTH}x${HEIGHT} @${DPR}x)`);

socket.close();
chrome.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // Chrome may still hold a handle; the temp dir is disposable either way.
}
process.exit(0);
