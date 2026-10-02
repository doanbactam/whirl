/* Loads a route in headless Chrome and prints whatever the console and the
   page throw. Enough to catch a module-level or render-level crash without
   signing in — those happen before auth ever matters.

   usage: bun scripts/console-check.mjs [path] */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PATHNAME = process.argv[2] ?? "/";
const ORIGIN = process.env.CHECK_ORIGIN ?? "http://localhost:3999";
const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const profile = mkdtempSync(join(tmpdir(), "whirl-console-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--remote-debugging-port=9333",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-gpu",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function targets() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:9333/json/list");
      if (response.ok) return await response.json();
    } catch {
      // Chrome hasn't opened the port yet.
    }
    await sleep(250);
  }
  throw new Error("Chrome never came up on 9333.");
}

const page = (await targets()).find((t) => t.type === "page");
const socket = new WebSocket(page.webSocketDebuggerUrl);
const found = [];
let id = 0;
const send = (method, params = {}) =>
  socket.send(JSON.stringify({ id: ++id, method, params }));

socket.addEventListener("open", () => {
  send("Runtime.enable");
  send("Log.enable");
  send("Page.enable");
  send("Network.enable");
  send("Page.navigate", { url: `${ORIGIN}${PATHNAME}` });
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") {
    const detail = message.params.exceptionDetails;
    found.push(
      `THROWN: ${detail.exception?.description ?? detail.text}`,
    );
  }
  if (message.method === "Runtime.consoleAPICalled") {
    if (!["error", "warning"].includes(message.params.type)) return;
    const text = message.params.args
      .map((arg) => arg.description ?? arg.value ?? arg.type)
      .join(" ");
    found.push(`${message.params.type.toUpperCase()}: ${text}`);
  }
  if (message.method === "Log.entryAdded") {
    const entry = message.params.entry;
    if (entry.level !== "error") return;
    found.push(`LOG: ${entry.text} ${entry.url ?? ""}`);
  }
  if (message.method === "Network.loadingFailed") {
    found.push(`NET FAILED: ${message.params.errorText}`);
  }
});

await sleep(9000);
console.log(`--- ${ORIGIN}${PATHNAME} ---`);
console.log(found.length ? found.join("\n") : "(clean)");

socket.close();
chrome.kill();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // Chrome may still hold a handle; the temp dir is disposable either way.
}
process.exit(0);
