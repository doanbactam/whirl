/* Exercises public/sw.js for real: installs it, cuts the network, and
   navigates — which is the only way to find out whether the offline page
   actually answers. Registration in the app is production-gated
   (components/pwa/service-worker.tsx), so this registers by hand and works
   against the dev server.

   usage: node scripts/sw-check.mjs [out.png] */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const OUT = resolve(process.argv[2] ?? ".shots/offline.png");
const ORIGIN = process.env.CHECK_ORIGIN ?? "http://localhost:3000";
const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const profile = mkdtempSync(join(tmpdir(), "whirl-sw-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--remote-debugging-port=9350",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-gpu",
    "--hide-scrollbars",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function firstPage() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:9350/json/list");
      if (response.ok) {
        const page = (await response.json()).find((t) => t.type === "page");
        if (page) return page;
      }
    } catch {
      // Not up yet.
    }
    await sleep(250);
  }
  throw new Error("Chrome never came up on 9350.");
}

const page = await firstPage();
const socket = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const call = (method, params = {}) =>
  new Promise((done, fail) => {
    const messageId = ++id;
    pending.set(messageId, { done, fail });
    socket.send(JSON.stringify({ id: messageId, method, params }));
  });
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const waiter = message.id && pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.fail(new Error(`${message.method}: ${message.error.message}`));
  else waiter.done(message.result);
});
await new Promise((done) => socket.addEventListener("open", done));

const evaluate = async (expression) => {
  const result = await call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "threw");
  }
  return result.result?.value;
};

await call("Page.enable");
await call("Runtime.enable");
await call("Network.enable");
await call("Emulation.setDeviceMetricsOverride", {
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  mobile: true,
});

await call("Page.navigate", { url: `${ORIGIN}/` });
await sleep(9000);

console.log(
  "register →",
  await evaluate(`navigator.serviceWorker
    .register("/sw.js")
    .then((r) => navigator.serviceWorker.ready)
    .then((r) => "active: " + (r.active ? r.active.state : "none"))
    .catch((e) => "FAILED: " + e.message)`),
);

/* The install precache is a handful of small same-origin files; give it a
   beat to land before pulling the plug. */
await sleep(2500);
console.log(
  "cached  →",
  await evaluate(`caches.open("whirl-shell-v1")
    .then((c) => c.keys())
    .then((keys) => keys.map((r) => new URL(r.url).pathname).join(", "))`),
);

console.log(
  "controls→",
  await evaluate(
    `navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : "(uncontrolled)"`,
  ),
);

/* Offline has to reach the worker's own network stack too, not just the
   page's — a fetch() inside the worker runs in a separate target, and
   emulating conditions on the page alone leaves it happily online, which
   reads as "the fallback never fired". */
const offline = {
  offline: true,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
};
await call("Target.setAutoAttach", {
  autoAttach: true,
  waitForDebuggerOnStart: false,
  flatten: true,
});
await sleep(500);
const { targetInfos } = await call("Target.getTargets");
for (const target of targetInfos) {
  if (target.type !== "service_worker") continue;
  const { sessionId } = await call("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  });
  socket.send(
    JSON.stringify({
      id: ++id,
      sessionId,
      method: "Network.enable",
      params: {},
    }),
  );
  socket.send(
    JSON.stringify({
      id: ++id,
      sessionId,
      method: "Network.emulateNetworkConditions",
      params: offline,
    }),
  );
  console.log("worker  → offline applied to", target.url);
}
await call("Network.emulateNetworkConditions", offline);
await sleep(300);
await call("Page.navigate", { url: `${ORIGIN}/thread/anything` });
await sleep(3000);

console.log(
  "offline →",
  await evaluate(`document.querySelector("h1") ? document.querySelector("h1").textContent : "(no h1)"`),
);

const shot = await call("Page.captureScreenshot", { format: "png" });
writeFileSync(OUT, Buffer.from(shot.data, "base64"));
console.log(`wrote ${OUT}`);

socket.close();
chrome.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // Chrome may still hold a handle; the temp dir is disposable either way.
}
process.exit(0);
