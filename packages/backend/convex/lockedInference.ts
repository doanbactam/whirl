import type { ModelMessage } from "ai";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { tracedStreamText } from "./braintrust";
import {
  AI_COST_FEATURE_ID,
  createBillingClient,
  createOpenRouterChatModel,
  customModelMarkupFor,
  fetchBillingCustomer,
  isUnmeteredPlatinumTurn,
  MODEL_IDS,
  readPlanState,
  reasoningOffOptionsFor,
  resolveModelKey,
  snapshotPlanState,
  UNBILLED_PLAN_STATE,
} from "./inference/billing";
import { isClearedForLockedThread } from "./lockedPolicy";
import { createTurnUsageMeter } from "./inference/turnUsage";
import {
  FORMATTING_SYSTEM_INSTRUCTION,
  LATEX_SYSTEM_INSTRUCTION,
  OUTPUT_HYGIENE_SYSTEM_INSTRUCTION,
  PERSONALITY_SYSTEM_INSTRUCTION,
  WRITING_STYLE_SYSTEM_INSTRUCTION,
} from "./prompts";
import { chargeUsage } from "./usageLedger";

/* The turn handler for locked threads.

   Every other reply in Whirl is generated server-side: a mutation schedules
   the turn and it runs on the deployment, outliving whatever tab asked for
   it. A locked thread can't work that way, and the reason is the feature
   itself — the conversation is stored sealed, so the only plaintext copy of
   it lives in the tab holding the key. There is nowhere for a scheduled
   action to read it from.

   So the tab drives: it opens its own transcript, POSTs it here, and reads
   the reply back down the same connection. Nothing is written to our tables
   in between; the tab seals the finished reply and stores that.

   What that buys and what it costs:
     + The plaintext exists in one process, for the length of one request,
       and is never persisted anywhere by us.
     + Only zero-retention models are allowed, so the provider doesn't keep
       it either.
     - Closing the tab kills the turn. The watchdog reaps the row like any
       other dead one and the user retries. That's the honest trade, and the
       setup modal says so before anyone commits to it.

   No tools run here. Search, documents, images, integrations, memory and
   chat-history all write their results into our tables as plain text, which
   would put back exactly what the lock took out. A locked thread is a plain
   conversation, deliberately. */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-cache, no-transform",
  "Content-Type": "application/x-ndjson; charset=utf-8",
  Vary: "Origin",
} as const;

function withCors(response: Response) {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

/** How often the turn tells the database it's still alive. Matches the
 *  server-driven path's beat, so the shared watchdog reaps both at one rate. */
const HEARTBEAT_INTERVAL_MS = 25_000;

/** The turn's ceiling. With no tool loop to run away, this only ever catches
 *  a provider that has stopped talking mid-reply. */
const TURN_TIMEOUT_MS = 5 * 60_000;

/* ---- the wire protocol ---------------------------------------------- */

/* Newline-delimited JSON, one event per line. Plain enough to read in a
   network panel, and it survives a chunk boundary landing mid-object
   because the reader only parses on a newline. */
type TurnEvent =
  | { t: "delta"; v: string }
  | { t: "reasoning"; v: string }
  | { t: "done"; outputTokens: number; durationMs: number }
  | { t: "error"; message: string };

/** One event, as the line that carries it. */
function line(event: TurnEvent): string {
  return `${JSON.stringify(event)}\n`;
}

const encoder = new TextEncoder();

/** The same line for the open stream: a Response body takes the string, a
 *  stream controller takes the bytes. */
function chunk(event: TurnEvent): Uint8Array {
  return encoder.encode(line(event));
}

/** Model-facing history, as the tab opened it. Images ride inline as data
 *  URLs — a locked thread never uploads a file to our storage, so the bytes
 *  go straight from the tab to the provider and neither of us keeps them.
 *  (The chat model's `supportedUrls` override in billing.ts is what lets a
 *  data URL through untouched.) */
type WireMessage = {
  role: "user" | "assistant";
  content: string;
  images?: string[];
};

function toModelMessages(messages: WireMessage[]): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    if (message.role === "assistant") {
      return { role: "assistant", content: message.content };
    }
    if (!message.images || message.images.length === 0) {
      return { role: "user", content: message.content };
    }
    return {
      role: "user",
      content: [
        ...(message.content
          ? [{ type: "text" as const, text: message.content }]
          : []),
        ...message.images.map((image) => ({
          type: "image" as const,
          image,
        })),
      ],
    };
  });
}

const LOCKED_SYSTEM_INSTRUCTION =
  "This conversation is locked: it is end-to-end encrypted, and you have no tools, no web search, no memory of the user, and no access to their other chats. Answer from what is in this conversation. If something genuinely needs a live lookup or a file you cannot see, say so in a line and offer what you can do without it. Never claim to have searched, remembered, or opened anything.";

function buildSystemPrompt(userName?: string): string {
  return [
    PERSONALITY_SYSTEM_INSTRUCTION,
    WRITING_STYLE_SYSTEM_INSTRUCTION,
    FORMATTING_SYSTEM_INSTRUCTION,
    OUTPUT_HYGIENE_SYSTEM_INSTRUCTION,
    LATEX_SYSTEM_INSTRUCTION,
    LOCKED_SYSTEM_INSTRUCTION,
    ...(userName ? [`The user's name is ${userName}.`] : []),
  ].join("\n\n");
}

/* ---- the handler ----------------------------------------------------- */

function parseBody(raw: unknown) {
  const body = raw as {
    threadId?: string;
    assistantId?: string;
    model?: string;
    thinking?: boolean;
    messages?: WireMessage[];
  };
  if (
    typeof body?.threadId !== "string" ||
    typeof body?.assistantId !== "string" ||
    !Array.isArray(body?.messages) ||
    body.messages.length === 0
  ) {
    return null;
  }
  return {
    threadId: body.threadId as Id<"threads">,
    assistantId: body.assistantId as Id<"messages">,
    model: typeof body.model === "string" ? body.model : "Auto",
    thinking: body.thinking === true,
    messages: body.messages,
  };
}

export const streamLockedTurn = httpAction(async (ctx, request) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return withCors(
      new Response(line({ t: "error", message: "You are not signed in." }), {
        status: 401,
      }),
    );
  }

  let parsed: ReturnType<typeof parseBody> = null;
  try {
    parsed = parseBody(await request.json());
  } catch {
    parsed = null;
  }
  if (!parsed) {
    return withCors(
      new Response(line({ t: "error", message: "The request is not valid." }), {
        status: 400,
      }),
    );
  }
  const { threadId, assistantId, model: wireModel, thinking, messages } = parsed;

  // Ownership, lock state and the assistant row are checked against the
  // database before a single token is spent — never against the request.
  try {
    await ctx.runQuery(internal.lockedThreads.turnPreflight, {
      userId: identity.subject,
      threadId,
      assistantId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Whirl cannot find this chat.";
    return withCors(
      new Response(line({ t: "error", message }), { status: 403 }),
    );
  }

  // Anything that stops the turn before it starts settles the message row
  // too, so the thread never sits shimmering at a reply that will never come.
  const fail = async (message: string, status: number) => {
    await ctx.runMutation(internal.lockedThreads.failTurn, {
      assistantId,
      message,
    });
    return withCors(new Response(line({ t: "error", message }), { status }));
  };

  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterApiKey) {
    return fail(
      "The server is missing part of its configuration, so this reply never started. This one's on us — try again in a bit.",
      500,
    );
  }

  // Billing is optional (see createBillingClient): without it everyone
  // counts as paid and nothing is deducted.
  const customerId = identity.subject;
  const autumn = createBillingClient();
  const customer = autumn
    ? await fetchBillingCustomer({ autumn, customerId })
    : null;
  const { isPaid, isPlatinum } = !autumn
    ? UNBILLED_PLAN_STATE
    : customer
      ? snapshotPlanState(customer)
      : await readPlanState({ autumn, customerId });
  if (!isPaid) {
    return fail(
      "A locked chat needs a paid plan. Upgrade to use it.",
      402,
    );
  }

  // The whole promise rests on the model not keeping what we hand it, so an
  // unconfirmed model is refused outright rather than quietly substituted.
  // The list comes from OpenRouter (convex/zeroRetention.ts), resolved
  // against whatever slug the tier currently routes to.
  const policy = await ctx.runQuery(
    internal.zeroRetention.clearedForLockedThreads,
    {},
  );
  const modelKey = resolveModelKey(wireModel);
  if (!isClearedForLockedThread(wireModel, policy)) {
    return fail(
      policy.known
        ? "This model cannot answer in a locked chat. Select a different model."
        : "Whirl cannot confirm this model's data retention. Try again in a moment.",
      403,
    );
  }

  const modelConfig = await ctx.runQuery(
    internal.models.streamModelConfigInternal,
    { modelKey, wireModel },
  );
  const modelOverride = modelConfig.custom ?? modelConfig.override;
  const modelSlug = modelOverride?.slug ?? MODEL_IDS[modelKey];
  const isCatalogModel = modelConfig.custom !== null;
  const language = createOpenRouterChatModel({
    apiKey: openRouterApiKey,
    modelKey,
    ...(modelOverride?.slug ? { overrideSlug: modelOverride.slug } : {}),
  });
  // Platinum's Fast tier is on the house here exactly as it is everywhere
  // else; catalog models carry their usual premium unless Platinum waives it.
  const unmetered = isUnmeteredPlatinumTurn({
    isPlatinum,
    modelKey,
    isCustomModel: isCatalogModel,
  });
  const markup = isCatalogModel ? customModelMarkupFor(isPlatinum) : 1;

  const meter = createTurnUsageMeter();
  const startedAt = Date.now();
  let produced = false;

  /* A TransformStream with the producer kicked off beside it, NOT a
     ReadableStream whose `start` does the work.

     The difference is the whole turn. An async `start` has to settle before
     the runtime treats the body as readable, so doing the generation inside
     it means nothing reaches the browser until the reply is already
     finished — which reads, from the other end, as a turn that hangs on
     "Thinking…" forever. Handing back `readable` immediately and writing to
     it from a floating promise is the shape that actually streams, and it's
     the one the persistent-text-streaming component uses for the same job. */
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  let writer: WritableStreamDefaultWriter<Uint8Array> | null =
    writable.getWriter();

  /** Write one event, and stop writing for good once the far end is gone —
   *  a closed tab must not take the billing below down with it. */
  const emit = async (event: TurnEvent) => {
    if (!writer) return;
    try {
      await writer.write(chunk(event));
    } catch {
      writer = null;
    }
  };

  /* Breadcrumbs. A locked turn is driven from a tab and settles onto a row
     the server can't read, so when one goes wrong these lines are the only
     account of it there is. */
  const log = (event: string, extra?: Record<string, unknown>) =>
    console.log("locked_turn", { event, assistantId, model: modelSlug, ...extra });

  const runTurn = async () => {
    const abort = new AbortController();
    const deadline = setTimeout(() => abort.abort(), TURN_TIMEOUT_MS);
    const beat = setInterval(() => {
      void ctx
        .runMutation(internal.lockedThreads.beat, { assistantId })
        .catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    try {
      const result = tracedStreamText({
        model: language,
        system: buildSystemPrompt(identity.name ?? undefined),
        messages: toModelMessages(messages),
        abortSignal: abort.signal,
        providerOptions: {
          openrouter: {
            /* The guarantee itself, enforced where the routing happens:
               OpenRouter uses only endpoints that do not retain prompts, and
               fails the request rather than falling back to one that does.
               The allowlist above stops a user picking a model this would
               reject; this line is what makes the promise true. */
            provider: { zdr: true },
            // Ask OpenRouter to price the response so the usage pool is
            // deducted by what this actually cost.
            usage: { include: true },
            ...(thinking && (modelOverride?.capabilities.reasoning ?? true)
              ? { reasoning: { enabled: true, effort: "medium" } }
              : reasoningOffOptionsFor(modelKey, modelOverride)),
          },
        },
      });

      log("stream_opened", { thinking });
      for await (const part of result.fullStream) {
        switch (part.type) {
          case "finish-step":
            // The only place a per-request price is ever visible.
            meter.recordStep(part);
            break;
          case "reasoning-delta":
            if (thinking) await emit({ t: "reasoning", v: part.text });
            break;
          case "text-delta":
            produced = true;
            await emit({ t: "delta", v: part.text });
            break;
          case "error":
            throw part.error instanceof Error
              ? part.error
              : new Error(String(part.error));
          default:
            break;
        }
      }

      log("stream_finished", {
        produced,
        durationMs: Date.now() - startedAt,
        steps: meter.snapshot().steps,
      });
      await emit({
        t: "done",
        outputTokens: meter.snapshot().outputTokens,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      console.error("locked_turn_failed", {
        assistantId,
        model: modelSlug,
        aborted: abort.signal.aborted,
        produced,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      // Text that already streamed is text the tab has already painted, so
      // this is a note rather than a wipe: the tab keeps what it has and
      // seals it as a reply that was cut short.
      await emit({
        t: "error",
        message: abort.signal.aborted
          ? "This reply took too much time. Whirl stopped it."
          : error instanceof Error
            ? error.message
            : "The model stopped.",
      });
    } finally {
      clearTimeout(deadline);
      clearInterval(beat);

      // Closed before the books are settled: the tab has everything it needs
      // by now, and making it wait on an Autumn round trip would leave the
      // reply sitting there finished but unsealed.
      if (writer) {
        try {
          await writer.close();
        } catch {
          // The far end went away first; nothing left to close.
        }
        writer = null;
      }

      // Billing is not best-effort and doesn't wait on the tab coming back:
      // whatever the provider charged us for goes on the books, even if the
      // user closed the window mid-sentence.
      const usage = meter.snapshot();
      const cost = unmetered ? 0 : usage.costUsd * markup;
      if (cost > 0) {
        await chargeUsage(ctx, {
          customerId,
          idempotencyKey: `${assistantId}:locked:ai`,
          feature: AI_COST_FEATURE_ID,
          amount: cost,
          source: "locked_turn",
          assistantId,
          messageCost: cost,
        });
      }
      if (usage.steps > 0) {
        await ctx.runMutation(internal.lockedThreads.recordTurnCost, {
          assistantId,
          usageCost: cost,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.inputTokens + usage.outputTokens,
        });
      }
      if (!unmetered && produced && usage.costUsd <= 0) {
        // A turn that generated text and reported no cost is the shape of
        // the bug the ledger exists to catch. Never silent.
        console.warn("locked_turn_billed_nothing", {
          assistantId,
          customerId,
          model: modelSlug,
          steps: usage.steps,
        });
      }
    }
  };

  // Deliberately not awaited: the response has to go back now so the browser
  // can start reading it.
  void runTurn();

  return withCors(new Response(readable, { status: 200 }));
});

export const streamLockedTurnOptions = httpAction(async () =>
  withCors(new Response(null, { status: 204 })),
);
