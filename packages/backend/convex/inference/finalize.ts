import type { ModelMessage } from "ai";
import { v, type Infer } from "convex/values";

import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { captureAiGeneration, captureServerEvent } from "../posthog";
import { captureBackendPerformance } from "../performance";
import { flushBraintrust, updateBraintrustSpan } from "../braintrust";
import { addSupermemoryDocument } from "../supermemory";
import { chargeUsage, FREE_MESSAGES_FEATURE_ID } from "../usageLedger";
import { bestEffort } from "./bestEffort";
import { AI_COST_FEATURE_ID, MODEL_IDS, type ModelKey } from "./billing";

// The per-turn bookkeeping that runs AFTER the reply has settled: LLM analytics,
// usage/billing deduction, the memory write and auto-compaction. None of it is
// on the user's critical path — the message is already marked complete and the
// client has moved on — so it's scheduled to run here, letting the streaming
// HTTP action return the instant the text is done instead of holding the
// connection open through these external round trips.

// Reduce the model input to plain text for the `$ai_input` analytics field.
// Attachment image/file parts are logged as short placeholders rather than their
// raw base64: the bytes are useless in analytics and — more importantly — a
// single value handed to the scheduler must stay under Convex's 1MB limit, which
// an inlined image would blow past (taking the whole finalize step, billing
// included, down with it).
function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const p = part as {
        type?: string;
        text?: string;
        filename?: string;
        mediaType?: string;
      };
      if (p.type === "text") return p.text ?? "";
      if (p.type === "image") return "[image]";
      if (p.type === "file")
        return `[file: ${p.filename ?? p.mediaType ?? "attachment"}]`;
      return `[${p.type ?? "part"}]`;
    })
    .join("\n");
}

// Bound the analytics input so the scheduled args stay well under Convex's 1MB
// per-value limit even for long threads or a big pasted/attached text file — a
// single oversized string would make the scheduler call throw and take billing
// down with it. The full prompt still went to the model; this is only the copy
// logged to analytics, so truncation here is harmless.
const ANALYTICS_TOTAL_BUDGET = 200_000;
const ANALYTICS_MESSAGE_CAP = 20_000;

function truncate(text: string, cap: number): string {
  return text.length > cap
    ? `${text.slice(0, cap)}… [truncated ${text.length - cap} chars]`
    : text;
}

// The reply and the user's message ride along for the memory write and the
// analytics output — neither is the source of truth for anything (the message
// rows are), so both are capped to keep the whole scheduled argument well
// under Convex's 1MB limit. Blowing that limit throws inside the scheduler
// call, which used to take the turn's billing with it.
const FINALIZE_TEXT_CAP = 100_000;

export function capForFinalize(text: string): string {
  return truncate(text, FINALIZE_TEXT_CAP);
}

/** Rough token count (chars/4) of the conversation actually sent — the
 *  prompt side that's genuinely the user's. Providers report the prompt as
 *  one lump that also carries our system prompt and tool schemas; recording
 *  this per turn lets the usage tab charge the user only for their content. */
export function estimatePromptContentTokens(
  messages: readonly { role: string; content: unknown }[] | ModelMessage[],
): number {
  let chars = 0;
  for (const message of messages) {
    chars += stringifyContent(message.content).length;
  }
  return Math.ceil(chars / 4);
}

export function buildAnalyticsInput(
  systemPrompt: string,
  messages: readonly { role: string; content: unknown }[] | ModelMessage[],
): { role: string; content: string }[] {
  let budget = ANALYTICS_TOTAL_BUDGET;
  const take = (text: string): string => {
    if (budget <= 0) return "";
    const capped = truncate(text, Math.min(ANALYTICS_MESSAGE_CAP, budget));
    budget -= capped.length;
    return capped;
  };
  return [
    { role: "system", content: take(systemPrompt) },
    ...messages.map((message) => ({
      role: String(message.role),
      content: take(stringifyContent(message.content)),
    })),
  ];
}

function buildSupermemoryConversationDocument({
  user,
  assistant,
}: {
  user: string;
  assistant: string;
}) {
  return [
    user.trim() ? `User:\n${user.trim()}` : null,
    assistant.trim() ? `Assistant:\n${assistant.trim()}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join("\n\n");
}

export const finalizeAssistantTurnArgs = {
  assistantId: v.id("messages"),
  threadId: v.id("threads"),
  streamId: v.string(),
  customerId: v.string(),
  model: v.string(),
  // The OpenRouter slug that actually served the turn — differs from the
  // tier default when an admin override is active. Optional for scheduled
  // finalizes already in flight across a deploy.
  modelSlug: v.optional(v.string()),
  isPaid: v.boolean(),
  // Platinum's Fast tier is on the house: the turn reports its real cost to
  // analytics but never touches the usage pool or the message's usageCost.
  // Optional so finalizes already scheduled across a deploy still validate —
  // absent means "bill it", which is what every turn before this did.
  unmetered: v.optional(v.boolean()),
  incognito: v.boolean(),
  memoryActive: v.boolean(),
  memoryContainerTag: v.string(),
  usageFactor: v.number(),
  scaleFreeMessages: v.boolean(),
  thinking: v.boolean(),
  search: v.boolean(),
  latencyMs: v.number(),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  cost: v.optional(v.number()),
  text: v.string(),
  latestUserText: v.string(),
  analyticsInput: v.array(v.object({ role: v.string(), content: v.string() })),
  performance: v.optional(v.record(v.string(), v.number())),
};

const finalizeAssistantTurnArgsValidator = v.object(finalizeAssistantTurnArgs);
type FinalizeAssistantTurnArgs = Infer<
  typeof finalizeAssistantTurnArgsValidator
>;

// Analytics + billing + memory + compaction for one completed assistant turn.
// Every step is best-effort and independent; a failure in one never blocks the
// rest. Billing uses the same idempotency keys as the old inline path, so a
// retry of this scheduled action can never double-charge.
export async function finalizeAssistantTurn(
  ctx: ActionCtx,
  args: FinalizeAssistantTurnArgs,
): Promise<void> {
  const modelKey = args.model as ModelKey;

  await bestEffort(
    "AI generation analytics",
    captureAiGeneration({
      distinctId: args.customerId,
      traceId: args.assistantId,
      model: args.modelSlug ?? MODEL_IDS[modelKey],
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      spanName: "chat",
      input: args.analyticsInput,
      outputChoices: [{ role: "assistant", content: args.text }],
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      totalCostUsd: args.cost,
      latencySeconds: args.latencyMs / 1000,
      isError: false,
      properties: {
        thread_id: args.threadId,
        tier: modelKey,
        thinking: args.thinking,
        search: args.search,
      },
    }),
  );

  // Braintrust opened this turn's span back in the streaming action, keyed on
  // the assistant message id, and merges writes by that id. The numbers worth
  // reporting only exist now, once OpenRouter has settled the request and the
  // markup has been applied — so we merge them in rather than trying to guess
  // them mid-stream. The prompt and reply come along too: the nested model spans
  // carry the full exchange, but this is what makes the turn readable at a
  // glance in the logs table.
  await bestEffort(
    "Braintrust turn merge",
    updateBraintrustSpan(args.assistantId, {
      input: args.analyticsInput,
      output: args.text,
      metrics: {
        cost_usd: args.cost,
        prompt_tokens: args.inputTokens,
        completion_tokens: args.outputTokens,
        latency_ms: args.latencyMs,
      },
      metadata: {
        model: args.modelSlug ?? MODEL_IDS[modelKey],
        tier: modelKey,
        paid: args.isPaid,
        thinking: args.thinking,
        search: args.search,
        // Braintrust has no user object to hang traits off, so the plan rides
        // along on the turn — which is where you'd want to filter on it anyway.
        user_plan: args.isPaid ? "paid" : "free",
      },
    }),
  );

  if (args.performance) {
    await bestEffort(
      "backend performance analytics",
      captureBackendPerformance({
        operation:
          modelKey === "Image" ? "image_generation" : "assistant_stream",
        outcome: "complete",
        durationMs: args.performance.total_ms ?? args.latencyMs,
        distinctId: args.customerId,
        properties: {
          ...args.performance,
          provider_duration_ms: args.latencyMs,
          model: args.modelSlug ?? MODEL_IDS[modelKey],
          tier: modelKey,
          thinking: args.thinking,
          search: args.search,
        },
      }),
    );
  }

  // An unmetered turn (Platinum on Fast) skips the deduction AND the persisted
  // usage cost — the usage tab should show the user what they were charged,
  // and they weren't charged anything. The analytics above already carry the
  // real number, so our books stay honest either way.
  const billable = args.unmetered !== true;
  const turnCost = billable && typeof args.cost === "number" ? args.cost : 0;

  // Billing is NOT best-effort. Every charge is written to the usage ledger
  // first and retried by its sweeper until Autumn confirms it, so a slow API,
  // a 500, or this isolate going away can only delay a charge — never drop it.
  if (args.isPaid) {
    await chargeUsage(ctx, {
      customerId: args.customerId,
      idempotencyKey: `${args.assistantId}:${args.streamId}:ai`,
      feature: AI_COST_FEATURE_ID,
      amount: turnCost * args.usageFactor,
      source: "assistant_turn",
      assistantId: args.assistantId,
      messageCost: turnCost,
    });
  } else {
    // Free customers are metered by message count, not dollars — but the
    // message still carries what it cost so the usage tab can show it.
    // An image pass unlocks the model, not extra allowance: every successful
    // image generation costs one message, even during usage-multiplier events.
    const messageUnits =
      modelKey === "Image" || !args.scaleFreeMessages ? 1 : args.usageFactor;
    await chargeUsage(ctx, {
      customerId: args.customerId,
      idempotencyKey: `${args.assistantId}:${args.streamId}:message`,
      feature: FREE_MESSAGES_FEATURE_ID,
      amount: messageUnits,
      source: "assistant_turn_free",
      assistantId: args.assistantId,
      messageCost: turnCost,
    });
  }

  if (args.isPaid && billable && turnCost <= 0) {
    // A turn that should have billed and reported no cost at all is the shape
    // of the bug this ledger exists to kill. Never silent again.
    console.warn("assistant_turn_billed_nothing", {
      assistantId: args.assistantId,
      customerId: args.customerId,
      model: args.modelSlug ?? MODEL_IDS[modelKey],
      reportedCost: args.cost,
    });
  }

  if (args.memoryActive) {
    const saved = await bestEffort(
      "Supermemory conversation write",
      addSupermemoryDocument({
        containerTag: args.memoryContainerTag,
        customId: `whirl-message-${args.assistantId}`,
        content: buildSupermemoryConversationDocument({
          user: args.latestUserText,
          assistant: args.text,
        }),
        metadata: {
          type: "conversation",
          source: "whirl",
          threadId: args.threadId,
          assistantId: args.assistantId,
          model: modelKey,
          createdAt: Date.now(),
        },
      }).then(() => true),
    );
    if (saved !== undefined) {
      await bestEffort(
        "memory analytics",
        captureServerEvent({
          event: "memory_saved",
          distinctId: args.customerId,
          properties: {
            provider: "supermemory",
            type: "conversation",
            thread_id: args.threadId,
          },
        }),
      );
    }
  }

  if (args.isPaid && !args.incognito) {
    await bestEffort(
      "auto-compaction scheduling",
      ctx.runMutation(internal.compaction.maybeScheduleCompaction, {
        threadId: args.threadId,
        customerId: args.customerId,
      }),
    );
  }

  // Last thing before this scheduled action returns and its isolate goes away.
  await flushBraintrust();
}
