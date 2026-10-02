/* The runtime that lives INSIDE the artifact sandbox.
 *
 * Bundled separately from the app (scripts/build-artifact-runtime.mjs) into
 * public/artifact-runtime.js, because the frame is an opaque origin with no
 * network: the host fetches this file once, HTTP-cached, and inlines it into
 * the iframe document. Nothing here may import from the app.
 *
 * What it does:
 *  - hands the compiled module a tiny `require` over a fixed set of packages,
 *  - mounts its default export under an error boundary,
 *  - answers useWhirlData() by asking the HOST to run a declared binding —
 *    this frame has no credentials and no way to reach an integration itself,
 *  - reports its height up so an inline card can size to it, and
 *  - swaps light/dark in place instead of reloading the document.
 */

import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import * as JsxRuntime from "react/jsx-runtime";
import * as Recharts from "recharts";
import "@tailwindcss/browser";

type DataState = {
  data: unknown;
  error: string | null;
  loading: boolean;
  /** Which binding this result belongs to, so a component that swaps binding
   *  ids never shows the previous one's data as if it were current. */
  forBinding: string;
};

type BindingResult =
  | { ok: true; data: unknown; fetchedAt: number; cached: boolean }
  | { ok: false; error: string };

const HOST = window.parent;

/* --- host RPC -------------------------------------------------------------- */

let nextRequestId = 1;
const pending = new Map<number, (result: BindingResult) => void>();

function requestBinding(
  bindingId: string,
  extraArgs?: Record<string, unknown>,
  /* A refetch is somebody pressing refresh. The host caches reads for a
     minute, which is right for a remount and wrong for a button — so this
     asks past it. The per-artifact call budget still applies. */
  force = false,
): Promise<BindingResult> {
  return new Promise((resolve) => {
    const requestId = nextRequestId++;
    pending.set(requestId, resolve);
    try {
      HOST.postMessage(
        {
          type: "whirl-artifact-data-request",
          requestId,
          bindingId,
          extraArgs: extraArgs ? JSON.stringify(extraArgs) : undefined,
          force,
        },
        "*",
      );
    } catch {
      pending.delete(requestId);
      resolve({ ok: false, error: "This artifact can't reach its data." });
    }
    /* The host always answers, but a dropped message must not leave a
       component spinning forever with no way to say why. */
    setTimeout(() => {
      const waiting = pending.get(requestId);
      if (!waiting) return;
      pending.delete(requestId);
      waiting({ ok: false, error: "Loading this data timed out." });
    }, 30_000);
  });
}

/**
 * Read one of the artifact's declared data bindings.
 *
 * The binding id is all the component gets to choose — which integration and
 * which tool it maps to was fixed when the artifact was written, and lives on
 * the host. `refetch` re-runs the same binding with extra arguments merged in.
 */
function useWhirlData(
  bindingId: string,
  initialArgs?: Record<string, unknown>,
): {
  data: unknown;
  error: string | null;
  loading: boolean;
  refetch: (extraArgs?: Record<string, unknown>) => void;
} {
  const [state, setState] = React.useState<DataState>({
    data: null,
    error: null,
    loading: true,
    forBinding: bindingId,
  });
  /* Args are read fresh on every run but never re-trigger the load — an inline
     object literal (which is what anyone writes) would otherwise refetch on
     every single render. Synced in an effect declared before the fetch, so the
     fetch always sees the current value. */
  const argsRef = React.useRef(initialArgs);
  React.useEffect(() => {
    argsRef.current = initialArgs;
  });

  const aliveRef = React.useRef(true);
  React.useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const apply = React.useCallback((forBinding: string, result: BindingResult) => {
    if (!aliveRef.current) return;
    setState(
      result.ok
        ? { data: result.data, error: null, loading: false, forBinding }
        : { data: null, error: result.error, loading: false, forBinding },
    );
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void requestBinding(bindingId, { ...(argsRef.current ?? {}) }).then(
      (result) => {
        if (cancelled) return;
        apply(bindingId, result);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [bindingId, apply]);

  const refetch = React.useCallback(
    (extraArgs?: Record<string, unknown>) => {
      setState((prev) => ({ ...prev, loading: true }));
      void requestBinding(
        bindingId,
        { ...(argsRef.current ?? {}), ...(extraArgs ?? {}) },
        true,
      ).then((result) => apply(bindingId, result));
    },
    [bindingId, apply],
  );

  /* A result carrying the previous binding id is stale by definition — report
     it as loading rather than handing back the wrong data. */
  const loading = state.loading || state.forBinding !== bindingId;
  return {
    data: loading ? null : state.data,
    error: loading ? null : state.error,
    loading,
    refetch,
  };
}

/* --- module loading -------------------------------------------------------- */

const MODULES: Record<string, unknown> = {
  react: React,
  "react/jsx-runtime": JsxRuntime,
  "react/jsx-dev-runtime": JsxRuntime,
  recharts: Recharts,
  "@whirl/data": { useWhirlData },
};

function requireModule(name: string): unknown {
  const found = MODULES[name];
  if (!found) {
    throw new Error(
      `This artifact tried to import "${name}", which isn't available here. Only react, recharts, and @whirl/data can be imported.`,
    );
  }
  return found;
}

class ArtifactBoundary extends React.Component<
  { children: React.ReactNode },
  { message: string | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { message: null };
  }

  static getDerivedStateFromError(error: unknown) {
    return {
      message: error instanceof Error ? error.message : "Something broke.",
    };
  }

  componentDidCatch(error: unknown) {
    report("render", error instanceof Error ? error.message : String(error));
  }

  render() {
    if (this.state.message !== null) {
      return React.createElement(FrameError, {
        title: "This artifact stopped working",
        detail: this.state.message,
      });
    }
    return this.props.children;
  }
}

function FrameError({ title, detail }: { title: string; detail: string }) {
  return React.createElement(
    "div",
    { className: "flex min-h-24 items-center justify-center p-6" },
    React.createElement(
      "div",
      { className: "max-w-md text-center" },
      React.createElement(
        "div",
        { className: "text-[13.5px] font-medium text-[var(--whirl-fg)]" },
        title,
      ),
      React.createElement(
        "div",
        {
          className:
            "mt-1 text-[12.5px] leading-5 text-[var(--whirl-muted)] break-words",
        },
        detail,
      ),
    ),
  );
}

function report(phase: "compile" | "render", message: string) {
  try {
    HOST.postMessage({ type: "whirl-artifact-error", phase, message }, "*");
  } catch {
    /* The host went away; nothing to report to. */
  }
}

let root: Root | null = null;

function mount(compiled: string) {
  const container = document.getElementById("root");
  if (!container) return;

  let Component: React.ComponentType;
  try {
    const module_ = { exports: {} as Record<string, unknown> };
    /* The one place model-written code is evaluated. It's why the frame is an
       opaque origin behind a CSP with connect-src 'none' — not because this
       call is safe, but because what it produces is contained. */
    const factory = new Function("require", "module", "exports", compiled);
    factory(requireModule, module_, module_.exports);
    const exported = module_.exports.default ?? module_.exports;
    if (typeof exported !== "function") {
      throw new Error(
        "The module didn't export a component. It must end with `export default function App() { ... }`.",
      );
    }
    Component = exported as React.ComponentType;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report("compile", message);
    root ??= createRoot(container);
    root.render(
      React.createElement(FrameError, {
        title: "This artifact couldn't load",
        detail: message,
      }),
    );
    return;
  }

  /* No StrictMode: its double-invoked effects would fire every binding twice,
     and a data read is not a free thing to do twice. */
  root ??= createRoot(container);
  root.render(
    React.createElement(ArtifactBoundary, null, React.createElement(Component)),
  );
}

/* --- host protocol --------------------------------------------------------- */

/* Content-sized (inline card) vs pane-filling (side panel). Only the former
   reports height; see html-frame-view for why an iframe that sizes to its own
   content is a feedback loop worth being careful with. */
let fill = false;
let lastHeight = 0;

function reportHeight() {
  if (fill) return;
  const height = Math.ceil(
    document.documentElement.getBoundingClientRect().height,
  );
  if (height === lastHeight) return;
  lastHeight = height;
  try {
    HOST.postMessage({ type: "whirl-artifact-height", height }, "*");
  } catch {
    /* no host to tell */
  }
}

/* The host owns the --whirl-* palette (lib/html-frame.ts) and posts it down
   with each theme change, so the two never drift and a light/dark swap is a
   style write instead of a document reload. */
function applyTheme(dark: boolean, tokens?: Record<string, string>) {
  const html = document.documentElement;
  html.classList.toggle("dark", dark);
  html.style.colorScheme = dark ? "dark" : "light";
  if (tokens) {
    for (const [name, value] of Object.entries(tokens)) {
      html.style.setProperty(name, value);
    }
  }
}

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== HOST) return;
  const data = event.data as
    | {
        type?: string;
        code?: string;
        dark?: boolean;
        tokens?: Record<string, string>;
        fill?: boolean;
        requestId?: number;
        result?: BindingResult;
      }
    | null;
  if (!data?.type) return;

  switch (data.type) {
    case "whirl-artifact-code":
      if (typeof data.code === "string") mount(data.code);
      break;
    case "whirl-artifact-theme":
      applyTheme(Boolean(data.dark), data.tokens);
      break;
    case "whirl-artifact-mode":
      fill = Boolean(data.fill);
      document.documentElement.classList.toggle("fill", fill);
      break;
    case "whirl-artifact-data-result": {
      const waiting =
        typeof data.requestId === "number"
          ? pending.get(data.requestId)
          : undefined;
      if (waiting && data.result) {
        pending.delete(data.requestId as number);
        waiting(data.result);
      }
      break;
    }
  }
});

if (window.ResizeObserver) {
  new ResizeObserver(reportHeight).observe(document.documentElement);
}
window.addEventListener("load", reportHeight);
/* Tailwind compiles in the browser, so the first painted layout is unstyled
   and the height it reports is wrong. These catch the restyle. */
[50, 200, 600, 1500].forEach((delay) => setTimeout(reportHeight, delay));

/* Announce readiness more than once. This script runs before the host's iframe
   `load` handler and, on a warm HTTP cache, potentially before the host has
   even attached its message listener — a single announcement lost to that race
   leaves a frame that never gets its code. Repeats are idempotent: the host
   only flips a boolean. */
function announceReady() {
  try {
    HOST.postMessage({ type: "whirl-artifact-ready" }, "*");
  } catch {
    /* No host — a standalone copy of this file. Nothing to announce to. */
  }
}
announceReady();
[16, 100, 400].forEach((delay) => setTimeout(announceReady, delay));
