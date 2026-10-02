// A real `AsyncLocalStorage` for Braintrust's span context.
//
// `braintrust.ts` imports the SDK's browser build, and that build ships a no-op
// AsyncLocalStorage: browsers have no async context tracking, so `currentSpan()`
// there always comes back empty and every span the AI SDK wrapper opens lands at
// the root of the project log, detached from the turn that caused it.
//
// Convex's default runtime *does* have `node:async_hooks`, so we can hand the
// SDK a real store through `globalThis.BRAINTRUST_CONTEXT_MANAGER` — the hook it
// already reads so OpenTelemetry can supply the ambient context. Four methods is
// the whole contract:
//
//   wrapSpanForStore  what to put in the store for a span (here: the span)
//   runInContext      run a callback with a span current
//   getCurrentSpan    read it back
//   getParentSpanIds  the id pair a child span hangs off
//
// The SDK builds its context manager lazily, the first time anything asks for
// the current span, so installing this before the first logger is enough. The
// store itself lives at module scope rather than on the instance: the SDK
// constructs the class itself, so that's the only way `enterSpanContext` below
// can reach the same store the SDK reads from.

import { AsyncLocalStorage } from "node:async_hooks";

/** The shape the SDK needs off a stored span; the real one carries far more. */
export type ContextSpan = {
  spanId: string;
  rootSpanId: string;
};

const store = new AsyncLocalStorage<ContextSpan>();

class ConvexBraintrustContextManager {
  wrapSpanForStore(span: ContextSpan): ContextSpan {
    return span;
  }

  runInContext<R>(span: ContextSpan, callback: () => R): R {
    return store.run(span, callback);
  }

  getCurrentSpan(): ContextSpan | undefined {
    return store.getStore();
  }

  getParentSpanIds():
    | { rootSpanId: string; spanParents: string[] }
    | undefined {
    const span = store.getStore();
    if (!span) return undefined;
    return { rootSpanId: span.rootSpanId, spanParents: [span.spanId] };
  }
}

// The SDK caches its context manager on first use and hands out a reset through
// the global symbol registry, which is the whole reason this can be installed
// late. Importing `braintrust/browser` anywhere is enough to resolve the cached
// manager, and that import is evaluated before any handler runs — so without the
// reset, setting the global afterwards would be a silent no-op and every span
// would quietly come out flat. Both symbols are `Symbol.for`, i.e. deliberately
// reachable from outside the SDK.
const BRAINTRUST_STATE = Symbol.for("braintrust-state");
const RESET_CONTEXT_MANAGER = Symbol.for("braintrust.resetContextManagerState");

let installed = false;

/**
 * Point the Braintrust SDK at the context manager above. Idempotent, and
 * best-effort: if the runtime ever refuses the global, tracing still works —
 * spans just stop nesting under their turn.
 */
export function installBraintrustContextManager(): void {
  if (installed) return;
  installed = true;
  try {
    const global = globalThis as Record<string | symbol, unknown>;
    global.BRAINTRUST_CONTEXT_MANAGER = ConvexBraintrustContextManager;
    const state = global[BRAINTRUST_STATE] as
      | Record<symbol, (() => void) | undefined>
      | undefined;
    state?.[RESET_CONTEXT_MANAGER]?.();
  } catch (error) {
    console.error("Braintrust context manager install failed", error);
  }
}

/**
 * Make `span` current for the rest of this async context, with no callback to
 * come back out of. `runInContext` is the right tool when the work fits inside
 * one call; this is for the streaming turn, where the span deliberately outlives
 * the call that opened it and the action ends before anything else needs the
 * context back.
 */
export function enterSpanContext(span: ContextSpan): void {
  store.enterWith(span);
}
