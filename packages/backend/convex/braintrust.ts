// Braintrust observability for the Convex inference paths.
//
// Braintrust watches the *conversation* — traces, LLM spans, tool spans,
// feedback — where `posthog.ts` next door watches the *numbers*. They run side
// by side and neither knows about the other; this file deliberately mirrors
// posthog.ts's shape (module-level config, best-effort sends, no exported Convex
// functions) so the two read as siblings.
//
// Three things about the runtime shape everything here:
//
//   1. We import from `braintrust/browser`, not the package root. The root
//      entrypoint reaches for `node:fs`, `node:os` and `simple-git`, and none of
//      this runs in Node — every inference action lives in Convex's default
//      runtime, a V8 isolate. (`convex/attachmentMarkdown.ts` is the lone
//      `"use node"` file in the backend, and nothing here is traced from it.)
//      The browser build drops all of that and talks to the API over `fetch`.
//
//   2. That same browser build ships a no-op AsyncLocalStorage, which would
//      leave every LLM span orphaned at the root of the project log. Convex does
//      have `node:async_hooks`, so `braintrustContext.ts` hands the SDK a real
//      one and the trace comes out shaped like the turn: one span per call site,
//      the model call beneath it, every tool call beneath that.
//
//   3. Isolates get torn down the moment an action returns, and the SDK batches
//      in the background. Anything that doesn't `flushBraintrust()` before
//      returning is throwing its spans away. Call it. Always.
//
// With no `BRAINTRUST_API_KEY` set, every export here degrades to the plain AI
// SDK function or a no-op — a contributor without a key runs byte-identical code
// paths.
//
// One thing that did not survive the port from Raindrop: the hidden
// self-diagnostic tool the model could call to flag its own failures. Braintrust
// has no equivalent in the SDK — the same job is done by online scorers
// configured on the project, which run over the traces we ship here, so nothing
// extra is handed to the model.

import * as ai from "ai";
import { initLogger, withCurrent, wrapAISDK } from "braintrust/browser";

import {
  enterSpanContext,
  installBraintrustContextManager,
} from "./braintrustContext";

/* The project every span below is logged to. The SDK resolves the org from
   the API key. Pin an existing project by id, or let it find (or create) one
   by name in that org. */
const BRAINTRUST_PROJECT = process.env.BRAINTRUST_PROJECT_ID?.trim()
  ? { projectId: process.env.BRAINTRUST_PROJECT_ID.trim() }
  : { projectName: process.env.BRAINTRUST_PROJECT_NAME?.trim() || "Whirl" };

const BRAINTRUST_API_KEY = process.env.BRAINTRUST_API_KEY;

/** Whether Braintrust is configured at all. Everything below no-ops when false. */
export const braintrustEnabled = Boolean(BRAINTRUST_API_KEY);

// Built lazily and memoized: module init runs on every cold isolate, and there's
// no reason to construct a logger for the many actions that never trace. The
// login round trip behind it is lazy too — the SDK only makes it once something
// is actually logged.
let cachedLogger: ReturnType<typeof initLogger> | null = null;

function braintrustLogger() {
  if (!BRAINTRUST_API_KEY) return null;
  if (!cachedLogger) {
    installBraintrustContextManager();
    cachedLogger = initLogger({
      ...BRAINTRUST_PROJECT,
      apiKey: BRAINTRUST_API_KEY,
      // Batch in the background and flush by hand at the end of the action (see
      // `flushBraintrust`). Logging synchronously instead would put an API round
      // trip in the middle of the user's turn.
      asyncFlush: true,
      setCurrent: true,
    });
  }
  return cachedLogger;
}

// `wrapAISDK` returns a Proxy over the `ai` namespace whose functions open a
// span under whatever span is current, then nest the model call and each tool
// call beneath it. One wrap covers every call site; the differences between them
// live in the span each one opens, not in the SDK.
let cachedSdk: typeof ai | null = null;

function tracedSdk(): typeof ai {
  if (!braintrustLogger()) return ai;
  cachedSdk ??= wrapAISDK(ai);
  return cachedSdk;
}

/**
 * `streamText`, traced — the stock AI SDK function when no key is configured.
 * Tool calls inside the loop become nested spans automatically; no per-tool
 * wiring needed.
 */
export const tracedStreamText: typeof ai.streamText = ((...args) =>
  tracedSdk().streamText(
    ...(args as Parameters<typeof ai.streamText>),
  )) as typeof ai.streamText;

/** `generateText`, traced. Same deal. */
export const tracedGenerateText: typeof ai.generateText = ((...args) =>
  tracedSdk().generateText(
    ...(args as Parameters<typeof ai.generateText>),
  )) as typeof ai.generateText;

export type BraintrustSpanContext = {
  /** Clerk subject — the same id PostHog and Autumn bill against. */
  userId: string;
  /**
   * Stable row id for this span. Every whirl call site passes a Convex id (the
   * assistant message, or the thread for turn-less helpers) so that a later
   * action running in a *different* isolate can still find the row: Braintrust
   * merges writes by id, which is what `updateBraintrustSpan` relies on.
   */
  eventId: string;
  /** Groups a thread's turns into one conversation. */
  convoId?: string;
  /** Span name, e.g. `chat_message` or `thread_title`. */
  eventName: string;
  properties?: Record<string, unknown>;
};

/** Fields worth attaching to a span after the fact. All optional, all merged. */
export type BraintrustSpanFields = {
  input?: unknown;
  output?: unknown;
  error?: unknown;
  metadata?: Record<string, unknown>;
  metrics?: Record<string, number | undefined>;
};

export type BraintrustSpan = {
  /** Run `fn` with this span current, so AI SDK calls nest underneath it. */
  run<T>(fn: () => T): T;
  /**
   * Make this span current for the rest of the action, with no callback to come
   * back out of — for work that outlives the call that started it, like a
   * stream. Prefer `run` when the work fits inside one call.
   */
  enter(): void;
  /** Merge more fields into the span. */
  log(fields: BraintrustSpanFields): void;
  /** Close the span. Safe to call once, from a `finally`. */
  end(): void;
};

// What every export hands back when there's no write key — and the fallback when
// the SDK throws, since a Braintrust outage must never fail the turn that
// produced the spans.
const INERT_SPAN: BraintrustSpan = {
  run: (fn) => fn(),
  enter: () => {},
  log: () => {},
  end: () => {},
};

function spanMetadata(context: BraintrustSpanContext) {
  return {
    app: "whirl",
    user_id: context.userId,
    ...(context.convoId ? { conversation_id: context.convoId } : {}),
    ...context.properties,
  };
}

// `metrics` values have to be numbers; callers routinely have `undefined` for
// tokens the provider never reported, and a null metric is worse than no metric.
function definedNumbers(metrics: Record<string, number | undefined>) {
  return Object.fromEntries(
    Object.entries(metrics).filter(([, value]) => typeof value === "number"),
  );
}

function spanPayload(fields: BraintrustSpanFields) {
  return {
    ...(fields.input !== undefined ? { input: fields.input } : {}),
    ...(fields.output !== undefined ? { output: fields.output } : {}),
    ...(fields.error !== undefined
      ? {
          error:
            fields.error instanceof Error
              ? fields.error.message
              : String(fields.error),
        }
      : {}),
    ...(fields.metadata ? { metadata: fields.metadata } : {}),
    ...(fields.metrics ? { metrics: definedNumbers(fields.metrics) } : {}),
  };
}

/**
 * Open a span for one unit of work. Returns an inert span when Braintrust is
 * off, so call sites never branch on configuration.
 *
 * Callers that own a streaming result — where the model call outlives the
 * function that started it — want this directly: `enter()` before the call that
 * opens the stream, `end()` in the `finally` that closes it. Everything else
 * wants `tracedGeneration`.
 */
export function openBraintrustSpan(
  context: BraintrustSpanContext,
): BraintrustSpan {
  const logger = braintrustLogger();
  if (!logger) return INERT_SPAN;
  try {
    const span = logger.startSpan({
      name: context.eventName,
      type: "task",
      event: { id: context.eventId, metadata: spanMetadata(context) },
    });
    return {
      run: (fn) => withCurrent(span, fn),
      enter: () => {
        try {
          enterSpanContext(span);
        } catch (error) {
          console.error("Braintrust span enter failed", error);
        }
      },
      log: (fields) => {
        try {
          span.log(spanPayload(fields));
        } catch (error) {
          console.error("Braintrust span log failed", error);
        }
      },
      end: () => {
        try {
          span.end();
        } catch (error) {
          console.error("Braintrust span end failed", error);
        }
      },
    };
  } catch (error) {
    console.error("Braintrust span failed to open", error);
    return INERT_SPAN;
  }
}

/**
 * Run a single-shot generation inside its own span — thread titles, home
 * suggestions, compaction, store categorization. The model call nests under it,
 * a throw is recorded on it, and the span closes either way.
 */
export async function tracedGeneration<T>(
  context: BraintrustSpanContext,
  generate: () => Promise<T>,
): Promise<T> {
  const span = openBraintrustSpan(context);
  try {
    return await span.run(generate);
  } catch (error) {
    span.log({ error });
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Push everything batched so far. Convex disposes the isolate as soon as an
 * action returns, so an un-flushed batch is a lost batch. Best-effort: a
 * Braintrust outage must never fail the turn that produced the spans.
 */
export async function flushBraintrust(): Promise<void> {
  const logger = braintrustLogger();
  if (!logger) return;
  try {
    await logger.flush();
  } catch (error) {
    console.error("Braintrust flush failed", error);
  }
}

/**
 * Attach late-arriving facts to a span that has already shipped. The chat's
 * authoritative cost and token counts only exist once OpenRouter has settled the
 * request, which happens in the scheduled finalize action — a different isolate
 * from the one that opened the span, hence the id-keyed merge.
 */
export async function updateBraintrustSpan(
  eventId: string,
  fields: BraintrustSpanFields,
): Promise<void> {
  const logger = braintrustLogger();
  if (!logger) return;
  try {
    logger.updateSpan({ id: eventId, ...spanPayload(fields) });
  } catch (error) {
    console.error("Braintrust span update failed", error);
  }
}

/**
 * Record feedback against a span — a thumbs up/down, an edit, a retry. Scores
 * are 0–1 and become filterable columns on the log; the comment is free text.
 *
 * Nothing in v2 renders per-message feedback yet, so this has no callers; it's
 * here so the first one is a one-liner.
 */
export async function logBraintrustFeedback(feedback: {
  eventId: string;
  scores?: Record<string, number | null>;
  comment?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const logger = braintrustLogger();
  if (!logger) return;
  try {
    logger.logFeedback({
      id: feedback.eventId,
      ...(feedback.scores ? { scores: feedback.scores } : {}),
      ...(feedback.comment ? { comment: feedback.comment } : {}),
      ...(feedback.metadata ? { metadata: feedback.metadata } : {}),
      source: "app",
    });
  } catch (error) {
    console.error("Braintrust feedback failed", error);
  }
}
