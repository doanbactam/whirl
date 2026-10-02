import { stepCountIs, type ModelMessage, type Tool } from "ai";

import { components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { bestEffort } from "./bestEffort";
import { createMutationQueue } from "./mutationQueue";
import { routesPerRequest, stripEncryptedReasoning } from "./reasoningReplay";
import { EMPTY_REPLY_FAILURE, repairFinalReply } from "./replyRepair";
import { createTurnUsageMeter } from "./turnUsage";
import { chargeUsage } from "../usageLedger";
import { buildSystemPrompt } from "../prompts";
import {
  checkAutumnGate,
  createBillingClient,
  createOpenRouterChatModel,
  customModelMarkupFor,
  effectiveModelKeyFor,
  fetchBillingCustomer,
  FREE_LOCKED_GATE,
  GATE_SENTINEL_PREFIX,
  type Gate,
  IMAGE_COST_MARKUP,
  IMAGE_GATE,
  isUnmeteredPlatinumTurn,
  MESSAGES_GATE,
  MODEL_IDS,
  type ModelKey,
  MODEL_REQUIRED_FLAGS,
  OVERLOAD_SENTINEL,
  readFreeMessageUsage,
  readPlanState,
  REASONING_GATE,
  reasoningOffOptionsFor,
  resolveModelKey,
  resolveOverloadCap,
  SEARCH_FEATURE_ID,
  SEARCH_GATE,
  snapshotFreeMessageUsage,
  snapshotGateAllowed,
  snapshotPlanState,
  TOOL_MAX_STEPS,
  UNBILLED_PLAN_STATE,
  UPLOAD_GATE,
  USAGE_GATE,
} from "./billing";
import {
  captureAiGeneration,
  captureServerEvent,
} from "../posthog";
// The chat's `streamText`/`generateText` come from the Braintrust wrapper rather
// than straight from `ai`: same functions, plus trace + tool-span capture. With
// no API key configured they *are* the plain AI SDK functions.
import {
  flushBraintrust,
  openBraintrustSpan,
  tracedStreamText,
} from "../braintrust";
import { captureBackendPerformance } from "../performance";
import { streamFlushIntervalMs } from "../streamFlush";
import {
  createBatchCalculatorTool,
  createCalculatorTool,
  type CalcPhasePayload,
} from "./math";
import {
  createCodeDocumentTool,
  createDocumentTool,
  createEditDocumentTool,
  type DocumentFormat,
  extractCompleteField,
  extractStreamingField,
  type DocumentPhasePayload,
} from "./documents";
import {
  createEditHtmlTool,
  createFullHtmlTool,
  createInlineHtmlTool,
  type HtmlPhasePayload,
} from "./html";
import { createReactArtifactTool } from "./reactArtifact";
import type { ArtifactBinding } from "../validators";
import { createGenerateImageTool } from "./generateImage";
import {
  ASK_QUESTION_TOOL_NAME,
  createAskUserQuestionTool,
  type QuestionPhasePayload,
} from "./askQuestion";
import {
  createChatHistorySearchTool,
  type ChatHistoryPhasePayload,
} from "./historySearch";
import { createChartTool, type ChartSpec } from "./chart";
import {
  createSuggestIntegrationsTool,
  type IntegrationSuggestionPhasePayload,
} from "./integrationSuggest";
import {
  buildImagePrompt,
  callOpenRouterImageGeneration,
  ImageReferenceError,
  resolveImageReferences,
} from "./image";
import { readDeclaredSource } from "./bindingRead";
import {
  createMcpGatewayTools,
  isMcpToolName,
  MCP_CALL_TOOL_NAME,
  MCP_LIST_TOOLS_NAME,
  type McpServerConfig,
} from "./mcp";
import { resolveMcpLifecycleMetadata } from "./mcpMetadata";
import { resolveMcpServerConfigs } from "./mcpResolve";
import { createExaAnswerTool } from "./search";
import { createLoadSkillTool, LOAD_SKILL_NAME } from "./skills";
import { createWebFetchTool } from "./webFetch";
import { createWeatherTool, type WeatherPhasePayload } from "./weather";
import { resolveWeatherUnits } from "./openMeteo";
import {
  ASK_QUESTION_WRAPUP_INSTRUCTION,
  buildRepeatedCallsInstruction,
  decideToolStep,
  FINAL_RESPONSE_SYSTEM_INSTRUCTION,
} from "./toolPolicy";
import { StepOutputBuffer } from "./stepOutput";
import {
  fetchSupermemoryPromptContext,
  isSupermemoryConfigured,
  supermemoryContainerTagForUser,
  type SupermemoryPromptContext,
} from "../supermemory";
import { searchSupermemoryConversations } from "../supermemorySearch";
import type { ChatHistoryMatch } from "../historySearch";
import {
  buildAnalyticsInput,
  capForFinalize,
  estimatePromptContentTokens,
} from "./finalize";

// Replayed live 2026-08-09: a warm /v4/profile answers in ~1.4s and a cold
// isolate runs slower still, so anything tighter than this quietly starved
// every turn of its memory context (the old 1.2s cap meant the lookup lost
// the race essentially always). The lookup starts before the gate checks and
// runs concurrently with them, so the ceiling rarely costs first-token time.
const MEMORY_LOOKUP_TIMEOUT_MS = 5_000;
const SERVER_LOAD_REFRESH_AFTER_MS = 60_000;
const SLOW_STREAM_LOG_THRESHOLD_MS = 2_000;

const STREAM_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-cache, no-transform",
  "Content-Type": "text/plain; charset=utf-8",
  Vary: "Origin",
} as const;

function addStreamCorsHeaders(response: Response) {
  for (const [key, value] of Object.entries(STREAM_CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

// --- Server-driven stream plumbing -----------------------------------------
// The component's stream() helper needs a live HTTP Response to pump; these
// replicate its database half (the status state machine + sentence-batched
// chunk writes) for the scheduled-action path, where nobody holds a
// connection open.

// Claim the stream before generating. Flipping pending → streaming up front
// (rather than on the first token) closes the window where a stale legacy
// client's POST or a stray double-schedule could start a second generation.
async function claimAssistantStream(ctx: ActionCtx, streamId: string) {
  const status = await ctx.runQuery(
    components.persistentTextStreaming.lib.getStreamStatus,
    { streamId },
  );
  if (status !== "pending") return false;
  await ctx.runMutation(
    components.persistentTextStreaming.lib.setStreamStatus,
    { streamId, status: "streaming" },
  );
  return true;
}

function createChunkAppender(ctx: ActionCtx, streamId: string) {
  let pending = "";
  const write = (text: string, final: boolean) =>
    ctx.runMutation(components.persistentTextStreaming.lib.addChunk, {
      streamId,
      text,
      final,
    });
  return {
    // Buffer deltas and land them at sentence boundaries — the same cadence
    // the component's own HTTP wrapper used, so reactive readers see the
    // rhythm they always have.
    append: async (text: string) => {
      pending += text;
      if (text.includes(".") || text.includes("!") || text.includes("?")) {
        const chunk = pending;
        pending = "";
        await write(chunk, false);
      }
    },
    // Flush the tail and mark the stream done.
    finish: async () => {
      const chunk = pending;
      pending = "";
      await write(chunk, true);
    },
    // Best-effort: the message row's own error status is the source of truth;
    // the stream just shouldn't claim to still be running.
    fail: async () => {
      try {
        await ctx.runMutation(
          components.persistentTextStreaming.lib.setStreamStatus,
          { streamId, status: "error" },
        );
      } catch {
        // Losing this write changes nothing user-visible.
      }
    },
  };
}

function createStreamTimings() {
  const startedAt = Date.now();
  const marks: Record<string, number> = {};
  const meta: {
    assistantId?: Id<"messages">;
    model?: string;
    streamId?: string;
  } = {};
  let logged = false;
  return {
    setMeta(patch: Partial<typeof meta>) {
      Object.assign(meta, patch);
    },
    mark(label: string) {
      marks[label] = Date.now() - startedAt;
    },
    snapshot() {
      return {
        total_ms: Date.now() - startedAt,
        ...Object.fromEntries(
          Object.entries(marks).map(([label, value]) => [
            `${label}_ms`,
            value,
          ]),
        ),
      };
    },
    log(reason: string, force = false) {
      if (logged) return;
      const elapsedMs = Date.now() - startedAt;
      if (!force && elapsedMs < SLOW_STREAM_LOG_THRESHOLD_MS) return;
      logged = true;
      console.warn("assistant_stream_timing", {
        reason,
        ...meta,
        elapsedMs,
        ...marks,
      });
    },
  };
}

async function rejectGatedRequest({
  ctx,
  assistantId,
  gate,
}: {
  ctx: ActionCtx;
  assistantId: Id<"messages">;
  gate: Gate;
}) {
  await ctx.runMutation(internal.inference.setAssistantStatus, {
    assistantId,
    status: "error",
    content: `${GATE_SENTINEL_PREFIX}${gate.sentinel}`,
  });
}

// Reject a free user's send because the server-overload cap has been hit. Writes
// the overload sentinel as the assistant message so the client shows the vague
// "servers under extra load" notice instead of a hard error. Mirrors
// rejectGatedRequest but is its own state — this is a transient throttle, not a
// plan gate, so it never routes to the upgrade flow.
async function rejectOverloadedRequest({
  ctx,
  assistantId,
}: {
  ctx: ActionCtx;
  assistantId: Id<"messages">;
}) {
  await ctx.runMutation(internal.inference.setAssistantStatus, {
    assistantId,
    status: "error",
    content: OVERLOAD_SENTINEL,
  });
}

// Legacy HTTP entry. Generation is server-driven now — the send/retry
// mutations schedule runAssistantTurn directly, so a POST landing here is a
// stale tab from before the switch. 205 is the "someone else is driving"
// signal those clients have always answered by falling back to the reactive
// stream query, which is what carries every turn these days.
export async function handleStreamAssistant(
  _ctx: ActionCtx,
  _request: Request,
) {
  return addStreamCorsHeaders(new Response("", { status: 205 }));
}

// Run one assistant turn to completion, writing chunks into the streaming
// component as it goes. Scheduled with runAfter(0) by the mutation that
// minted the stream — the turn's life belongs to the deployment, not to
// whichever tab sent the message (W-134). `userId`/`userName` were captured
// by that (authenticated) mutation; a scheduled action has no ctx.auth.
export async function runAssistantTurn(
  ctx: ActionCtx,
  {
    streamId,
    userId,
    userName,
  }: { streamId: string; userId: string; userName?: string },
) {
  const timings = createStreamTimings();
  timings.setMeta({ streamId });
  timings.mark("bodyRead");

  const requestInfo = await ctx.runQuery(internal.inference.getRequestForStream, {
    streamId,
    userId,
    userName,
  });
  timings.setMeta({
    assistantId: requestInfo.assistantId,
    model: requestInfo.model,
  });
  const runMutation = createMutationQueue(ctx);
  timings.mark("requestInfo");

  const customerId = userId;
  timings.mark("identity");

  // A misconfigured deployment can't generate anything — say so on the
  // message instead of leaving the row to the watchdog.
  const failPreflight = async (reason: string) => {
    console.error("assistant_turn_preflight_failed", { streamId, reason });
    await ctx.runMutation(internal.inference.setAssistantStatus, {
      assistantId: requestInfo.assistantId,
      status: "error",
      content:
        "The server is missing part of its configuration, so this reply never started. This one's on us — try again in a bit.",
    });
  };

  const requestedModelKey = resolveModelKey(requestInfo.model);
  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  const exaApiKey = process.env.EXA_API_KEY || undefined;
  if (!openRouterApiKey) {
    return failPreflight("OPENROUTER_API_KEY");
  }
  // Web search is optional: without an Exa key a search turn runs without
  // the web instead of failing over a toggle this deployment can't honor.
  // The composer hides the toggle in that case (convex/features.ts), so
  // this only catches a stale tab.
  const searchEnabled = requestInfo.search && exaApiKey !== undefined;
  // Billing is optional (see createBillingClient): without it every gate
  // below stays open and nothing is deducted.
  const autumn = createBillingClient();

  // These checks are independent and all block token spend, so start them
  // together instead of stacking Convex + Autumn round trips. The customer
  // snapshot is one Autumn read that answers isPaid AND every gate below
  // locally, replacing what used to be ~11 separate check() round trips.
  const [multiplierEvent, customer] = await Promise.all([
    ctx.runQuery(internal.admin.getActiveMultiplierInternal, {}),
    autumn ? fetchBillingCustomer({ autumn, customerId }) : null,
  ]);
  // Fall back to the per-check path if the snapshot read failed, so a transient
  // Autumn blip degrades gracefully instead of misgating the request.
  // `isPlatinum` rides along: it costs nothing extra to read and decides two
  // things below — whether this turn bills at all, and whether a custom model
  // carries its usual premium.
  const { isPaid, isPlatinum } = !autumn
    ? UNBILLED_PLAN_STATE
    : customer
      ? snapshotPlanState(customer)
      : await readPlanState({ autumn, customerId });
  // The Free model is free-only: a paid customer who still has it selected is quietly
  // routed to their Fast tier. Everything downstream (gates, billing, the
  // actual OpenRouter call) uses the effective key.
  const modelKey = effectiveModelKeyFor(requestedModelKey, isPaid);
  // One read answers the console's Models-tab knobs: the catalog model a
  // wire slug names (custom models ride the wire as their OpenRouter slug
  // and book under the Auto key — always paid-only), the tier override
  // (reroutes a tier to another OpenRouter model — null means the hardcoded
  // MODEL_IDS default), and whether the tier is restricted to paid plans.
  // A slug that's since been deleted or disabled simply doesn't resolve, so
  // the request runs as plain Auto instead of failing. `modelSlug` is what
  // actually serves the request — analytics and finalize carry it so the
  // books never lie about which model ran.
  const modelConfig = await ctx.runQuery(
    internal.models.streamModelConfigInternal,
    { modelKey, wireModel: requestInfo.model },
  );
  const modelOverride = modelConfig.custom ?? modelConfig.override;
  const modelSlug = modelOverride?.slug ?? MODEL_IDS[modelKey];
  // Auto is a router, not a model: every request inside this turn can be served
  // by a different one, so nothing endpoint-bound (encrypted reasoning) may be
  // replayed between them.
  const unpinnedRoute = routesPerRequest(modelSlug);
  // Platinum's Fast tier is on the house. The turn still reports its true cost
  // to analytics — we very much want to know what we spent — it just never
  // touches the customer's usage pool or their per-message usage cost.
  const unmeteredTurn = isUnmeteredPlatinumTurn({
    isPlatinum,
    modelKey,
    isCustomModel: modelConfig.custom !== null,
  });
  timings.mark("preflightChecks");

  // Active usage-multiplier event (admin-configured). `multiplier` is a
  // deduction factor applied to what this request costs the user's usage pool
  // (e.g. 0.5 => "2x usage"). Fetched once; defaults to 1 (no-op) when no event
  // is running. `applyToFreeMessages` extends the scaling to the free-tier
  // per-message deduction.
  const usageFactor = multiplierEvent?.multiplier ?? 1;
  const scaleFreeMessages = multiplierEvent?.applyToFreeMessages === true;

  // Supermemory is a paid perk and can be switched off per user. When it's not
  // active we neither retrieve profile context nor store completed turns.
  // Incognito turns force it off regardless of the user's setting — an ephemeral
  // chat must never leak into long-term memory.
  // Memory is optional for the deployment too: without a Supermemory key it
  // simply stays off rather than failing the turn.
  const memoryActive =
    isPaid &&
    requestInfo.memoryEnabled &&
    !requestInfo.incognito &&
    isSupermemoryConfigured();
  const memoryContainerTag = supermemoryContainerTagForUser(customerId);

  // Kick off the memory lookup now — it's a slow external round trip (up to
  // MEMORY_LOOKUP_TIMEOUT_MS) that the prompt needs, but nothing before the
  // prompt build depends on it. Starting it here lets it run concurrently with
  // the gate checks, model setup and initial status write instead of blocking
  // the first token serially inside the stream writer. Awaited just before the
  // prompt is assembled; by then it's usually already resolved.
  const memoryContextPromise = memoryActive
    ? bestEffort(
        "Supermemory prompt lookup",
        fetchSupermemoryPromptContext({
          containerTag: memoryContainerTag,
          query: requestInfo.latestUserText,
        }),
        MEMORY_LOOKUP_TIMEOUT_MS,
      )
    : undefined;

  // Server-side backstop for the free-tier upload cap: free users can attach
  // files up to FREE_MAX_FILE_BYTES, and the UI blocks anything larger before
  // it's sent — but a hand-crafted request could still smuggle an oversized file
  // through. Reject before spending anything.
  if (!isPaid && requestInfo.hasOversizedAttachment) {
    return rejectGatedRequest({
      ctx,
      assistantId: requestInfo.assistantId,
      gate: UPLOAD_GATE,
    });
  }

  // Image turns never think or search — the composer forces both toggles off,
  // and a hand-crafted request shouldn't trip those gates on a tier where the
  // flags are meaningless. A custom catalog model that paints (imageOutput)
  // rides the Image tier's pipeline and entitlement, not the chat loop — the
  // Images API is model-generic, so the custom slug serves the paint.
  const customIsImage = modelConfig.custom?.capabilities.imageOutput === true;
  const isImageTurn = modelKey === "Image" || customIsImage;
  // Which tier's gates the request answers to: paints follow the Image
  // tier's Turbo+ rule regardless of which slug does the painting.
  const gateKey: ModelKey = customIsImage ? "Image" : modelKey;
  // The generateImage chat tool follows the Image tier's entitlement (Turbo
  // and up). Answered from the snapshot already in hand — a missing snapshot
  // falls back to plain isPaid rather than another Autumn round trip, erring
  // on the side of not withholding a paid perk over a transient blip.
  const imageToolAllowed =
    !isImageTurn &&
    (customer ? snapshotGateAllowed(customer, IMAGE_GATE) : isPaid);
  // The model's own gates: paid users keep the per-tier Autumn
  // differentiation; free users answer to the admin's restriction list — a
  // restricted tier rejects with its usual sentinel (falling back to the
  // any-paid gate when it has none, i.e. a restricted Free tier), and a
  // tier taken off the list waives the model gate entirely so free users
  // can use it, metered by their messages allowance as always.
  const modelGates: readonly Gate[] = isPaid
    ? MODEL_REQUIRED_FLAGS[gateKey]
    : modelConfig.restricted
      ? MODEL_REQUIRED_FLAGS[gateKey].length > 0
        ? MODEL_REQUIRED_FLAGS[gateKey]
        : [FREE_LOCKED_GATE]
      : [];
  const imagePass =
    !isPaid && modelKey === "Image" && !customIsImage
      ? await ctx.runQuery(internal.slots.imageAccessInternal, { customerId })
      : false;
  const requiredGates: Gate[] = [
    ...(imagePass ? [] : modelGates),
    ...(requestInfo.thinking && !isImageTurn ? [REASONING_GATE] : []),
    ...(searchEnabled && !isImageTurn ? [SEARCH_GATE] : []),
    isPaid ? USAGE_GATE : MESSAGES_GATE,
  ];

  const gateResults = autumn
    ? await Promise.all(
        requiredGates.map(async (gate) => ({
          gate,
          allowed: customer
            ? snapshotGateAllowed(customer, gate)
            : await checkAutumnGate({ autumn, customerId, gate }),
        })),
      )
    : [];
  timings.mark("autumnGates");
  const deniedGate = gateResults.find((result) => !result.allowed)?.gate;
  if (deniedGate) {
    // Funnel step 4 (W-155): running out of free messages — the one gate every
    // free user eventually meets. The other gates (a paid model, thinking,
    // search) are reaching for a perk, not hitting a ceiling, so they stay out
    // of the acquisition funnel. `repeat` because a ceiling is something people
    // walk into again next period; the event carries `first_time` either way.
    if (deniedGate.sentinel === MESSAGES_GATE.sentinel) {
      await ctx.scheduler.runAfter(0, internal.funnel.reachMilestone, {
        userId: customerId,
        milestone: "free_limit" as const,
        properties: { model: modelKey, thread_id: requestInfo.threadId },
        repeat: true,
      });
    }
    return rejectGatedRequest({
      ctx,
      assistantId: requestInfo.assistantId,
      gate: deniedGate,
    });
  }

  // Server-overload throttle (free users only). Use the cached PostHog daily
  // spend so a slow analytics read doesn't delay the model; refresh the cache in
  // the background when stale. Once spend crosses a tier, the per-day message
  // cap tightens below the normal allowance.
  if (autumn && !isPaid) {
    const freeLoad = await ctx.runQuery(
      internal.serverLoad.getFreeCostSnapshotInternal,
      {},
    );
    const shouldRefreshLoad =
      freeLoad.updatedAt === null ||
      Date.now() - freeLoad.updatedAt > SERVER_LOAD_REFRESH_AFTER_MS;
    if (shouldRefreshLoad) {
      await ctx.scheduler.runAfter(0, internal.serverLoad.refresh, {});
    }
    const overloadCap = resolveOverloadCap(freeLoad.freeCostUsd);
    if (overloadCap !== null) {
      // Reuse the snapshot fetched in preflight; only re-read on fallback.
      const { used } = customer
        ? snapshotFreeMessageUsage(customer)
        : await readFreeMessageUsage({ autumn, customerId });
      if (used >= overloadCap) {
        await captureServerEvent({
          event: "free_overload_throttled",
          distinctId: customerId,
          properties: {
            cap: overloadCap,
            used,
            thread_id: requestInfo.threadId,
          },
        });
        return rejectOverloadedRequest({
          ctx,
          assistantId: requestInfo.assistantId,
        });
      }
    }
  }
  timings.mark("freeThrottle");

  const model = createOpenRouterChatModel({
    apiKey: openRouterApiKey,
    modelKey,
    overrideSlug: modelOverride?.slug,
  });
  timings.mark("modelReady");

  const claimed = await claimAssistantStream(ctx, streamId);
  if (!claimed) {
    // Someone already drove (or killed) this stream — never generate twice.
    console.warn("assistant_turn_not_claimed", { streamId });
    return;
  }
  const chunks = createChunkAppender(ctx, streamId);
  const append = chunks.append;
  try {
    await (async () => {
      timings.mark("streamWriterStart");
      await runMutation(internal.inference.setAssistantStatus, {
        assistantId: requestInfo.assistantId,
        status:
          requestInfo.thinking && !isImageTurn ? "thinking" : "streaming",
      });
      timings.mark("initialStatus");

      let text = "";
      let firstTextDeltaSeen = false;
      const stepOutput = new StepOutputBuffer();
      const protectStepText =
        requestInfo.thinking || requestInfo.latestMessageHasRuntimeMentions;
      // The user can stop generation from the UI, which writes status
      // "stopped" to the assistant message. The HTTP action keeps running
      // independently, so we poll that status while streaming and abort the
      // model request when a stop is requested.
      const abortController = new AbortController();
      let stopped = false;
      let streamEnded = false;
      let terminalStatusWritten = false;
      let stopPollTimer: ReturnType<typeof setTimeout> | undefined;
      const STOP_CHECK_INTERVAL_MS = 400;

      const persistStopped = async () => {
        await runMutation(internal.inference.clearPendingPhases, {
          assistantId: requestInfo.assistantId,
        });
        await runMutation(internal.inference.setAssistantStatus, {
          assistantId: requestInfo.assistantId,
          status: "stopped",
          content: text,
        });
        terminalStatusWritten = true;
      };

      const appendVisibleText = async (delta: string) => {
        if (!delta) return;
        if (!firstTextDeltaSeen) {
          firstTextDeltaSeen = true;
          timings.mark("firstTextDelta");
        }
        await endReasoning();
        if (text.length === 0) {
          await runMutation(internal.inference.setAssistantStatus, {
            assistantId: requestInfo.assistantId,
            status: "streaming",
          });
        }
        text += delta;
        await append(delta);
      };

      // Reasoning is streamed as its own block (before/between text). We open a
      // pending "thought" phase when reasoning starts, accumulate the raw text,
      // and finalize it with a duration + the captured reasoning when it ends.
      let reasoningActive = false;
      let reasoningText = "";
      let reasoningStart = 0;
      const startReasoning = async () => {
        if (reasoningActive) return;
        reasoningActive = true;
        reasoningText = "";
        reasoningStart = Date.now();
        await runMutation(internal.inference.addAssistantPhase, {
          assistantId: requestInfo.assistantId,
          phase: {
            kind: "thought",
            durationMs: 0,
            contentOffset: text.length,
            pending: true,
          },
        });
      };
      const endReasoning = async () => {
        if (!reasoningActive) return;
        reasoningActive = false;
        await runMutation(internal.inference.finalizeLastPendingThought, {
          assistantId: requestInfo.assistantId,
          durationMs: Date.now() - reasoningStart,
          text: reasoningText,
        });
      };

      // Shared by both calculator tools: write the finished calculation onto
      // the message's calc phase (filling the pending one when it exists).
      const persistCalc = async (calc: CalcPhasePayload) => {
        const { callIdx: _callIdx, ...fields } = calc;
        await runMutation(internal.inference.finalizeLastPendingCalc, {
          assistantId: requestInfo.assistantId,
          contentOffset: text.length,
          ...fields,
        });
      };

      // Poll for a user-requested stop OUT of the token loop. The old approach
      // awaited a Convex query inline before each stream part (throttled to
      // STOP_CHECK_INTERVAL_MS), which stalled the token flow ~every 400ms — a
      // handful of blocking round trips stitched through every response. Instead
      // run the status read on a background timer that just flips `stopped`; the
      // hot loop checks that flag synchronously, so tokens are never held up.
      //
      // The same timer doubles as the turn's liveness beacon: every ~25s it
      // stamps `heartbeatAt` on the assistant row, which is how the watchdog
      // cron (streamWatchdog.ts) knows this handler is still alive. If this
      // action dies without a terminal write, the beats stop and the watchdog
      // settles the message instead of leaving it shimmering forever.
      const HEARTBEAT_INTERVAL_MS = 25_000;
      let lastHeartbeatAt = Date.now();
      const scheduleStopPoll = () => {
        stopPollTimer = setTimeout(() => {
          void (async () => {
            if (streamEnded || stopped) return;
            let status: string | null = null;
            try {
              status = await ctx.runQuery(
                internal.inference.getAssistantStatus,
                { assistantId: requestInfo.assistantId },
              );
            } catch {
              // Transient read error — leave `stopped` alone and keep polling.
            }
            if (streamEnded || stopped) return;
            if (status === "stopped") {
              stopped = true;
              abortController.abort();
              return;
            }
            if (Date.now() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
              lastHeartbeatAt = Date.now();
              // Straight to runMutation, NOT the serialized mutation queue —
              // liveness must keep beating even if the queue is wedged.
              void ctx
                .runMutation(internal.inference.recordAssistantHeartbeat, {
                  assistantId: requestInfo.assistantId,
                })
                .catch(() => {});
            }
            scheduleStopPoll();
          })();
        }, STOP_CHECK_INTERVAL_MS);
      };
      const stopStopPoll = () => {
        streamEnded = true;
        if (stopPollTimer !== undefined) {
          clearTimeout(stopPollTimer);
          stopPollTimer = undefined;
        }
      };

      // Shared by the weather tool. When visible, write the finished snapshot
      // onto the message's weather phase (filling the pending one) so the widget
      // renders. In invisible mode the model just wanted the data, so drop the
      // pending phase instead — no widget is ever shown.
      const persistWeather = async (
        weather: WeatherPhasePayload,
        visible: boolean,
      ) => {
        const { current, units, ...rest } = weather;
        if (visible) {
          await runMutation(internal.inference.finalizeLastPendingWeather, {
            assistantId: requestInfo.assistantId,
            contentOffset: text.length,
            place: rest.place,
            approximate: rest.approximate,
            latitude: rest.latitude,
            longitude: rest.longitude,
            timezone: rest.timezone,
            tempUnit: units.temp,
            windUnit: units.wind,
            temp: current.temp,
            apparentTemp: current.apparentTemp,
            humidity: current.humidity,
            windSpeed: current.windSpeed,
            code: current.code,
            isDay: current.isDay,
            ...(current.precipitation !== undefined
              ? { precipitation: current.precipitation }
              : {}),
            hourly: rest.hourly,
            daily: rest.daily,
          });
        } else {
          await runMutation(internal.inference.dropLastPendingWeather, {
            assistantId: requestInfo.assistantId,
          });
        }
        await captureServerEvent({
          event: "weather_fetched",
          distinctId: customerId,
          properties: {
            place: rest.place,
            approximate: rest.approximate,
            visible,
            thread_id: requestInfo.threadId,
          },
        });
      };

      // Write a validated chart spec onto the message's chart phase, filling
      // the pending one opened on tool-input-start so the card draws. Specs
      // the tool rejected never reach here — the model gets the reason back
      // and the stray pending phase is swept at turn end.
      const persistChart = async (chart: ChartSpec) => {
        await runMutation(internal.inference.finalizeLastPendingChart, {
          assistantId: requestInfo.assistantId,
          contentOffset: text.length,
          chart,
        });
        await captureServerEvent({
          event: "chart_rendered",
          distinctId: customerId,
          properties: {
            chart_type: chart.type,
            series: chart.series.length,
            stacked: chart.stacked === true,
            thread_id: requestInfo.threadId,
          },
        });
      };

      // Finalize an MCP tool call onto the message's pending `mcp` phase and
      // record an analytics event (mirrors the web_fetch capture).
      const persistMcp = async (info: {
        server: string;
        tool: string;
        ok: boolean;
        error?: string;
      }) => {
        const lifecycle = resolveMcpLifecycleMetadata(
          requestInfo.mcpServers,
          info.server,
          info.tool,
        );
        await runMutation(internal.inference.finalizeLastPendingMcp, {
          assistantId: requestInfo.assistantId,
          contentOffset: text.length,
          server: info.server,
          tool: info.tool,
          ...lifecycle,
          ok: info.ok,
          ...(info.error ? { error: info.error } : {}),
        });
        await captureServerEvent({
          event: "mcp_tool_called",
          distinctId: customerId,
          properties: {
            server: info.server,
            tool: info.tool,
            ok: info.ok,
            thread_id: requestInfo.threadId,
          },
        });
      };

      // Finalize a load_skill call onto the message's pending `skill` phase
      // and record an analytics event (mirrors the MCP capture).
      const persistSkill = async (info: {
        name: string;
        ok: boolean;
        error?: string;
      }) => {
        await runMutation(internal.inference.finalizeLastPendingSkill, {
          assistantId: requestInfo.assistantId,
          contentOffset: text.length,
          name: info.name,
          ok: info.ok,
          ...(info.error ? { error: info.error } : {}),
        });
        await captureServerEvent({
          event: "skill_loaded",
          distinctId: customerId,
          properties: {
            skill: info.name,
            ok: info.ok,
            thread_id: requestInfo.threadId,
          },
        });
      };

      // Settle a suggestIntegrations call: the pick becomes an install card on
      // the message's pending `integrationSuggestion` phase; an empty result
      // drops the phase instead (nothing to card). The search half of the flow
      // settles the same way but stays out of the analytics — it isn't a store
      // miss, it's the model still choosing, and counting it would bury the
      // misses that actually tell us what the store is short of.
      const persistIntegrationSuggestion = async (
        payload: IntegrationSuggestionPhasePayload,
      ) => {
        if (payload.items.length > 0) {
          await runMutation(
            internal.inference.finalizeLastPendingIntegrationSuggestion,
            {
              assistantId: requestInfo.assistantId,
              query: payload.query,
              items: payload.items.map((item) => ({
                integrationId: item.integrationId as Id<"integrations">,
                name: item.name,
              })),
              contentOffset: text.length,
            },
          );
        } else {
          await runMutation(
            internal.inference.dropLastPendingIntegrationSuggestion,
            { assistantId: requestInfo.assistantId },
          );
        }
        if (payload.stage === "searched") return;
        await captureServerEvent({
          event: "integrations_suggested",
          distinctId: customerId,
          properties: {
            query: payload.query,
            shown: payload.items.length,
            integrations: payload.items.map((item) => item.name),
            thread_id: requestInfo.threadId,
          },
        });
      };

      // Settle an askUserQuestion call: the questions land on the message's
      // pending `question` phase (an empty list drops it instead), and the
      // flag lets the turn end form-first without tripping the empty-reply
      // repair pass below.
      let askedUserQuestion = false;
      const persistAskQuestion = async (payload: QuestionPhasePayload) => {
        if (payload.questions.length > 0) {
          askedUserQuestion = true;
        }
        await runMutation(internal.inference.finalizeLastPendingQuestion, {
          assistantId: requestInfo.assistantId,
          questions: payload.questions,
          contentOffset: text.length,
        });
        await captureServerEvent({
          event: "question_form_shown",
          distinctId: customerId,
          properties: {
            questions: payload.questions.length,
            types: payload.questions.map((question) => question.type),
            thread_id: requestInfo.threadId,
          },
        });
      };

      // Settle a searchChatHistory call onto the message's pending `history`
      // phase and record an analytics event. The zero-match case still
      // finalizes (the chip says the archives came up empty) — the misses tell
      // us whether keyword search is cutting it or vector search is warranted.
      const persistHistorySearch = async (
        payload: ChatHistoryPhasePayload,
      ) => {
        await runMutation(internal.inference.finalizeLastPendingHistory, {
          assistantId: requestInfo.assistantId,
          query: payload.query,
          matches: payload.matches,
          contentOffset: text.length,
        });
        await captureServerEvent({
          event: "chat_history_searched",
          distinctId: customerId,
          properties: {
            query: payload.query,
            matches: payload.matches,
            thread_id: requestInfo.threadId,
          },
        });
      };

      // Kick off a background paint for a generateImage call: one mutation
      // stamps the prompt onto the pending `image` phase and schedules the
      // worker atomically, then the tool returns immediately — the paint can
      // take minutes without holding this stream open (which is what used to
      // time image generations out). Billing, finalizing, and analytics all
      // live in the worker (see imageWorker.ts).
      const startImagePaint = async ({
        prompt,
        callIdx,
      }: {
        prompt: string;
        callIdx: number;
      }) => {
        await runMutation(internal.inference.beginImageGeneration, {
          assistantId: requestInfo.assistantId,
          threadId: requestInfo.threadId,
          userId: customerId,
          prompt,
          callIdx,
          contentOffset: text.length,
          streamId: requestInfo.streamId,
          billingKey: `${requestInfo.assistantId}:${requestInfo.streamId}:image:${callIdx}`,
        });
        await captureServerEvent({
          event: "image_paint_started",
          distinctId: customerId,
          properties: {
            thread_id: requestInfo.threadId,
            via: "tool",
            call_idx: callIdx,
          },
        });
      };

      // --- Live document streaming -------------------------------------------
      // createDocument's body arrives as the tool call's JSON input. We open the
      // documents row on tool-input-start (so the card + panel latch on), then
      // patch the partial title/content into it as the input streams — throttled,
      // since the model emits many tiny deltas. `finalizeDocumentCall` writes the
      // complete body and flips the row to "complete" once the input is whole.
      type DocStream = {
        documentId: Id<"documents"> | null;
        ready: Promise<Id<"documents"> | null>;
        format: DocumentFormat;
        raw: string;
        title: string;
        content: string;
        fileName: string;
        language: string;
        lastFlush: number;
      };
      const docStreams = new Map<string, DocStream>();
      const finishedDocCreates = new Map<string, Id<"documents">>();

      const flushDocStream = async (s: DocStream) => {
        if (!s.documentId) return; // row not inserted yet; finalize writes it
        s.lastFlush = Date.now();
        await runMutation(internal.documents.patchStreamingContent, {
          documentId: s.documentId,
          title: s.title,
          content: s.content,
          ...(s.format === "code"
            ? { fileName: s.fileName, language: s.language }
            : {}),
        });
      };

      // Open the streaming row + pending `document` phase for a createDocument
      // call keyed by its tool-call id. Called the moment whirl starts the call
      // (tool-input-start) so the card's progress bar shows while it writes;
      // also called on tool-call for providers that never stream the input, so
      // those don't skip the progress bar entirely. Idempotent per id.
      const ensureDocStream = (
        toolCallId: string,
        format: DocumentFormat,
        contentOffset = text.length,
      ): DocStream | null => {
        if (finishedDocCreates.has(toolCallId)) return null;
        const existing = docStreams.get(toolCallId);
        if (existing) return existing;
        const entry: DocStream = {
          documentId: null,
          ready: Promise.resolve(null),
          format,
          raw: "",
          title: "",
          content: "",
          fileName: "",
          language: "",
          lastFlush: 0,
        };
        // Register BEFORE awaiting the insert, so execute() finalization for a
        // very fast tool call sees the in-flight row and waits instead of
        // creating a fallback document.
        docStreams.set(toolCallId, entry);
        entry.ready = (async () => {
          const { documentId } = await runMutation(
            internal.documents.openStreamingDocument,
            {
              threadId: requestInfo.threadId,
              userId: customerId,
              assistantId: requestInfo.assistantId,
              format,
              contentOffset,
            },
          );
          entry.documentId = documentId;
          return documentId;
        })();
        return entry;
      };

      const openDocStream = async (
        toolCallId: string,
        format: DocumentFormat,
      ): Promise<void> => {
        const entry = ensureDocStream(toolCallId, format);
        if (!entry) return;
        await entry.ready;
        if (entry.title || entry.content) {
          await flushDocStream(entry);
        }
      };

      const completeDocToolCall = (
        toolCallId: string,
        documentId: Id<"documents">,
      ) => {
        docStreams.delete(toolCallId);
        finishedDocCreates.set(toolCallId, documentId);
      };

      // Finalize a document tool call onto the message's pending `document`
      // phase and record an analytics event. Create and edit share this; `op`
      // distinguishes them on the card and in the event.
      const persistDocument = async (payload: DocumentPhasePayload) => {
        await runMutation(internal.inference.finalizeLastPendingDocument, {
          assistantId: requestInfo.assistantId,
          contentOffset: text.length,
          op: payload.op,
          documentId: payload.documentId,
          ...(payload.title !== undefined ? { title: payload.title } : {}),
          ...(payload.editCount !== undefined
            ? { editCount: payload.editCount }
            : {}),
          ...(payload.ok !== undefined ? { ok: payload.ok } : {}),
          ...(payload.error !== undefined ? { error: payload.error } : {}),
        });
        await captureServerEvent({
          event:
            payload.op === "create"
              ? "document_created"
              : "document_edited_by_whirl",
          distinctId: customerId,
          properties: {
            document_id: payload.documentId,
            thread_id: requestInfo.threadId,
            ...(payload.editCount !== undefined
              ? { edit_count: payload.editCount }
              : {}),
            ...(payload.ok !== undefined ? { ok: payload.ok } : {}),
          },
        });
      };

      // Close out a createDocument call: write the final body and flip the row
      // to "complete", reusing the row the stream loop opened. Falls back to
      // creating one here for the rare provider that delivers the whole tool
      // input in one shot (no tool-input-start/delta ever seen).
      const finalizeDocumentCall = async ({
        toolCallId,
        title,
        content,
        format,
        fileName,
        language,
      }: {
        toolCallId: string;
        title: string;
        content: string;
        format: DocumentFormat;
        fileName?: string;
        language?: string;
      }) => {
        const alreadyFinished = finishedDocCreates.get(toolCallId);
        if (alreadyFinished) return { documentId: alreadyFinished };

        const streamed = ensureDocStream(toolCallId, format);
        if (streamed) {
          const documentId = await streamed.ready;
          if (documentId) {
            await runMutation(internal.documents.finalizeDocument, {
              documentId,
              title,
              content,
              format,
              ...(fileName !== undefined ? { fileName } : {}),
              ...(language !== undefined ? { language } : {}),
            });
            completeDocToolCall(toolCallId, documentId);
            return { documentId };
          }
        }
        const { documentId } = await runMutation(
          internal.documents.openStreamingDocument,
          {
            threadId: requestInfo.threadId,
            userId: customerId,
            assistantId: requestInfo.assistantId,
            format,
            contentOffset: text.length,
          },
        );
        await runMutation(internal.documents.finalizeDocument, {
          documentId,
          title,
          content,
          format,
          ...(fileName !== undefined ? { fileName } : {}),
          ...(language !== undefined ? { language } : {}),
        });
        completeDocToolCall(toolCallId, documentId);
        return { documentId };
      };

      // Settle a createDocument stream whose tool call never completed — the
      // turn was stopped, the provider errored, or the call itself died (a
      // truncated or malformed JSON input is the classic way a large document
      // "never works"). The content already streamed into the row, so salvage
      // it: flip the row to "complete" with whatever arrived and settle the
      // pending chat phase so the card survives instead of vanishing. A stream
      // that never received a byte drops its pending card instead — there's
      // nothing to show.
      const settleOpenDocStream = async (toolCallId: string) => {
        const openStream = docStreams.get(toolCallId);
        if (!openStream) return;
        docStreams.delete(toolCallId);
        const documentId = await openStream.ready;
        if (!documentId) return;
        await runMutation(internal.documents.finalizeDocument, {
          documentId,
          title: openStream.title || "Untitled",
          content: openStream.content,
          format: openStream.format,
          ...(openStream.format === "code"
            ? {
                fileName: openStream.fileName || "untitled.txt",
                language: openStream.language || "text",
              }
            : {}),
        });
        finishedDocCreates.set(toolCallId, documentId);
        if (openStream.content.trim()) {
          await runMutation(internal.inference.finalizeLastPendingDocument, {
            assistantId: requestInfo.assistantId,
            contentOffset: text.length,
            op: "create",
            documentId,
            title: openStream.title || "Untitled",
            ok: true,
          });
        } else {
          await runMutation(internal.inference.dropPendingDocumentPhase, {
            assistantId: requestInfo.assistantId,
            op: "create",
          });
        }
      };

      // If a turn is stopped or errors while createDocument bodies are still
      // streaming, their rows would be stuck "streaming" forever. Settle every
      // open stream so the panel lands on an editable doc. Idempotent.
      const finalizeOpenDocStreams = async () => {
        for (const id of [...docStreams.keys()]) {
          await settleOpenDocStream(id);
        }
      };

      // --- HTML streaming (paid-only) ----------------------------------------
      // createInlineHtml and createHtmlPage both work just like createDocument:
      // the body arrives as the tool call's JSON input. Open the row on
      // tool-input-start so the card (and, for full pages, the auto-opened side
      // panel) latches on, patch the partial html as it streams (throttled),
      // and finalize when the input is whole.
      // createReactArtifact rides this same machinery: same table, same row
      // lifecycle, same cards. Only two things differ — the runtime stamped on
      // the row, and which input field carries the body ("html" vs "code").
      type HtmlStream = {
        // Null until the row insert resolves. The entry is registered
        // synchronously (before the insert is awaited), so an execute() that
        // fires during that window finds it and reuses the row via `ready`
        // instead of taking the fallback path and creating a SECOND (orphaned,
        // forever-"streaming") row.
        htmlId: Id<"htmlArtifacts"> | null;
        ready: Promise<void>;
        mode: "inline" | "full";
        runtime: "html" | "react";
        bodyField: "html" | "code";
        raw: string;
        title: string;
        content: string;
        lastFlush: number;
      };
      const htmlStreams = new Map<string, HtmlStream>();
      // MCP gateway inputs, accumulated as they stream so the integration and
      // tool names can be stamped onto the pending phase the moment their
      // fields close. Discovery is a real phase too: if initialization fails,
      // the attempted integration still belongs in the activity history.
      const mcpPhaseStreams = new Map<
        string,
        {
          raw: string;
          described: boolean;
          gatewayTool: string;
        }
      >();
      // HTML creates whose execute() already finalized. The trailing
      // `tool-call` stream part often arrives AFTER execute finished (the part
      // loop lags behind on awaited mutations), and finalize deletes the map
      // entry — without this guard that late part reopened the stream, adding
      // a second pending phase (a stray "working" card until turn end) and an
      // orphaned row. Mirrors the doc path's finishedDocCreates.
      const finishedHtmlCreates = new Set<string>();

      const flushHtmlStream = async (s: HtmlStream) => {
        if (!s.htmlId) return; // row not inserted yet; finalize writes the body
        s.lastFlush = Date.now();
        await runMutation(internal.html.patchHtmlContent, {
          htmlId: s.htmlId,
          content: s.content,
          title: s.title,
        });
      };

      const openHtmlStream = (
        toolCallId: string,
        mode: "inline" | "full",
        runtime: "html" | "react" = "html",
      ): Promise<void> => {
        if (finishedHtmlCreates.has(toolCallId)) {
          return Promise.resolve();
        }
        const existing = htmlStreams.get(toolCallId);
        if (existing) return existing.ready;
        const offset = text.length;
        const entry: HtmlStream = {
          htmlId: null,
          ready: Promise.resolve(),
          mode,
          runtime,
          bodyField: runtime === "react" ? "code" : "html",
          raw: "",
          title: "",
          content: "",
          lastFlush: 0,
        };
        // Register BEFORE awaiting the insert, so a concurrent finalize for this
        // tool call sees the in-flight row and waits on `ready` for it.
        htmlStreams.set(toolCallId, entry);
        entry.ready = (async () => {
          // Show the "Drawing a visualization" / "Building the page" card the
          // instant the tool starts — before the row insert round-trips — so
          // there's a clear in-progress state even when the tool input arrives
          // in one shot. The htmlId gets attached below once the row exists, so
          // the card can then latch onto the live row and stream.
          await runMutation(internal.inference.addAssistantPhase, {
            assistantId: requestInfo.assistantId,
            phase: {
              kind: "html",
              mode,
              op: "create",
              contentOffset: offset,
              pending: true,
            },
          });
          const { htmlId } = await runMutation(
            internal.html.createStreamingHtml,
            {
              threadId: requestInfo.threadId,
              userId: customerId,
              kind: mode,
              runtime,
              createdByMessageId: requestInfo.assistantId,
            },
          );
          entry.htmlId = htmlId;
          await runMutation(internal.inference.attachStreamingHtmlId, {
            assistantId: requestInfo.assistantId,
            htmlId,
            mode,
          });
        })();
        return entry.ready;
      };

      // Finalize any HTML tool call (inline create, full create, or edit) onto
      // the message's pending `html` phase and record an analytics event.
      const persistHtml = async (payload: HtmlPhasePayload) => {
        await runMutation(internal.inference.finalizeLastPendingHtml, {
          assistantId: requestInfo.assistantId,
          contentOffset: text.length,
          op: payload.op,
          mode: payload.mode,
          htmlId: payload.htmlId,
          ...(payload.title !== undefined ? { title: payload.title } : {}),
          ...(payload.editCount !== undefined
            ? { editCount: payload.editCount }
            : {}),
          ...(payload.ok !== undefined ? { ok: payload.ok } : {}),
          ...(payload.error !== undefined ? { error: payload.error } : {}),
        });
        await captureServerEvent({
          event:
            payload.op === "edit"
              ? "html_edited_by_whirl"
              : payload.mode === "full"
                ? "full_html_requested"
                : "inline_html_created",
          distinctId: customerId,
          properties: {
            html_id: payload.htmlId,
            mode: payload.mode,
            thread_id: requestInfo.threadId,
            ...(payload.editCount !== undefined
              ? { edit_count: payload.editCount }
              : {}),
          },
        });
      };

      // Close out a createInlineHtml/createHtmlPage call: write the final body
      // and flip the row to "complete", reusing the row the stream loop opened.
      // Falls back to creating one here for a provider that delivers the whole
      // input at once.
      const finalizeHtmlCall = async ({
        toolCallId,
        title,
        html,
        mode,
        runtime = "html",
        bindings,
      }: {
        toolCallId: string;
        title: string;
        html: string;
        mode: "inline" | "full";
        runtime?: "html" | "react";
        /** React artifacts only: the declared, already-validated data reads. */
        bindings?: ArtifactBinding[];
      }) => {
        // Mark finished up front so a stream part processed mid-finalize can
        // never reopen this call's stream.
        finishedHtmlCreates.add(toolCallId);
        const streamed = htmlStreams.get(toolCallId);
        if (streamed) {
          await streamed.ready; // wait for the in-flight insert + pending phase
          htmlStreams.delete(toolCallId);
          if (streamed.htmlId) {
            await runMutation(internal.html.finalizeStreamingHtml, {
              htmlId: streamed.htmlId,
              title,
              content: html,
              kind: mode,
              ...(bindings ? { bindings } : {}),
            });
            // The row may have opened inline and only learned it was a panel
            // artifact from the completed input; align the card with it.
            if (runtime === "react" && streamed.mode !== mode) {
              streamed.mode = mode;
              if (mode === "full") {
                await runMutation(
                  internal.inference.promoteStreamingArtifactToFull,
                  {
                    assistantId: requestInfo.assistantId,
                    htmlId: streamed.htmlId,
                  },
                );
              }
            }
            return { htmlId: streamed.htmlId };
          }
        }
        const { htmlId } = await runMutation(internal.html.createStreamingHtml, {
          threadId: requestInfo.threadId,
          userId: customerId,
          kind: mode,
          runtime,
          createdByMessageId: requestInfo.assistantId,
        });
        await runMutation(internal.html.finalizeStreamingHtml, {
          htmlId,
          title,
          content: html,
          ...(bindings ? { bindings } : {}),
        });
        return { htmlId };
      };

      // Settle an html stream whose tool call never completed — a stop, a
      // provider error, or a broken tool-call input. Mirrors
      // settleOpenDocStream: salvage the streamed body into a "complete" row
      // and settle the pending chat phase, or drop the phase when nothing
      // usable arrived so the card doesn't linger.
      const settleOpenHtmlStream = async (toolCallId: string) => {
        const openStream = htmlStreams.get(toolCallId);
        if (!openStream) return;
        htmlStreams.delete(toolCallId);
        await openStream.ready;
        if (!openStream.htmlId) return;
        finishedHtmlCreates.add(toolCallId);

        /* Half an HTML document still renders something worth keeping, which
           is why the salvage path exists. Half a JSX module is a syntax error
           and nothing else — so an interrupted react artifact is failed
           outright and its card dropped, rather than salvaged into a card
           whose only content is a parse error. */
        if (openStream.runtime === "react") {
          await runMutation(internal.html.failStreamingHtml, {
            htmlId: openStream.htmlId,
            error: "Whirl stopped before this app was finished.",
          });
          await runMutation(internal.inference.dropPendingHtmlPhase, {
            assistantId: requestInfo.assistantId,
            op: "create",
          });
          return;
        }

        await runMutation(internal.html.finalizeStreamingHtml, {
          htmlId: openStream.htmlId,
          title: openStream.title,
          content: openStream.content,
        });
        if (openStream.content.trim()) {
          await runMutation(internal.inference.finalizeLastPendingHtml, {
            assistantId: requestInfo.assistantId,
            contentOffset: text.length,
            op: "create",
            mode: openStream.mode,
            htmlId: openStream.htmlId,
            ...(openStream.title ? { title: openStream.title } : {}),
            ok: true,
          });
        } else {
          await runMutation(internal.inference.dropPendingHtmlPhase, {
            assistantId: requestInfo.assistantId,
            op: "create",
          });
        }
      };

      // If a turn is stopped or errors while html bodies are still streaming,
      // settle every open stream so the cards land instead of spinning forever.
      const finalizeOpenHtmlStreams = async () => {
        for (const id of [...htmlStreams.keys()]) {
          await settleOpenHtmlStream(id);
        }
      };

      const persistComplete = async () => {
        // A model can abandon a streamed artifact/tool call after opening it.
        // Settle every open row and pending phase before marking the message
        // complete so the UI never has a finished reply with live indicators.
        await finalizeOpenDocStreams();
        await finalizeOpenHtmlStreams();
        await runMutation(internal.inference.clearPendingPhases, {
          assistantId: requestInfo.assistantId,
        });
        await runMutation(internal.inference.setAssistantStatus, {
          assistantId: requestInfo.assistantId,
          status: "complete",
          content: text,
        });
        terminalStatusWritten = true;
      };

      // --- Image tier ---------------------------------------------------------
      // gpt-image-2 turns skip the whole chat pipeline — no tools, memory
      // lookup, MCP or prompt build. One Images API request; the bytes land in
      // storage, the attachment lands on the assistant row (which the client
      // watches reactively — that's what morphs the skeleton into the picture),
      // and billing rides the normal finalize path. Everything after this block
      // is chat-only.
      if (isImageTurn) {
        scheduleStopPoll();
        const generationStartedAt = Date.now();
        const { userImages, lastGeneratedImage } = requestInfo.imageRequest;
        const prompt = buildImagePrompt({
          text: requestInfo.imageRequest.prompt,
          userImages,
          hasPreviousImage: lastGeneratedImage !== null,
        });
        // The user's own attachments ride first (keeping the @imgN numbering
        // the composer showed), then the previous generated image — the edit
        // target on follow-up turns — always last, matching the prompt labels.
        const referenceSources = [
          ...userImages,
          ...(lastGeneratedImage ? [lastGeneratedImage] : []),
        ];

        try {
          // Read every reference out of storage and inline it: the Images API
          // won't fetch a Convex storage link (see resolveImageReferences).
          const inputReferences = await resolveImageReferences({
            storage: ctx.storage,
            references: referenceSources,
          });
          timings.mark("imageReferences");
          const result = await callOpenRouterImageGeneration({
            apiKey: openRouterApiKey,
            prompt,
            inputReferences,
            abortSignal: abortController.signal,
            model: modelSlug,
          });
          stopStopPoll();
          const generationDurationMs = Date.now() - generationStartedAt;
          timings.mark("providerDone");
          if (stopped) {
            await persistStopped();
            timings.mark("stopped");
            const performanceSnapshot = timings.snapshot();
            await bestEffort(
              "stopped image performance analytics",
              captureBackendPerformance({
                operation: "image_generation",
                outcome: "stopped",
                durationMs: performanceSnapshot.total_ms,
                distinctId: customerId,
                properties: {
                  ...performanceSnapshot,
                  model: modelSlug,
                  tier: modelKey,
                },
              }),
            );
            timings.log("stopped", true);
            return;
          }

          for (const [index, image] of result.images.entries()) {
            const storageId = await ctx.storage.store(image.blob);
            const extension =
              image.mediaType.split("/")[1]?.split("+")[0] || "png";
            await runMutation(internal.inference.attachGeneratedImage, {
              assistantId: requestInfo.assistantId,
              attachment: {
                id: crypto.randomUUID(),
                name:
                  result.images.length > 1
                    ? `generated-image-${index + 1}.${extension}`
                    : `generated-image.${extension}`,
                size: image.blob.size,
                type: image.mediaType,
                storageId,
              },
            });
          }

          await persistComplete();
          timings.mark("persistComplete");

          await bestEffort(
            "assistant stats persistence",
            runMutation(internal.inference.setAssistantStats, {
              assistantId: requestInfo.assistantId,
              durationMs: generationDurationMs,
            }),
          );

          // Images bill at a marked-up rate: the user's pool is deducted a
          // multiple of what OpenRouter charged. The marked-up figure flows
          // through finalize untouched, so the deduction, the persisted
          // usageCost and the LLM analytics all agree on one number. The raw
          // provider cost is kept on the image_generated event below.
          const billedCost =
            typeof result.cost === "number"
              ? result.cost * IMAGE_COST_MARKUP
              : undefined;
          if (billedCost === undefined) {
            // A paint we can't price is a paint we eat. Nothing downstream can
            // tell the difference, so this is the only place it can be seen.
            console.warn("image_turn_missing_cost", {
              assistantId: requestInfo.assistantId,
              customerId,
              model: modelSlug,
            });
          }
          await ctx.scheduler.runAfter(
            0,
            internal.inference.finalizeAssistantTurn,
            {
              assistantId: requestInfo.assistantId,
              threadId: requestInfo.threadId,
              streamId: requestInfo.streamId,
              customerId,
              model: modelKey,
              modelSlug,
              isPaid,
              // Paints always bill, Platinum included — the freebie is the
              // Fast tier, not the picture.
              unmetered: false,
              incognito: requestInfo.incognito,
              memoryActive,
              memoryContainerTag,
              usageFactor,
              scaleFreeMessages,
              thinking: false,
              search: false,
              latencyMs: generationDurationMs,
              cost: billedCost,
              text: "",
              latestUserText: capForFinalize(requestInfo.latestUserText),
              analyticsInput: [{ role: "user", content: prompt }],
              performance: timings.snapshot(),
            },
          );
          await bestEffort(
            "image generation analytics",
            captureServerEvent({
              event: "image_generated",
              distinctId: customerId,
              properties: {
                thread_id: requestInfo.threadId,
                edited: lastGeneratedImage !== null,
                reference_count: inputReferences.length,
                image_count: result.images.length,
                provider_cost: result.cost,
                duration_ms: generationDurationMs,
                image_model: result.model,
              },
            }),
          );
          timings.mark("scheduledFinalize");
          timings.log("imageComplete");
        } catch (error) {
          stopStopPoll();
          if (stopped || abortController.signal.aborted) {
            await persistStopped();
            timings.mark("stopped");
            const performanceSnapshot = timings.snapshot();
            await bestEffort(
              "stopped image performance analytics",
              captureBackendPerformance({
                operation: "image_generation",
                outcome: "stopped",
                durationMs: performanceSnapshot.total_ms,
                distinctId: customerId,
                properties: {
                  ...performanceSnapshot,
                  model: modelSlug,
                  tier: modelKey,
                },
              }),
            );
            timings.log("stopped", true);
            return;
          }
          await runMutation(internal.inference.clearPendingPhases, {
            assistantId: requestInfo.assistantId,
          });
          await runMutation(internal.inference.setAssistantStatus, {
            assistantId: requestInfo.assistantId,
            status: "error",
            content:
              // A reference image that never made it out of storage isn't the
              // provider's fault — say what actually went wrong.
              error instanceof ImageReferenceError
                ? `Image generation failed: ${error.message}.`
                : error instanceof Error
                  ? `AI provider error: ${error.message}`
                  : "AI provider request failed.",
          });
          // Finalize never runs on the error path, so capture the failed
          // generation here — mirroring the chat pipeline's error capture.
          timings.mark("error");
          const performanceSnapshot = timings.snapshot();
          await Promise.all([
            captureAiGeneration({
              distinctId: customerId,
              traceId: requestInfo.assistantId,
              model: modelSlug,
              provider: "openrouter",
              baseUrl: "https://openrouter.ai/api/v1",
              spanName: "image",
              input: [{ role: "user", content: prompt }],
              outputChoices: [],
              latencySeconds: (Date.now() - generationStartedAt) / 1000,
              isError: true,
              properties: {
                thread_id: requestInfo.threadId,
                tier: modelKey,
                thinking: false,
                search: false,
              },
            }),
            captureBackendPerformance({
              operation: "image_generation",
              outcome: "error",
              durationMs: performanceSnapshot.total_ms,
              distinctId: customerId,
              properties: {
                ...performanceSnapshot,
                model: modelSlug,
                tier: modelKey,
              },
            }),
          ]);
          timings.log("error", true);
          throw error;
        }
        return;
      }

      // MCP (paid-only): the model gets each connected integration's name +
      // description in the prompt, plus two gateway tools — mcp_list_tools to
      // discover what an integration offers and mcp_call_tool to run one. No
      // per-turn tools/list round trips; header decryption and OAuth refresh
      // run lazily (memoized) the first time the model reaches for one, so a
      // turn that never touches an integration pays nothing for them.
      let mcpTools: Record<string, Tool> = {};
      let mcpIntegrations: { name: string; description?: string }[] = [];
      /* The gateway's memoized server resolver, hoisted so the chart tool can
         reach it too — a live chart validates its data source by actually
         reading it once, here, before the chart is ever shown. Null when the
         user has nothing connected. */
      let resolveMcpConfigs: (() => Promise<McpServerConfig[]>) | null = null;
      /**
       * Read one declared data source, right now, at authoring time.
       *
       * Both live surfaces use it and must keep using the same one: a live
       * chart validates its field mapping against the real response, and a
       * react artifact proves every binding before the page is finalized. If
       * they ever diverge, one of them starts shipping sources the other
       * would have caught.
       */
      const readIntegrationSource = async ({
        integration,
        tool: toolName,
        args,
      }: {
        integration: string;
        tool: string;
        args?: string;
      }) => {
        if (!resolveMcpConfigs) {
          return {
            ok: false as const,
            error: "The user has no integrations connected.",
          };
        }
        let parsedArgs: Record<string, unknown> = {};
        if (args?.trim()) {
          try {
            const raw: unknown = JSON.parse(args);
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
              throw new Error("not an object");
            }
            parsedArgs = raw as Record<string, unknown>;
          } catch {
            return {
              ok: false as const,
              error: "`args` isn't a JSON-encoded object.",
            };
          }
        }
        return await readDeclaredSource({
          servers: await resolveMcpConfigs(),
          integration,
          tool: toolName,
          args: parsedArgs,
        });
      };
      // @mentioned integrations get their toolsets fetched ahead of the model
      // call and injected into the prompt, so the model can run their tools
      // without a discovery round trip. Kicked off here so it overlaps the
      // memory lookup; awaited just before the prompt is assembled.
      let mentionedToolsPromise:
        | Promise<{ server: string; toolLines: string[] }[]>
        | undefined;
      if (isPaid && requestInfo.mcpServers.length > 0) {
        mcpIntegrations = requestInfo.mcpServers.map((server) => ({
          name: server.name,
          ...(server.description ? { description: server.description } : {}),
        }));

        // Shared with artifact data bindings (convex/artifactData.ts), so the
        // model and a running dashboard can never disagree about which
        // integrations are reachable. A server whose grant is missing or whose
        // refresh fails drops out rather than failing the turn.
        const resolveConfigs = (): Promise<McpServerConfig[]> =>
          resolveMcpServerConfigs(requestInfo.mcpServers, {
            persistRefreshedTokens: async (tokens) => {
              await runMutation(internal.mcpOAuthFlow.updateOAuthTokens, {
                serverId: tokens.serverId as Id<"mcpServers">,
                accessTokenCipher: tokens.accessTokenCipher,
                refreshTokenCipher: tokens.refreshTokenCipher,
                expiresAt: tokens.expiresAt,
              });
            },
            // A grant that won't refresh used to just vanish from the turn:
            // the model was told the integration wasn't connected, the user
            // was told nothing at all, and settings still said "Ready to
            // use". Record it so the app can ask for the reconnect.
            onAuthExpired: async ({ serverId, reason }) => {
              await runMutation(internal.mcpServers.markAuthExpired, {
                id: serverId as Id<"mcpServers">,
                reason,
                at: Date.now(),
              });
            },
          });

        // Memoized so the OAuth refresh + header decryption run at most once
        // per turn, shared by every gateway call.
        let configsPromise: Promise<McpServerConfig[]> | undefined;
        resolveMcpConfigs = () => (configsPromise ??= resolveConfigs());
        const gateway = createMcpGatewayTools({
          resolveServers: resolveMcpConfigs,
          onToolsListed: async ({ server, toolCount }) => {
            await captureServerEvent({
              event: "mcp_tools_listed",
              distinctId: customerId,
              properties: {
                server,
                tool_count: toolCount,
                thread_id: requestInfo.threadId,
              },
            });
          },
          onToolsListResult: ({ server, ok, error }) =>
            persistMcp({
              server,
              tool: MCP_LIST_TOOLS_NAME,
              ok,
              ...(error ? { error } : {}),
            }),
          onToolResult: persistMcp,
          onServerResult: async ({ id, ok, error, authExpired }) => {
            if (!id) return;
            await runMutation(
              internal.mcpServers.recordConnectionResult,
              {
                id: id as Id<"mcpServers">,
                ok,
                ...(error ? { error } : {}),
                ...(authExpired ? { authExpired } : {}),
                at: Date.now(),
              },
            );
          },
        });
        mcpTools = gateway.tools;

        const mentioned = requestInfo.mcpServers.filter(
          (server) => server.mentioned,
        );
        if (mentioned.length > 0) {
          mentionedToolsPromise = Promise.all(
            mentioned.map((server) => gateway.preloadTools(server.name)),
          ).then((results) =>
            results.filter(
              (r): r is NonNullable<typeof r> => r !== null,
            ),
          );
        }
      }

      // Installed skills ride the same paid gate as integrations: name +
      // description in the prompt, one load_skill gateway tool to pull a
      // skill's text on demand. A turn that never needs one pays nothing.
      // @mentioned skills arrive with their instructions inlined — those go
      // straight into the prompt, and the tool treats them as already loaded.
      let skillTools: Record<string, Tool> = {};
      let installedSkills: { name: string; description?: string }[] = [];
      let mentionedSkills: { name: string; instructions: string }[] = [];
      if (isPaid && requestInfo.installedSkills.length > 0) {
        installedSkills = requestInfo.installedSkills.map(
          ({ name, description }) => ({ name, description }),
        );
        mentionedSkills = requestInfo.installedSkills.flatMap((skill) =>
          skill.mentioned && skill.instructions
            ? [{ name: skill.name, instructions: skill.instructions }]
            : [],
        );
        skillTools = {
          [LOAD_SKILL_NAME]: createLoadSkillTool({
            skills: installedSkills,
            preloaded: mentionedSkills.map((skill) => skill.name),
            fetchSkill: (name) =>
              ctx.runQuery(internal.skillStore.loadSkillText, {
                userId: customerId,
                name,
              }),
            onLoaded: persistSkill,
          }),
        };
      }

      let memoryContext: SupermemoryPromptContext | undefined;
      if (memoryActive) {
        // Started before the stream writer so it overlapped the gate checks and
        // setup above; by now it's usually already resolved (see
        // memoryContextPromise), so this await rarely costs first-token time.
        memoryContext =
          (await memoryContextPromise) ?? {
            staticFacts: [],
            dynamicFacts: [],
            memories: [],
          };
      }
      timings.mark("memoryLookup");

      // Tool listings for @mentioned integrations, fetched concurrently with
      // the memory lookup above. An unreachable server resolves to nothing —
      // the turn proceeds and the model falls back to lazy discovery.
      const mcpMentionedIntegrations = mentionedToolsPromise
        ? await mentionedToolsPromise
        : undefined;

      // Incognito turns are anonymous: the model gets none of the user's saved
      // personalization — no name, preferences, locale, timezone or location,
      // on top of memory already being forced off above. Anything tied to the
      // account stays out of the prompt and the weather tool's defaults. Thread-
      // local artifacts authored during the incognito chat itself still flow
      // through, since they belong to this ephemeral conversation, not the user.
      const anon = requestInfo.incognito;
      const ctxUserName = anon ? undefined : requestInfo.userName;
      const ctxPreferences = anon ? undefined : requestInfo.userPreferences;
      const ctxTimeZone = anon ? undefined : requestInfo.timeZone;
      const ctxLocale = anon ? undefined : requestInfo.locale;
      const ctxLatitude = anon ? undefined : requestInfo.latitude;
      const ctxLongitude = anon ? undefined : requestInfo.longitude;
      const ctxPlace = anon ? undefined : requestInfo.place;
      const ctxUnitsSystem = anon ? undefined : requestInfo.unitsSystem;

      const systemPrompt = buildSystemPrompt({
        search: searchEnabled,
        compactionSummary: requestInfo.compactionSummary,
        userPreferences: ctxPreferences,
        userName: ctxUserName,
        timeZone: ctxTimeZone,
        locale: ctxLocale,
        hasLocation:
          ctxLatitude !== undefined || Boolean(ctxTimeZone),
        memoryContext,
        mcpIntegrations:
          mcpIntegrations.length > 0 ? mcpIntegrations : undefined,
        mcpMentionedIntegrations:
          mcpMentionedIntegrations && mcpMentionedIntegrations.length > 0
            ? mcpMentionedIntegrations
            : undefined,
        skills: installedSkills.length > 0 ? installedSkills : undefined,
        mentionedSkills:
          mentionedSkills.length > 0 ? mentionedSkills : undefined,
        threadDocuments: requestInfo.threadDocuments,
        htmlEnabled: isPaid,
        imageToolEnabled: imageToolAllowed,
        threadHtmlArtifacts: requestInfo.threadHtmlArtifacts,
        now: Date.now(),
      });
      // Providers report the prompt side as one lump that also carries the
      // system prompt and tool schemas. Estimate the conversation content
      // actually sent so the usage tab can charge the user just for that.
      const promptContentTokens = estimatePromptContentTokens(
        requestInfo.messages,
      );
      timings.mark("providerStart");
      const generationStartedAt = Date.now();
      let toolCallCount = 0;
      let forcedFinalResponse = false;
      // The turn's running bill. Every step adds to it as it finishes, so the
      // total is correct for a turn that ran sixteen tool steps AND available
      // the moment a user hits stop.
      const meter = createTurnUsageMeter();

      // Hand the turn's bookkeeping — LLM analytics, the usage deduction, the
      // memory write and auto-compaction — to a scheduled action so this one
      // returns without waiting on those external round trips. The reply is
      // persisted and terminal before this runs, so none of it is on the
      // user's path; runAfter(0) is durable and every charge is idempotent, so
      // a retry is safe.
      //
      // Called on BOTH terminal paths a user is charged for. A stopped turn
      // spent every token it spent — the partial reply is kept and shown —
      // so it settles the same way a completed one does.
      const scheduleFinalize = async (latencyMs: number) => {
        const usage = meter.snapshot();
        // Custom catalog models bill a premium over the provider's reported
        // cost (whirl's own tiers keep their negotiated rates) — except on
        // Platinum, which pays the provider's own rate. Marked up BEFORE
        // finalize, same as the Image tier, so the deduction, the persisted
        // usageCost and the LLM analytics all agree on one number.
        const cost = modelConfig.custom
          ? usage.costUsd * customModelMarkupFor(isPlatinum)
          : usage.costUsd;
        // A step that finished without a price is a step we ate. Rare, and
        // invisible until now — worth a line in the logs when it happens.
        if (usage.unpricedSteps > 0) {
          console.warn("turn_steps_missing_cost", {
            assistantId: requestInfo.assistantId,
            model: modelSlug,
            steps: usage.steps,
            unpricedSteps: usage.unpricedSteps,
            billedCostUsd: cost,
          });
        }
        try {
          await ctx.scheduler.runAfter(
            0,
            internal.inference.finalizeAssistantTurn,
            {
              assistantId: requestInfo.assistantId,
              threadId: requestInfo.threadId,
              streamId: requestInfo.streamId,
              customerId,
              model: modelKey,
              modelSlug,
              isPaid,
              unmetered: unmeteredTurn,
              incognito: requestInfo.incognito,
              memoryActive,
              memoryContainerTag,
              usageFactor,
              scaleFreeMessages,
              thinking: requestInfo.thinking,
              search: requestInfo.search,
              latencyMs,
              inputTokens: usage.inputTokens || undefined,
              outputTokens: usage.outputTokens || undefined,
              cost: cost > 0 ? cost : undefined,
              // Capped: a single scheduled argument has to stay under Convex's
              // 1MB limit, and a long reply on top of a pasted document could
              // blow past it — taking the whole finalize, billing included,
              // down with it.
              text: capForFinalize(text),
              latestUserText: capForFinalize(requestInfo.latestUserText),
              analyticsInput: buildAnalyticsInput(
                systemPrompt,
                requestInfo.messages,
              ),
              performance: timings.snapshot(),
            },
          );
        } catch (error) {
          // Nothing downstream of this ever runs, so a failure here is the one
          // way a settled turn still ends up unbilled. Say so by name.
          console.error("finalize_not_scheduled", {
            assistantId: requestInfo.assistantId,
            customerId,
            costUsd: cost,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        timings.mark("scheduledFinalize");
      };

      // Emits a `$ai_generation` event to PostHog's LLM analytics. Best-effort
      // and awaited so the in-flight HTTP action isn't torn down mid-send.
      const captureGeneration = async (opts: {
        isError: boolean;
        inputTokens?: number;
        outputTokens?: number;
        cost?: number;
        // Honest generation wall-clock, captured the moment the stream drained.
        // Falls back to "now" for the error path, which has no clean end mark.
        latencyMs?: number;
      }) => {
        const latencyMs = opts.latencyMs ?? Date.now() - generationStartedAt;
        const performanceSnapshot = timings.snapshot();
        await Promise.all([
          captureAiGeneration({
            distinctId: customerId,
            traceId: requestInfo.assistantId,
            model: modelSlug,
            provider: "openrouter",
            baseUrl: "https://openrouter.ai/api/v1",
            spanName: "chat",
            input: [
              { role: "system", content: systemPrompt },
              ...requestInfo.messages,
            ],
            outputChoices: [{ role: "assistant", content: text }],
            inputTokens: opts.inputTokens,
            outputTokens: opts.outputTokens,
            totalCostUsd: opts.cost,
            latencySeconds: latencyMs / 1000,
            isError: opts.isError,
            properties: {
              thread_id: requestInfo.threadId,
              tier: modelKey,
              thinking: requestInfo.thinking,
              search: requestInfo.search,
              tool_calls: toolCallCount,
              tool_forced_final: forcedFinalResponse,
            },
          }),
          captureBackendPerformance({
            operation: "assistant_stream",
            outcome: opts.isError ? "error" : "stopped",
            durationMs: performanceSnapshot.total_ms,
            distinctId: customerId,
            properties: {
              ...performanceSnapshot,
              model: modelSlug,
              tier: modelKey,
              provider_duration_ms: latencyMs,
              thinking: requestInfo.thinking,
              search: requestInfo.search,
              tool_calls: toolCallCount,
            },
          }),
        ]);
      };

      // The span for the whole turn. Braintrust keys it on the assistant message
      // id, so the scheduled finalize action — a different isolate entirely —
      // can still merge the real cost and token counts into it once OpenRouter
      // settles. Everything the model does lands underneath: the generation, the
      // repair pass, every tool call. Inert when no API key is set.
      const turn = openBraintrustSpan({
        userId: customerId,
        eventId: requestInfo.assistantId,
        convoId: requestInfo.threadId,
        eventName: "chat_message",
        properties: {
          tier: modelKey,
          model: modelSlug,
          thinking: requestInfo.thinking,
          search: requestInfo.search,
          incognito: requestInfo.incognito,
        },
      });

      // A streaming turn outlives the call that starts it, and the repair pass
      // below belongs to it too, so the span is entered for the rest of this
      // action rather than wrapped around a single call.
      turn.enter();

      try {
        const result = tracedStreamText({
          model,
          abortSignal: abortController.signal,
          system: systemPrompt,
          messages: requestInfo.messages as ModelMessage[],
          tools: {
            // The calculators are always available: models are unreliable at
            // arithmetic, so they can offload any maths to a deterministic
            // tool — `calculate` for one expression, `calculateBatch` for many.
            calculate: createCalculatorTool({ onResult: persistCalc }),
            calculateBatch: createBatchCalculatorTool({
              onResult: persistCalc,
            }),
            // Live weather (Open-Meteo, no key). Always on, like the
            // calculators — "here" resolves from the user's shared coordinates
            // when present, otherwise their timezone city.
            getWeather: createWeatherTool({
              defaultLocation: {
                latitude: ctxLatitude,
                longitude: ctxLongitude,
                place: ctxPlace,
                timeZone: ctxTimeZone,
              },
              units: resolveWeatherUnits(ctxUnitsSystem, ctxLocale),
              locale: ctxLocale,
              onResult: persistWeather,
            }),
            // Charts. Always on: the model writes a spec, the client draws
            // it, so a chart costs a few hundred tokens instead of a
            // hand-authored SVG — and comes out in the app's own palette,
            // light and dark.
            createChart: createChartTool({
              onResult: persistChart,
              onReject: async () => {
                await runMutation(internal.inference.dropLastPendingChart, {
                  assistantId: requestInfo.assistantId,
                });
              },
              connectedIntegrations: mcpIntegrations.map((i) => i.name),
              // Reading the source once, here, is what makes a live chart
              // trustworthy: the model writes a field mapping without having
              // seen the response, so the tool fetches it and hands any
              // mismatch back for a retry instead of shipping an empty chart.
              readBinding: readIntegrationSource,
            }),
            // The integration store's shop window. Always on: the model
            // searches listings when the user needs an app that isn't
            // connected, and matches render as inline install cards. The
            // install flow itself carries the auth + paid gates, so free
            // users still get the discovery (and the upgrade path).
            suggestIntegrations: createSuggestIntegrationsTool({
              search: (query) =>
                ctx.runQuery(internal.integrationStore.searchForSuggestion, {
                  userId: customerId,
                  query,
                }),
              onResult: persistIntegrationSuggestion,
            }),
            // The clarifying-question form. Always on: when a decision
            // genuinely needs the user's call, the model raises an
            // interactive form (choices, short text, or a file request)
            // that the composer morphs into; answers come back as the next
            // user message.
            [ASK_QUESTION_TOOL_NAME]: createAskUserQuestionTool({
              onResult: persistAskQuestion,
            }),
            // The user's own archives. Always on: with memory active the
            // query runs semantically over the Supermemory transcript store,
            // so "that thing we talked about last month" resolves however it
            // was worded; keyword BM25 stays the backstop for turns without
            // memory, for history that predates it, and for Supermemory
            // outages. The current thread is excluded — it's already in
            // context.
            searchChatHistory: createChatHistorySearchTool({
              semantic: memoryActive,
              search: async (query): Promise<ChatHistoryMatch[]> => {
                const keywordSearch = (): Promise<ChatHistoryMatch[]> =>
                  ctx.runQuery(internal.historySearch.searchMessages, {
                    userId: customerId,
                    query,
                    excludeThreadId: requestInfo.threadId,
                  });
                if (!memoryActive) return keywordSearch();

                let hits;
                try {
                  hits = await searchSupermemoryConversations({
                    containerTag: memoryContainerTag,
                    query,
                    excludeThreadId: requestInfo.threadId,
                  });
                } catch (error) {
                  console.warn(
                    "Supermemory chat search failed; falling back to keyword search",
                    error instanceof Error ? error.message : error,
                  );
                  return keywordSearch();
                }
                if (hits.length === 0) return keywordSearch();

                // Titles come from live threads, which also drops hits whose
                // chat has since been deleted.
                const titles: Record<string, string> = await ctx.runQuery(
                  internal.historySearch.resolveThreadTitles,
                  {
                    userId: customerId,
                    threadIds: [...new Set(hits.map((hit) => hit.threadId))],
                  },
                );
                const matches = hits.flatMap<ChatHistoryMatch>((hit) => {
                  const threadTitle = titles[hit.threadId];
                  if (threadTitle === undefined) return [];
                  return [
                    {
                      threadTitle,
                      ...(hit.sentAt !== null ? { sentAt: hit.sentAt } : {}),
                      excerpt: hit.excerpt,
                    },
                  ];
                });
                return matches.length > 0 ? matches : keywordSearch();
              },
              onResult: persistHistorySearch,
            }),
            // Document authoring + revision. Markdown and raw code files share
            // the same streaming, editing, sharing, and branching lifecycle.
            createDocument: createDocumentTool({
              finalize: finalizeDocumentCall,
              onResult: persistDocument,
            }),
            createCodeDocument: createCodeDocumentTool({
              finalize: finalizeDocumentCall,
              onResult: persistDocument,
            }),
            editDocument: createEditDocumentTool({
              applyEdits: async ({ documentId, edits }) =>
                runMutation(internal.documents.applyDocumentEdits, {
                  documentId,
                  userId: customerId,
                  edits,
                }),
              onResult: persistDocument,
              onNoChange: async () => {
                await runMutation(
                  internal.inference.dropPendingDocumentPhase,
                  { assistantId: requestInfo.assistantId, op: "edit" },
                );
              },
            }),
            // HTML artifacts (paid-only): an inline visualization streamed into
            // the chat, a full standalone page streamed into the side panel —
            // both written directly by the main agent — and a find/replace
            // reviser for either. Withheld entirely for free users so the
            // model never offers a feature they can't use.
            ...(isPaid
              ? {
                  createInlineHtml: createInlineHtmlTool({
                    finalize: (args) =>
                      finalizeHtmlCall({ ...args, mode: "inline" }),
                    onResult: persistHtml,
                  }),
                  createHtmlPage: createFullHtmlTool({
                    finalize: (args) =>
                      finalizeHtmlCall({ ...args, mode: "full" }),
                    onResult: persistHtml,
                  }),
                  // The React runtime: a JSX module the host compiles and
                  // mounts, and the only artifact that can read live data from
                  // the user's integrations. Its bindings are declared in the
                  // call and validated against what's actually connected — the
                  // artifact's own code never names an integration.
                  createReactArtifact: createReactArtifactTool({
                    connectedIntegrations: mcpIntegrations,
                    // Same reader the chart tool uses: every declared binding
                    // is executed before the artifact renders, so a wrong
                    // tool name costs the model a retry instead of costing
                    // the user a page of empty states.
                    readBinding: readIntegrationSource,
                    warmBindings: async (htmlId, entries) => {
                      await runMutation(
                        internal.artifactData.seedArtifactBindings,
                        { htmlId, entries },
                      );
                    },
                    // A rejected call never reaches finalize, so the row and
                    // card opened on tool-input-start have to be settled here
                    // or they hang for the rest of the turn.
                    abort: settleOpenHtmlStream,
                    finalize: ({ toolCallId, title, code, mode, bindings }) =>
                      finalizeHtmlCall({
                        toolCallId,
                        title,
                        html: code,
                        mode,
                        runtime: "react",
                        bindings,
                      }),
                    onResult: ({ op, mode, htmlId, title }) =>
                      persistHtml({ op, mode, htmlId, title }),
                  }),
                  editHtml: createEditHtmlTool({
                    applyEdits: async ({ htmlId, edits }) =>
                      runMutation(internal.html.applyHtmlEdits, {
                        htmlId,
                        userId: customerId,
                        edits,
                      }),
                    onResult: async (payload) => {
                      await persistHtml(payload);
                      // The pending phase opened on tool-input-start can commit
                      // AFTER the result for a tiny input, leaving a stray
                      // working card; sweep it (a no-op when finalize already
                      // consumed the phase).
                      await runMutation(
                        internal.inference.dropPendingHtmlPhase,
                        { assistantId: requestInfo.assistantId, op: "edit" },
                      );
                    },
                    onNoChange: async () => {
                      await runMutation(
                        internal.inference.dropPendingHtmlPhase,
                        { assistantId: requestInfo.assistantId, op: "edit" },
                      );
                    },
                  }),
                }
              : {}),
            // Image painting (Turbo and up, same entitlement as the Image
            // tier): the model asks for a picture mid-reply and a background
            // worker paints it onto the message's `image` phase — the tool
            // returns instantly so a slow paint can't time the stream out.
            ...(imageToolAllowed
              ? {
                  generateImage: createGenerateImageTool({
                    start: startImagePaint,
                  }),
                }
              : {}),
            ...(exaApiKey
              ? {
                  fetchUrl: createWebFetchTool({
                    apiKey: exaApiKey,
                    onFetch: async ({
                      sources,
                      items,
                      costDollars,
                      callIdx,
                    }) => {
                      if (costDollars > 0) {
                        await chargeUsage(ctx, {
                          customerId,
                          idempotencyKey: `${requestInfo.assistantId}:${requestInfo.streamId}:fetch:${callIdx}`,
                          feature: SEARCH_FEATURE_ID,
                          amount: costDollars * usageFactor,
                          source: "web_fetch",
                          assistantId: requestInfo.assistantId,
                          messageCost: costDollars,
                        });
                      }
                      await runMutation(
                        internal.inference.finalizeLastPendingFetch,
                        {
                          assistantId: requestInfo.assistantId,
                          sources,
                          items,
                        },
                      );
                      await captureServerEvent({
                        event: "web_fetch",
                        distinctId: customerId,
                        properties: {
                          pages: sources,
                          thread_id: requestInfo.threadId,
                        },
                      });
                    },
                  }),
                }
              : {}),
            ...(searchEnabled && exaApiKey
              ? {
                  answerQuestion: createExaAnswerTool({
                    apiKey: exaApiKey,
                    onAnswer: async ({
                      sources,
                      items,
                      costDollars,
                      callIdx,
                    }) => {
                      // Charge Exa's reported cost plan-first (via the `search`
                      // member feature) and overflow to the extra-usage bucket,
                      // matching how AI deductions bill provider-reported USD.
                      if (costDollars > 0) {
                        await chargeUsage(ctx, {
                          customerId,
                          idempotencyKey: `${requestInfo.assistantId}:${requestInfo.streamId}:search:${callIdx}`,
                          feature: SEARCH_FEATURE_ID,
                          amount: costDollars * usageFactor,
                          source: "web_search",
                          assistantId: requestInfo.assistantId,
                          messageCost: costDollars,
                        });
                      }
                      await runMutation(
                        internal.inference.finalizeLastPendingSearch,
                        {
                          assistantId: requestInfo.assistantId,
                          sources,
                          items,
                        },
                      );
                    },
                  }),
                }
              : {}),
            // The gateway to the user's own integrations (MCP servers):
            // mcp_list_tools + mcp_call_tool. Empty unless paid + the user has
            // enabled servers; the real tools are discovered on demand.
            ...mcpTools,
            // The gateway to the user's installed skills: load_skill pulls a
            // skill's instruction text in on demand. Empty unless paid + the
            // user has enabled skill installs.
            ...skillTools,
          },
          prepareStep: ({ steps, messages }) => {
            // Auto picks a model per request, so the encrypted reasoning the
            // last step produced can't be replayed into this one — the
            // provider rejects the whole request. Scrub it off the replay
            // before anything else decides what this step looks like.
            const replay = unpinnedRoute
              ? { messages: stripEncryptedReasoning(messages) }
              : {};
            // Loop control is progress-based, not count-based: every tool
            // stays available for the whole tool phase (retiring one mid-task
            // strands the model and it narrates instead of answering).
            // Repeated identical calls draw a pointed warning; persistent
            // repetition, a runaway call count, or reaching the step ceiling
            // reserve the next step for a tool-free final answer, so a turn
            // can never end guillotined mid-loop with no reply.
            const decision = decideToolStep(steps, {
              maxSteps: TOOL_MAX_STEPS,
            });
            toolCallCount = decision.totalToolCalls;
            // Once a question form is up, the turn must end so the user can
            // answer it — cut tools and have the model sign off in a line.
            const askedThisTurn = steps.some((step) =>
              step.toolCalls.some(
                (call) => call?.toolName === ASK_QUESTION_TOOL_NAME,
              ),
            );
            if (askedThisTurn) {
              return {
                ...replay,
                activeTools: [] as never[],
                toolChoice: "none",
                system: `${systemPrompt}\n\n${ASK_QUESTION_WRAPUP_INSTRUCTION}`,
              };
            }
            if (decision.forceFinalResponse) {
              forcedFinalResponse = true;
              return {
                ...replay,
                activeTools: [] as never[],
                toolChoice: "none",
                system: `${systemPrompt}\n\n${FINAL_RESPONSE_SYSTEM_INSTRUCTION}`,
              };
            }
            if (decision.repeatedTools.length > 0) {
              return {
                ...replay,
                system: `${systemPrompt}\n\n${buildRepeatedCallsInstruction(
                  decision.repeatedTools,
                )}`,
              };
            }
            return replay;
          },
          stopWhen: stepCountIs(TOOL_MAX_STEPS),
          providerOptions: {
            openrouter: {
              // Ask OpenRouter to include billing info on the final response
              // so we can deduct the actual USD cost from the usage pool.
              usage: { include: true },
              // When thinking is on we stream the reasoning (no `exclude`) so
              // it can be captured and shown in the reasoning modal. When it's
              // off, apply the per-model verified config that actually stops
              // reasoning from reaching the user (some models mandate it and
              // can only be minimized + hidden) — see REASONING_OFF_OPTIONS.
              // A custom model or tier override that can't reason gets no
              // reasoning config at all, even with the toggle on — the
              // parameter would be rejected, not ignored.
              ...(requestInfo.thinking &&
              (modelOverride?.capabilities.reasoning ?? true)
                ? {
                    reasoning: {
                      enabled: true,
                      effort: "medium",
                    },
                  }
                : reasoningOffOptionsFor(modelKey, modelOverride)),
            },
          },
        });

        scheduleStopPoll();
        for await (const part of result.fullStream) {
          if (stopped) break;

          switch (part.type) {
            case "start-step":
              stepOutput.start();
              break;
            case "finish-step": {
              // Each step is its own priced request to OpenRouter — this is
              // the only place the per-step cost is ever visible.
              meter.recordStep(part);
              if (!protectStepText) break;
              await appendVisibleText(stepOutput.finish(part.finishReason));
              break;
            }
            // When the thinking toggle is off, drop reasoning parts entirely:
            // a model may still reason despite the per-model off config (Auto
            // can route anywhere), and the user asked not to see it.
            case "reasoning-start":
              if (!requestInfo.thinking) break;
              await startReasoning();
              break;
            case "reasoning-delta":
              if (!requestInfo.thinking) break;
              if (!reasoningActive) await startReasoning();
              reasoningText += part.text;
              break;
            case "reasoning-end":
              if (!requestInfo.thinking) break;
              await endReasoning();
              break;
            case "tool-input-start": {
              stepOutput.markToolCall();
              // The model has started writing a tool call. Close any open
              // reasoning and, only for tools that have a visible indicator,
              // show it immediately so it doesn't flicker off mid-call.
              await endReasoning();
              // createDocument streams its body in as the tool-call input. Open
              // the row up front (empty, "streaming") so the inline card + panel
              // can latch on and watch it fill in; the tool-input-delta case
              // patches it, finalizeDocumentCall closes it out. The pending phase
              // carries the documentId so the card can auto-open the live row.
              if (
                part.toolName === "createDocument" ||
                part.toolName === "createCodeDocument"
              ) {
                // The stream parts key tool calls by `id`; it's the same value
                // the tool's execute() receives as `toolCallId`, so the row we
                // open here is the row finalizeDocumentCall closes out.
                await openDocStream(
                  part.id,
                  part.toolName === "createCodeDocument" ? "code" : "markdown",
                );
                break;
              }
              // createInlineHtml and createHtmlPage stream their bodies in
              // just like createDocument.
              if (part.toolName === "createInlineHtml") {
                await openHtmlStream(part.id, "inline");
                break;
              }
              if (part.toolName === "createHtmlPage") {
                await openHtmlStream(part.id, "full");
                break;
              }
              // createReactArtifact streams its module the same way. Its mode
              // arrives inside the input, so the row opens as "inline" — the
              // common case — and the finalize below moves it if the model
              // asked for a full pane.
              if (part.toolName === "createReactArtifact") {
                await openHtmlStream(part.id, "inline", "react");
                break;
              }
              // MCP gateway calls open pending phases below, anonymously — the
              // integration name (and the called tool, when applicable) lives
              // in the input that's about to stream.
              if (isMcpToolName(part.toolName)) {
                mcpPhaseStreams.set(part.id, {
                  raw: "",
                  described: false,
                  gatewayTool: part.toolName,
                });
              }
              // Only the explicit search and calculator tools get a live
              // indicator. Anything we can't positively identify shows nothing
              // (just the loading dots if there's a gap) — never a stray
              // "Calculating" row. The calc chip still appears afterward via
              // finalizeLastPendingCalc's append fallback when no pending
              // phase exists.
              const toolPhase =
                searchEnabled && part.toolName === "answerQuestion"
                  ? ({
                      kind: "search" as const,
                      sources: 0,
                      contentOffset: text.length,
                      pending: true,
                    })
                  : part.toolName === "fetchUrl"
                    ? ({
                        kind: "fetch" as const,
                        sources: 0,
                        contentOffset: text.length,
                        pending: true,
                      })
                    : part.toolName === "calculate" ||
                        part.toolName === "calculateBatch"
                      ? ({
                          kind: "calc" as const,
                          contentOffset: text.length,
                          pending: true,
                        })
                      : part.toolName === "getWeather"
                        ? ({
                            kind: "weather" as const,
                            contentOffset: text.length,
                            pending: true,
                          })
                        : part.toolName === "createChart"
                          ? ({
                              kind: "chart" as const,
                              contentOffset: text.length,
                              pending: true,
                            })
                        : part.toolName === "generateImage"
                          ? ({
                              kind: "image" as const,
                              contentOffset: text.length,
                              pending: true,
                            })
                        : part.toolName === "searchChatHistory"
                          ? ({
                              kind: "history" as const,
                              contentOffset: text.length,
                              pending: true,
                            })
                        : part.toolName === "suggestIntegrations"
                          ? ({
                              kind: "integrationSuggestion" as const,
                              contentOffset: text.length,
                              pending: true,
                            })
                        : part.toolName === ASK_QUESTION_TOOL_NAME
                          ? ({
                              kind: "question" as const,
                              contentOffset: text.length,
                              pending: true,
                            })
                        : part.toolName === "editDocument"
                          ? ({
                              kind: "document" as const,
                              op: "edit" as const,
                              contentOffset: text.length,
                              pending: true,
                            })
                          : // editHtml's input is tiny, so execute() can finish
                            // before this add commits; the onResult sweep in the
                            // tool wiring (and clearPendingPhases at turn end)
                            // drops the stray phase when that happens.
                            part.toolName === "editHtml"
                            ? ({
                                kind: "html" as const,
                                op: "edit" as const,
                                contentOffset: text.length,
                                pending: true,
                              })
                            : part.toolName === LOAD_SKILL_NAME
                                ? ({
                                    kind: "skill" as const,
                                    contentOffset: text.length,
                                    pending: true,
                                  })
                              : isMcpToolName(part.toolName)
                                ? ({
                                    kind: "mcp" as const,
                                    contentOffset: text.length,
                                    pending: true,
                                  })
                                : null;
              if (toolPhase) {
                await runMutation(internal.inference.addAssistantPhase, {
                  assistantId: requestInfo.assistantId,
                  phase: toolPhase,
                });
              }
              break;
            }
            case "tool-input-delta": {
              // Stream createDocument's body into its row as the JSON input
              // arrives: accumulate the raw input text, pull the partial title +
              // content out of it, and patch the row (throttled — the model
              // emits many tiny deltas). finalizeDocumentCall writes the complete
              // body afterward, so a dropped final delta never loses content.
              const docStream = docStreams.get(part.id);
              if (docStream) {
                docStream.raw += part.delta;
                const nextTitle =
                  extractStreamingField(docStream.raw, "title") ??
                  docStream.title;
                const nextContent =
                  extractStreamingField(docStream.raw, "content") ??
                  docStream.content;
                const nextFileName =
                  docStream.format === "code"
                    ? (extractStreamingField(docStream.raw, "fileName") ??
                      docStream.fileName)
                    : docStream.fileName;
                const nextLanguage =
                  docStream.format === "code"
                    ? (extractStreamingField(docStream.raw, "language") ??
                      docStream.language)
                    : docStream.language;
                if (
                  nextTitle === docStream.title &&
                  nextContent === docStream.content &&
                  nextFileName === docStream.fileName &&
                  nextLanguage === docStream.language
                ) {
                  break;
                }
                docStream.title = nextTitle;
                docStream.content = nextContent;
                docStream.fileName = nextFileName;
                docStream.language = nextLanguage;
                if (
                  Date.now() - docStream.lastFlush >=
                  streamFlushIntervalMs(nextContent.length)
                ) {
                  await flushDocStream(docStream);
                }
                break;
              }
              // createInlineHtml streams the same way; its body field is
              // `html`, a react module's is `code`.
              const htmlStream = htmlStreams.get(part.id);
              if (htmlStream) {
                htmlStream.raw += part.delta;
                // A react artifact declares its mode inside the input, and the
                // row was opened inline because that's the common case. The
                // field closes long before the module does, so promote the row
                // (and the pending card) the moment it says "full" — otherwise
                // a dashboard streams into an inline card and jumps to the
                // panel only at the very end.
                /* Bounded to the head of the input on purpose: this scans the
                   whole accumulated string, and `mode` is declared before the
                   module body, so scanning past the first few KB would be
                   quadratic work for a field that can no longer appear. */
                if (
                  htmlStream.runtime === "react" &&
                  htmlStream.mode !== "full" &&
                  htmlStream.raw.length < 4_000
                ) {
                  const declaredMode = extractCompleteField(
                    htmlStream.raw,
                    "mode",
                  );
                  if (declaredMode === "full" && htmlStream.htmlId) {
                    htmlStream.mode = "full";
                    await runMutation(
                      internal.inference.promoteStreamingArtifactToFull,
                      {
                        assistantId: requestInfo.assistantId,
                        htmlId: htmlStream.htmlId,
                      },
                    );
                  }
                }
                const nextTitle =
                  extractStreamingField(htmlStream.raw, "title") ??
                  htmlStream.title;
                const nextContent =
                  extractStreamingField(htmlStream.raw, htmlStream.bodyField) ??
                  htmlStream.content;
                if (
                  nextTitle === htmlStream.title &&
                  nextContent === htmlStream.content
                ) {
                  break;
                }
                htmlStream.title = nextTitle;
                htmlStream.content = nextContent;
                if (
                  Date.now() - htmlStream.lastFlush >=
                  streamFlushIntervalMs(nextContent.length)
                ) {
                  await flushHtmlStream(htmlStream);
                }
                break;
              }
              // MCP gateway inputs lead with the integration name. Stamp it
              // onto the pending phase as soon as it closes; actual calls also
              // wait for their tool name, while discovery uses its gateway
              // name so it can settle as "Checked <integration>".
              const mcpStream = mcpPhaseStreams.get(part.id);
              if (mcpStream && !mcpStream.described) {
                mcpStream.raw += part.delta;
                const integration = extractCompleteField(
                  mcpStream.raw,
                  "integration",
                );
                const toolField =
                  mcpStream.gatewayTool === MCP_CALL_TOOL_NAME
                    ? extractCompleteField(mcpStream.raw, "tool")
                    : MCP_LIST_TOOLS_NAME;
                if (integration && toolField) {
                  mcpStream.described = true;
                  mcpStream.raw = "";
                  const lifecycle = resolveMcpLifecycleMetadata(
                    requestInfo.mcpServers,
                    integration,
                    toolField,
                  );
                  await runMutation(
                    internal.inference.describeLastPendingMcp,
                    {
                      assistantId: requestInfo.assistantId,
                      server: integration,
                      tool: toolField,
                      ...lifecycle,
                    },
                  );
                }
                break;
              }
              break;
            }
            case "tool-call": {
              stepOutput.markToolCall();
              // Some providers deliver a createDocument call complete, without
              // ever emitting tool-input-start/delta. Open the row + pending
              // phase here so its progress bar still shows while execute writes
              // the body. No-op when the streaming path already opened it.
              if (
                part.toolName === "createDocument" ||
                part.toolName === "createCodeDocument"
              ) {
                await openDocStream(
                  part.toolCallId,
                  part.toolName === "createCodeDocument" ? "code" : "markdown",
                );
              }
              if (part.toolName === "createInlineHtml") {
                await openHtmlStream(part.toolCallId, "inline");
              }
              if (part.toolName === "createHtmlPage") {
                await openHtmlStream(part.toolCallId, "full");
              }
              if (part.toolName === "createReactArtifact") {
                const declared = (part.input as { mode?: string } | undefined)
                  ?.mode;
                await openHtmlStream(
                  part.toolCallId,
                  declared === "full" ? "full" : "inline",
                  "react",
                );
              }
              // Parsed MCP gateway inputs are the backstop for providers that
              // deliver a call in one shot instead of streaming its fields.
              if (isMcpToolName(part.toolName)) {
                const described =
                  mcpPhaseStreams.get(part.toolCallId)?.described;
                mcpPhaseStreams.delete(part.toolCallId);
                const input = part.input as
                  | { integration?: string; tool?: string }
                  | undefined;
                if (!described && input?.integration) {
                  const toolName =
                    part.toolName === MCP_CALL_TOOL_NAME
                      ? input.tool
                      : MCP_LIST_TOOLS_NAME;
                  const lifecycle = toolName
                    ? resolveMcpLifecycleMetadata(
                        requestInfo.mcpServers,
                        input.integration,
                        toolName,
                      )
                    : {};
                  await runMutation(
                    internal.inference.describeLastPendingMcp,
                    {
                      assistantId: requestInfo.assistantId,
                      server: input.integration,
                      ...(part.toolName === MCP_CALL_TOOL_NAME
                        ? input.tool
                          ? { tool: input.tool }
                          : {}
                        : { tool: MCP_LIST_TOOLS_NAME }),
                      ...lifecycle,
                    },
                  );
                }
              }
              break;
            }
            case "text-delta": {
              if (!part.text) break;
              if (protectStepText) {
                stepOutput.add(part.text);
                break;
              }
              await appendVisibleText(part.text);
              break;
            }
            case "tool-error": {
              stepOutput.markToolCall();
              // A tool call died inside the SDK (invalid input, an executor
              // that threw past its own catch). The model sees the error and
              // keeps going, but this must never be invisible to us: log it,
              // and for generateImage settle the pending phase with the
              // reason so the user gets a "couldn't paint" chip instead of a
              // card that silently evaporates at turn end.
              const toolErrorMessage =
                part.error instanceof Error
                  ? part.error.message
                  : String(part.error);
              console.error(
                `tool call failed (${part.toolName}): ${toolErrorMessage}`,
              );
              // A document/html create whose input broke mid-flight (usually a
              // truncated or malformed JSON body on a very large artifact) is
              // NOT lost: the body already streamed into the live row, so
              // salvage it into a finished artifact instead of letting the
              // card and row rot in their in-progress state.
              if (
                part.toolName === "createDocument" ||
                part.toolName === "createCodeDocument"
              ) {
                await settleOpenDocStream(part.toolCallId);
                break;
              }
              if (
                part.toolName === "createInlineHtml" ||
                part.toolName === "createHtmlPage"
              ) {
                await settleOpenHtmlStream(part.toolCallId);
                break;
              }
              if (part.toolName === "generateImage") {
                await runMutation(
                  internal.inference.finalizeLastPendingImage,
                  {
                    assistantId: requestInfo.assistantId,
                    ok: false,
                    error: toolErrorMessage,
                    contentOffset: text.length,
                  },
                );
              }
              break;
            }
            case "error":
              throw part.error instanceof Error
                ? part.error
                : new Error(String(part.error));
            default:
              break;
          }
        }

        // Token stream drained. Stop the background stop-poll and capture the
        // honest generation wall-clock RIGHT NOW — before any settle or
        // bookkeeping mutation runs — so the response-time stat reflects the
        // model, not the analytics POST + billing round trips that follow.
        stopStopPoll();
        const generationDurationMs = Date.now() - generationStartedAt;

        // The stream can end while a reasoning block is still open (e.g. a
        // reasoning-only step); finalize it so it doesn't stay pending.
        timings.mark("providerDone");
        await endReasoning();

        if (stopped) {
          await finalizeOpenDocStreams();
          await finalizeOpenHtmlStreams();
          await persistStopped();
          // Straight off the meter rather than off `result.usage`: the stream
          // was abandoned mid-flight, so the SDK's aggregate promise may never
          // resolve — and the steps that DID finish are the ones we owe for.
          const usage = meter.snapshot();
          await bestEffort(
            "stopped assistant stats persistence",
            runMutation(internal.inference.setAssistantStats, {
              assistantId: requestInfo.assistantId,
              outputTokens: usage.outputTokens || undefined,
              durationMs: generationDurationMs,
              inputTokens: usage.inputTokens || undefined,
              promptContentTokens,
            }),
          );
          timings.mark("stopped");
          await bestEffort(
            "stopped generation analytics",
            captureGeneration({
              isError: false,
              inputTokens: usage.inputTokens || undefined,
              outputTokens: usage.outputTokens || undefined,
              latencyMs: generationDurationMs,
            }),
          );
          // Stopping a reply doesn't refund it. The tokens were spent, the
          // partial answer is kept, and the turn bills for exactly the steps
          // that finished.
          await scheduleFinalize(generationDurationMs);
          timings.log("stopped", true);
          return;
        }

        // A turn can end with nothing to show two ways: the model spends every
        // step on tool calls and never writes an answer, or it simply stops
        // with an empty body. The second one arrives as `finishReason: "stop"`
        // and no error at all — a success everywhere above this line — so
        // neither shape is trusted: no visible text means the turn failed,
        // whatever the provider called it. Both are repaired the same way, by
        // regenerating the answer from completed tool results with reasoning
        // excluded and no tools exposed. What a reply is allowed to *say* is
        // never grounds for discarding it; that's the system prompt's job.
        // A turn that raised a question form is allowed to end wordless —
        // the form IS the reply, and a repair pass would answer the model's
        // own questions instead of the user.
        const noVisibleReply = text.trim().length === 0 && !askedUserQuestion;
        if (noVisibleReply) {
          const finishReason = await bestEffort(
            "AI SDK finish reason",
            Promise.resolve(result.finishReason),
          );
          console.warn("regenerating_final_reply", {
            assistantId: requestInfo.assistantId,
            threadId: requestInfo.threadId,
            model: modelKey,
            toolCalls: toolCallCount,
            finishReason,
          });
          const completedSteps = await result.steps;
          const stepMessages = completedSteps.flatMap((step) =>
            step.toolCalls.length > 0 ? step.response.messages : [],
          );
          // Same trap as the tool loop: this is a fresh request, so under Auto
          // it can land on a model that never saw the reasoning these steps
          // carry. Replay the tool work, not the thinking.
          const toolMessages = unpinnedRoute
            ? stripEncryptedReasoning(stepMessages as ModelMessage[])
            : stepMessages;
          // The turn's span is still current, so the repair's own spans nest
          // under it as named sub-steps rather than opening orphaned traces.
          // This never throws — worst case it hands back a written-by-hand
          // line — so a failed repair can't mark an already-finished
          // generation as an errored turn.
          const repair = await repairFinalReply({
            model,
            systemPrompt,
            messages: [
              ...(requestInfo.messages as ModelMessage[]),
              ...toolMessages,
            ],
            toolNames: completedSteps.flatMap((step) =>
              step.toolCalls.flatMap((call) => call?.toolName ?? []),
            ),
            trace: {
              userId: customerId,
              assistantId: requestInfo.assistantId,
              threadId: requestInfo.threadId,
              tier: modelKey,
              modelSlug,
              toolCalls: toolCallCount,
            },
          });
          // A repair is one or two more paid requests on top of the turn that
          // needed repairing — including the ones that came back empty.
          meter.recordSideCall(repair.usage);
          // Braintrust had no idea any of this happened: the turn's spans were
          // all green and its `error` was empty, because nothing ever threw.
          // Say it plainly on the root span instead — an empty reply is the
          // failure, and the repair's shape is how it was (or wasn't) saved.
          const emptyAttempts = repair.attempts.filter(
            (attempt) => attempt.empty,
          );
          turn.log({
            ...(repair.source === "fallback"
              ? { error: `${EMPTY_REPLY_FAILURE}: repair produced no text` }
              : {}),
            metadata: {
              failure_type: EMPTY_REPLY_FAILURE,
              finish_reason: finishReason,
              tool_calls: toolCallCount,
              repair_attempts: repair.attempts.length,
              repair_source: repair.source,
              empty_providers: emptyAttempts
                .map((attempt) => attempt.provider ?? "unknown")
                .join(","),
            },
          });
          if (repair.source === "fallback") {
            console.error("final_reply_unrecoverable", {
              assistantId: requestInfo.assistantId,
              threadId: requestInfo.threadId,
              model: modelSlug,
              finishReason,
              attempts: repair.attempts,
            });
          }
          await bestEffort(
            "empty reply analytics",
            captureServerEvent({
              event: "empty_model_response",
              distinctId: customerId,
              properties: {
                thread_id: requestInfo.threadId,
                model: modelSlug,
                tier: modelKey,
                finish_reason: finishReason,
                tool_calls: toolCallCount,
                repair_source: repair.source,
                recovered: repair.source !== "fallback",
              },
            }),
          );
          await appendVisibleText(repair.text);
        }

        // Persist the terminal chat state before usage, analytics, memory, or
        // compaction. Those are useful side effects, but they must never keep
        // the composer or message row in a live state after text has finished.
        await persistComplete();
        timings.mark("persistComplete");

        // The provider's usage report, for the token breakdown under the
        // message. The turn's COST comes off the meter instead: this promise
        // carries only the last step's metadata, so billing off it charged an
        // agentic turn for its closing paragraph and nothing else.
        const usage = await bestEffort(
          "AI SDK usage",
          Promise.resolve(result.usage),
        );

        // Persist the per-response stats ("Show stats") right after the message
        // settles and BEFORE the analytics + billing round trips below — those
        // are slow best-effort side effects that must never delay or inflate the
        // response-time number. durationMs is the honest generation time.
        await bestEffort(
          "assistant stats persistence",
          runMutation(internal.inference.setAssistantStats, {
            assistantId: requestInfo.assistantId,
            outputTokens: usage?.outputTokens,
            durationMs: generationDurationMs,
            inputTokens: usage?.inputTokens,
            cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens,
            cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens,
            totalTokens: usage?.totalTokens,
            promptContentTokens,
          }),
        );

        await scheduleFinalize(generationDurationMs);
        timings.log("completeWithSideEffects");
      } catch (error) {
        // Aborting the model request to honor a user stop surfaces here as an
        // error; persist the partial response as "stopped" rather than failing.
        stopStopPoll();
        await finalizeOpenDocStreams();
        await finalizeOpenHtmlStreams();
        if (stopped || abortController.signal.aborted) {
          await persistStopped();
          timings.mark("stopped");
          const performanceSnapshot = timings.snapshot();
          await bestEffort(
            "stopped stream performance analytics",
            captureBackendPerformance({
              operation: "assistant_stream",
              outcome: "stopped",
              durationMs: performanceSnapshot.total_ms,
              distinctId: customerId,
              properties: {
                ...performanceSnapshot,
                model: modelSlug,
                tier: modelKey,
              },
            }),
          );
          // A stop that surfaces as an abort is the same stop as the one the
          // drain loop catches, and bills the same way.
          await scheduleFinalize(Date.now() - generationStartedAt);
          timings.log("stopped", true);
          return;
        }
        if (terminalStatusWritten) {
          console.error("Post-stream side effect failed", error);
          timings.mark("postStreamError");
          const performanceSnapshot = timings.snapshot();
          await bestEffort(
            "post-stream performance analytics",
            captureBackendPerformance({
              operation: "assistant_stream",
              outcome: "error",
              durationMs: performanceSnapshot.total_ms,
              distinctId: customerId,
              properties: {
                ...performanceSnapshot,
                model: modelSlug,
                tier: modelKey,
                stage: "post_stream",
              },
            }),
          );
          timings.log("postStreamError", true);
          return;
        }
        await runMutation(internal.inference.clearPendingPhases, {
          assistantId: requestInfo.assistantId,
        });
        await runMutation(internal.inference.setAssistantStatus, {
          assistantId: requestInfo.assistantId,
          status: "error",
          content:
            error instanceof Error
              ? `AI provider error: ${error.message}`
              : "AI provider request failed.",
        });
        timings.mark("error");
        await captureGeneration({ isError: true });
        timings.log("error", true);
        throw error;
      } finally {
        // Completed turn, user stop, provider error — the span closes on all
        // three. Finalize merges the settled cost and token counts into it
        // afterwards, keyed on the assistant message id.
        turn.end();
      }
    })();
    // The turn finished (including graceful stop/error paths that persisted
    // their own terminal status) — flush the tail and mark the stream done.
    await chunks.finish();
  } catch (error) {
    await chunks.fail();
    throw error;
  } finally {
    // Convex disposes the isolate the moment this action returns, and Braintrust
    // batches in the background — whatever hasn't shipped by now never will.
    // Every exit funnels through here: completed turn, user stop, provider
    // error.
    await flushBraintrust();
  }
}

export function streamAssistantOptionsResponse() {
  return new Response(null, {
    status: 204,
    headers: STREAM_CORS_HEADERS,
  });
}
