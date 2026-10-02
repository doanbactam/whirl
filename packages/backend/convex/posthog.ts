// Server-side PostHog capture for the Convex runtime.
//
// We hit PostHog's HTTP capture API directly with `fetch` rather than reaching
// for `posthog-node` + `@posthog/ai`'s `withTracing`. Two reasons:
//   1. The inference paths run in Convex's *default* runtime. The streaming
//      endpoint is an `httpAction`, which can't opt into the Node runtime, and
//      `posthog-node` leans on Node built-ins. `fetch` is the one transport
//      guaranteed to work in the default runtime.
//   2. `withTracing` wraps the AI SDK model via object spread, which drops the
//      getter props on OpenRouter's LanguageModelV2 — we'd rather not risk the
//      core chat path on that.
//
// The `$ai_generation` event below is exactly the shape PostHog's LLM analytics
// product ingests, so traces, token counts and costs light up natively in the
// LLM analytics dashboards — same end result, just emitted by hand.
//
// This file intentionally exports no Convex functions; it's a plain helper
// module imported by the inference actions.

const POSTHOG_PROJECT_TOKEN = process.env.POSTHOG_PROJECT_TOKEN;
const POSTHOG_HOST = (
  process.env.POSTHOG_HOST ?? "https://us.i.posthog.com"
).replace(/\/$/, "");
const LLM_PRIVACY_MODE = process.env.POSTHOG_LLM_PRIVACY_MODE === "true";

// PostHog personal API key (NOT the public project token) used to *read* from
// PostHog's query/endpoint API — the project token is write-only — plus the
// `/run` URL of a saved endpoint in your project that returns today's free-tier
// spend in USD. Used by the free-user daily cost lookup below. Leave either
// unset to disable the lookup (the overload throttle then simply never
// engages).
const POSTHOG_PERSONAL_API_KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const POSTHOG_FREE_COST_ENDPOINT = process.env.POSTHOG_FREE_COST_ENDPOINT;

export const serverAnalyticsEnabled = Boolean(POSTHOG_PROJECT_TOKEN);

// Depth-first scan for the first finite number anywhere in a PostHog endpoint
// response. The `/run` surface returns `{ results: [[value]], ... }` for a
// single-value aggregation, but the exact nesting varies by query, so we hunt
// for the first number rather than hard-coding a path. Strings that parse as
// numbers (PostHog sometimes serializes aggregates as strings) count too.
function firstFiniteNumber(value: unknown, depth = 0): number | null {
  if (depth > 6) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = Number(value);
    return value.trim() !== "" && Number.isFinite(n) ? n : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstFiniteNumber(item, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  return null;
}

/**
 * How much free-tier traffic has cost Whirl so far today, in USD, per the
 * PostHog `free-user-daily-cost` endpoint. Returns `null` when the lookup is
 * disabled (no personal API key) or fails for any reason — callers treat `null`
 * as "no signal", so the overload throttle stays off rather than guessing.
 */
export async function fetchFreeUserDailyCost(): Promise<number | null> {
  if (!POSTHOG_PERSONAL_API_KEY || !POSTHOG_FREE_COST_ENDPOINT) return null;
  try {
    const res = await fetch(POSTHOG_FREE_COST_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${POSTHOG_PERSONAL_API_KEY}`,
      },
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: unknown; result?: unknown };
    // Prefer the conventional `results` block; fall back to the whole payload.
    return (
      firstFiniteNumber(data.results) ??
      firstFiniteNumber(data.result) ??
      firstFiniteNumber(data)
    );
  } catch {
    return null;
  }
}

type CaptureInput = {
  event: string;
  distinctId: string;
  properties?: Record<string, unknown>;
};

/**
 * Fire-and-forget a single event to PostHog. Best-effort: a failed capture
 * (bad token, network blip, analytics disabled) must never break the request
 * that triggered it, so everything is swallowed.
 */
export async function captureServerEvent({
  event,
  distinctId,
  properties,
}: CaptureInput): Promise<void> {
  if (!POSTHOG_PROJECT_TOKEN) return;
  try {
    await fetch(`${POSTHOG_HOST}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: POSTHOG_PROJECT_TOKEN,
        event,
        distinct_id: distinctId,
        properties: { ...properties, $lib: "whirl-convex" },
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // Analytics is best-effort; never surface ingestion errors to the caller.
  }
}

export type AiMessage = { role: string; content: unknown };

export type AiGenerationInput = {
  /** Stable user id (Clerk subject) so events merge with client identify(). */
  distinctId: string;
  /** Groups all events of one logical request together in LLM analytics. */
  traceId: string;
  /** Provider model id, e.g. `anthropic/claude-sonnet-4.6`. */
  model: string;
  /** Defaults to "openrouter". */
  provider?: string;
  input?: AiMessage[];
  outputChoices?: AiMessage[];
  inputTokens?: number;
  outputTokens?: number;
  /** End-to-end call duration, in seconds. */
  latencySeconds?: number;
  totalCostUsd?: number;
  httpStatus?: number;
  isError?: boolean;
  baseUrl?: string;
  /** Human label for the span, e.g. "chat" or "thread_title". */
  spanName?: string;
  /** Extra, non-`$ai_` custom properties (thread_id, tier, flags, …). */
  properties?: Record<string, unknown>;
};

function definedOnly(
  entries: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Emit a `$ai_generation` event — the unit PostHog's LLM analytics is built on.
 * When `POSTHOG_LLM_PRIVACY_MODE` is enabled the prompt/response content is
 * dropped while the metrics (tokens, cost, latency) are still captured.
 */
export async function captureAiGeneration(
  input: AiGenerationInput,
): Promise<void> {
  if (!POSTHOG_PROJECT_TOKEN) return;

  const properties = definedOnly({
    ...input.properties,
    $ai_trace_id: input.traceId,
    $ai_model: input.model,
    $ai_provider: input.provider ?? "openrouter",
    $ai_input: LLM_PRIVACY_MODE ? undefined : input.input,
    $ai_output_choices: LLM_PRIVACY_MODE ? undefined : input.outputChoices,
    $ai_input_tokens: input.inputTokens,
    $ai_output_tokens: input.outputTokens,
    $ai_latency: input.latencySeconds,
    $ai_total_cost_usd: input.totalCostUsd,
    $ai_http_status: input.httpStatus,
    $ai_is_error: input.isError,
    $ai_base_url: input.baseUrl,
    $ai_span_name: input.spanName,
  });

  await captureServerEvent({
    event: "$ai_generation",
    distinctId: input.distinctId,
    properties,
  });
}
