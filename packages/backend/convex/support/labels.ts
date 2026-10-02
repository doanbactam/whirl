// Turning message rows into words the support agent can say out loud.
//
// Everything here ends up in a customer's chat, so it follows the knowledge
// base rules: models go by their tier label, never by the provider behind
// them, and a provider's raw error text never leaves this file.

import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { GATE_SENTINEL_PREFIX, OVERLOAD_SENTINEL } from "../inference/billing";
import { INTERRUPTED_TURN_MESSAGE } from "../streamWatchdog";

/* Internal tier keys don't match their labels on purpose (see the note on
   the models table). "Pro" is retired and folds into Auto. */
const TIER_LABELS: Record<string, string> = {
  Auto: "Auto",
  Fast: "Free",
  Basic: "Fast",
  Pro: "Auto",
  Max: "Heavy",
  Image: "Image",
};

/**
 * What the picker called the model a reply used. Anything that isn't a tier
 * is a custom catalog slug, which the picker shows by its display name.
 */
export async function modelLabel(
  ctx: QueryCtx,
  model: string | undefined,
  cache: Map<string, string>,
): Promise<string> {
  if (!model) return "Auto";
  const tier = TIER_LABELS[model];
  if (tier) return tier;

  const cached = cache.get(model);
  if (cached) return cached;

  const row = await ctx.db
    .query("models")
    .withIndex("by_slug", (q) => q.eq("slug", model))
    .first();
  const label = row?.displayName ?? "a custom model";
  cache.set(model, label);
  return label;
}

/**
 * A thread as the sidebar names it. A locked thread's real title is sealed,
 * so it gets no name here either.
 */
export function threadLabel(thread: Doc<"threads"> | null): string {
  if (!thread) return "a deleted thread";
  if (thread.lock) return "a locked thread";
  return thread.title || "Untitled thread";
}

/* The client parses these same sentinels into the upgrade modal. */
const GATE_REASONS: Record<string, string> = {
  usage: "Their plan's usage ran out for this period, so the reply was blocked before it started.",
  messages: "They had used all of today's free messages, so the reply was blocked before it started.",
  auto: "Auto needs a paid plan, so the reply was blocked before it started.",
  basic: "That model needs a paid plan, so the reply was blocked before it started.",
  max: "Heavy needs a paid plan, so the reply was blocked before it started.",
  image: "Image generation needs a paid plan, so the reply was blocked before it started.",
  reasoning: "Thinking mode needs a paid plan, so the reply was blocked before it started.",
  can_search: "Web search needs a paid plan, so the reply was blocked before it started.",
  files: "The attachment needs a paid plan (free uploads stop at 1 MB), so the reply was blocked.",
  compact: "The thread got too long to continue, and compacting it needs a paid plan.",
};

export type ProblemKind =
  | "blocked_by_plan"
  | "server_busy"
  | "connection_dropped"
  | "model_error"
  | "image_failed"
  | "whirl_misconfigured"
  | "cut_short"
  | "failed";

export type Problem = { kind: ProblemKind; explanation: string };

/* Provider errors arrive as free text. Sort them into something a person can
   act on, and drop the text itself: it names providers and model slugs. */
function providerErrorExplanation(detail: string): string {
  const text = detail.toLowerCase();
  if (/\b429\b|rate.?limit|too many requests|overloaded|capacity/.test(text)) {
    return "The model was overloaded or rate limited at that moment. Retrying a minute later usually works, or picking another model.";
  }
  if (/context|too long|maximum.*tokens|token limit/.test(text)) {
    return "The conversation was too long for the model to read in one go. Starting a new thread, or a model with a bigger window, gets past it.";
  }
  if (/moderation|safety|content policy|flagged|refus/.test(text)) {
    return "The model's safety filter rejected the request. Rewording it usually gets through.";
  }
  if (/timeout|timed out|deadline/.test(text)) {
    return "The model took too long to answer and the request timed out. Retrying usually works.";
  }
  return "The model service returned an error partway through. Retrying usually works; if the same thread keeps failing, a new thread or another model gets around it.";
}

/** Why an assistant turn didn't end cleanly, or null when it did. */
export function describeProblem(message: Doc<"messages">): Problem | null {
  if (message.status === "stopped") {
    return {
      kind: "cut_short",
      explanation:
        "The reply stopped before it finished, either because they pressed stop or because the connection dropped after part of it arrived.",
    };
  }
  if (message.status !== "error") return null;

  const content = message.content;
  if (content.startsWith(GATE_SENTINEL_PREFIX)) {
    const gate = content.slice(GATE_SENTINEL_PREFIX.length);
    return {
      kind: "blocked_by_plan",
      explanation:
        GATE_REASONS[gate] ??
        "Their plan doesn't include what that message asked for, so the reply was blocked before it started.",
    };
  }
  if (content === OVERLOAD_SENTINEL) {
    return {
      kind: "server_busy",
      explanation:
        "Free-plan sends were paused for a moment because the servers were under heavy load. It clears on its own; paid plans skip the pause.",
    };
  }
  if (content === INTERRUPTED_TURN_MESSAGE) {
    return {
      kind: "connection_dropped",
      explanation:
        "The connection to the model dropped before any of the reply arrived. Retrying runs it again.",
    };
  }
  if (content.startsWith("Image generation failed")) {
    return {
      kind: "image_failed",
      explanation:
        "The image service has short outage windows that clear on their own, and this landed in one. Waiting a bit and retrying is the fix, and changing plan won't help.",
    };
  }
  if (content.startsWith("AI provider error")) {
    return {
      kind: "model_error",
      explanation: providerErrorExplanation(content),
    };
  }
  if (content.startsWith("The server is missing part of its configuration")) {
    return {
      kind: "whirl_misconfigured",
      explanation:
        "Something on Whirl's side was misconfigured, so the reply never started. Not their fault; hand this one to a teammate.",
    };
  }
  return {
    kind: "failed",
    explanation: "The reply failed without a recorded reason. Retrying usually works.",
  };
}
