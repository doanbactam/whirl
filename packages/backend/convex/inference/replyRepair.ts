// What happens when a turn ends with nothing to show the user.
//
// A provider answering `finishReason: "stop"` with an empty body is not a
// success — it's a silent failure that reads, from every layer above it, like a
// finished turn. It has no `error` to log, no exception to catch, and the SDK
// hands it back as a perfectly ordinary result. Braintrust traces of these show
// a clean, green, entirely useless turn.
//
// So empty IS the error here. `runRepairPass` throws on an empty body, which
// puts a real `error` on the repair span, and `repairFinalReply` retries once on
// a different provider route before falling back to a written-by-hand line that
// at least tells the user what work actually happened.

import type { LanguageModel, ModelMessage } from "ai";

import { tracedGenerateText, tracedGeneration } from "../braintrust";
import { reportedCostUsd } from "./turnUsage";

/** Metadata tag for the failure this module exists to make visible. */
export const EMPTY_REPLY_FAILURE = "empty_model_response";

/** How many model calls the repair gets before the hand-written fallback. */
const MAX_REPAIR_ATTEMPTS = 2;

const REPAIR_MAX_OUTPUT_TOKENS = 2_000;
const REPAIR_TIMEOUT_MS = 60_000;

/**
 * Appended to the turn's own system prompt for the repair pass. No tools are
 * exposed on this call, so the instruction says so plainly — and asks, in as
 * many words, for a non-empty answer, since the whole reason we're here is a
 * provider that returned none.
 */
const REPAIR_INSTRUCTION =
  "Tool use for this reply is over and no tool can be called. Using the conversation and the tool results above, write the final user-facing answer now — non-empty, addressed to the user in second person. If part of the task could not be finished, say plainly what got done and what remains. Do not describe plans, private reasoning, instructions, tool names, calls, or implementation details.";

/**
 * A model call that came back successfully with nothing in it. Thrown from
 * inside the traced span so the span records the failure, and carries the
 * serving provider so the retry can route around it.
 */
export class EmptyModelReplyError extends Error {
  readonly finishReason: string | undefined;
  readonly provider: string | undefined;
  /** An empty reply is still a paid request — carry its cost out of here. */
  readonly usage: RepairUsage;

  constructor(details: {
    finishReason?: string;
    provider?: string;
    usage: RepairUsage;
  }) {
    super(
      `Model returned an empty reply (finishReason: ${details.finishReason ?? "unknown"}, provider: ${details.provider ?? "unknown"})`,
    );
    this.name = "EmptyModelReplyError";
    this.finishReason = details.finishReason;
    this.provider = details.provider;
    this.usage = details.usage;
  }
}

/** What one repair attempt cost, so the turn can bill for it. */
export type RepairUsage = {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
};

const NO_USAGE: RepairUsage = {
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
};

function addUsage(total: RepairUsage, next: RepairUsage): RepairUsage {
  return {
    costUsd: total.costUsd + next.costUsd,
    inputTokens: total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
  };
}

export type ReplyRepairAttempt = {
  attempt: number;
  /** The upstream OpenRouter served the request, when it reported one. */
  provider?: string;
  finishReason?: string;
  /** True when the call succeeded but had no text in it. */
  empty: boolean;
  error?: string;
};

export type ReplyRepairResult = {
  /** Always non-empty: model text when one wrote some, the fallback otherwise. */
  text: string;
  source: "repair" | "repair_retry" | "fallback";
  attempts: ReplyRepairAttempt[];
  /** Every attempt's spend, the failed ones included — they all billed. */
  usage: RepairUsage;
};

/**
 * OpenRouter names the upstream that actually served a request in its provider
 * metadata (`bedrock`, `fireworks`, …). Read defensively — it's the one field
 * the retry's routing depends on, and an unknown shape must degrade to "unknown
 * provider", never throw inside a failure path.
 */
function servingProvider(metadata: unknown): string | undefined {
  const provider = (
    metadata as { openrouter?: { provider?: unknown } } | undefined
  )?.openrouter?.provider;
  return typeof provider === "string" && provider.length > 0
    ? provider
    : undefined;
}

/**
 * Route the retry away from whatever just failed. With a named provider that's
 * a straight exclusion; without one, sorting by throughput is enough to shuffle
 * the endpoint (Auto re-picks per request anyway). The model slug never
 * changes — a different model could reject the prompt's file blocks outright,
 * which would turn one empty reply into a hard failure.
 */
function retryRouting(failedProvider: string | undefined) {
  return failedProvider
    ? { ignore: [failedProvider] }
    : { sort: "throughput" as const };
}

export type ReplyRepairTrace = {
  userId: string;
  assistantId: string;
  threadId: string;
  /** Model tier key, e.g. `Auto`. */
  tier: string;
  /** Wire slug that served the turn. */
  modelSlug: string;
  toolCalls: number;
};

async function runRepairPass(params: {
  model: LanguageModel;
  system: string;
  messages: ModelMessage[];
  routing?: ReturnType<typeof retryRouting>;
  attempt: number;
  trace: ReplyRepairTrace;
}): Promise<{
  text: string;
  provider?: string;
  finishReason: string;
  usage: RepairUsage;
}> {
  const { model, system, messages, routing, attempt, trace } = params;
  return tracedGeneration(
    {
      userId: trace.userId,
      // Distinct id per attempt — sharing one would merge the attempts into a
      // single row and hide the retry entirely.
      eventId: `${trace.assistantId}:repair${attempt > 1 ? `-${attempt}` : ""}`,
      convoId: trace.threadId,
      eventName: "chat_message_repair",
      properties: {
        tier: trace.tier,
        model: trace.modelSlug,
        tool_calls: trace.toolCalls,
        attempt,
        ...(routing && "ignore" in routing
          ? { ignored_providers: routing.ignore }
          : {}),
      },
    },
    async () => {
      const result = await tracedGenerateText({
        model,
        system: `${system}\n\n${REPAIR_INSTRUCTION}`,
        messages,
        maxOutputTokens: REPAIR_MAX_OUTPUT_TOKENS,
        timeout: { totalMs: REPAIR_TIMEOUT_MS },
        providerOptions: {
          openrouter: {
            usage: { include: true },
            reasoning: { exclude: true },
            ...(routing ? { provider: routing } : {}),
          },
        },
      });
      const provider = servingProvider(result.providerMetadata);
      const text = result.text.trim();
      const usage: RepairUsage = {
        costUsd: reportedCostUsd(result.providerMetadata),
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
      };
      // The point of the whole module: a successful-looking empty response is
      // recorded as an error on this span rather than returned as an answer.
      if (!text) {
        throw new EmptyModelReplyError({
          finishReason: result.finishReason,
          provider,
          usage,
        });
      }
      return { text, provider, finishReason: result.finishReason, usage };
    },
  );
}

/**
 * Regenerate a turn's final answer from work that already completed. Never
 * throws: a repair that fails in every way still returns usable text, because
 * the caller's only alternative is showing the user an empty message.
 */
export async function repairFinalReply(params: {
  model: LanguageModel;
  systemPrompt: string;
  /** Conversation so far plus the completed tool steps, reasoning stripped. */
  messages: ModelMessage[];
  /** Tool names called this turn, in order — the fallback's raw material. */
  toolNames: readonly string[];
  trace: ReplyRepairTrace;
}): Promise<ReplyRepairResult> {
  const attempts: ReplyRepairAttempt[] = [];
  let failedProvider: string | undefined;
  let usage = NO_USAGE;

  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
    try {
      const result = await runRepairPass({
        model: params.model,
        system: params.systemPrompt,
        messages: params.messages,
        routing: attempt === 1 ? undefined : retryRouting(failedProvider),
        attempt,
        trace: params.trace,
      });
      attempts.push({
        attempt,
        provider: result.provider,
        finishReason: result.finishReason,
        empty: false,
      });
      return {
        text: result.text,
        source: attempt === 1 ? "repair" : "repair_retry",
        attempts,
        usage: addUsage(usage, result.usage),
      };
    } catch (error) {
      const empty = error instanceof EmptyModelReplyError;
      if (empty) {
        failedProvider = error.provider;
        usage = addUsage(usage, error.usage);
      }
      attempts.push({
        attempt,
        ...(empty ? { provider: error.provider } : {}),
        ...(empty && error.finishReason
          ? { finishReason: error.finishReason }
          : {}),
        empty,
        error: error instanceof Error ? error.message : String(error),
      });
      // A repair is a bonus pass on an already-long turn: it can be slow, it
      // can be rate-limited, and it must never take the reply down with it.
      console.error("final_reply_repair_failed", {
        assistantId: params.trace.assistantId,
        model: params.trace.tier,
        attempt,
        empty,
        provider: empty ? error.provider : undefined,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    text: buildFallbackReply(params.toolNames),
    source: "fallback",
    attempts,
    usage,
  };
}

// Plain-English names for the work the model did before it went quiet. The
// system prompt forbids naming tools to the user, and rightly so — but the
// fallback still has to say something truer than "try again", so each tool gets
// a phrase describing what the *user* got out of it. Anything unrecognized
// (a per-integration name, a tool added later) is simply left out.
const TOOL_WORK_LABELS: Record<string, string> = {
  answerQuestion: "searched the web",
  calculate: "worked through the maths",
  calculateBatch: "worked through the maths",
  createChart: "put together a chart",
  createCodeDocument: "drafted some code",
  createDocument: "drafted a document",
  createHtmlPage: "built a page",
  createInlineHtml: "built a visualization",
  createReactArtifact: "built an interactive artifact",
  editDocument: "edited a document",
  editHtml: "edited an artifact",
  fetchUrl: "read through some pages",
  generateImage: "painted an image",
  getWeather: "checked the weather",
  load_skill: "loaded one of your skills",
  mcp_call_tool: "used your connected apps",
  mcp_list_tools: "looked through your connected apps",
  searchChatHistory: "searched your past chats",
  suggestIntegrations: "looked through the integration store",
};

/**
 * "searched the web, read through some pages and used your connected apps" —
 * deduped, in the order the work happened. Empty string when nothing recognized
 * ran, so callers can drop the clause entirely rather than print a stub.
 */
export function describeToolWork(toolNames: readonly string[]): string {
  const phrases: string[] = [];
  for (const name of toolNames) {
    const label = TOOL_WORK_LABELS[name];
    if (label && !phrases.includes(label)) phrases.push(label);
  }
  const last = phrases.pop();
  if (last === undefined) return "";
  if (phrases.length === 0) return last;
  return `${phrases.join(", ")} and ${last}`;
}

/**
 * The last resort, written by hand and never by a model — by the time this runs,
 * two model calls have already come back empty. It says what went wrong, what
 * did happen, and what to do next, in that order.
 */
export function buildFallbackReply(toolNames: readonly string[]): string {
  const work = describeToolWork(toolNames);
  if (!work) {
    return "The model returned an empty response twice in a row, so there's no reply to show. Please send the message again.";
  }
  return `I ${work}, but the model returned an empty response twice when it came time to write the reply, so I can't show you what it found. Send the message again and it should land.`;
}
