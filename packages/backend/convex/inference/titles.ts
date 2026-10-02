import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Autumn } from "autumn-js";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { THREAD_TITLE_SYSTEM_PROMPT } from "../prompts";
import { hasUsageBalance } from "./billing";
import { captureAiGeneration } from "../posthog";
import { APP_NAME, siteUrl } from "../site";
import {
  flushBraintrust,
  tracedGeneration,
  tracedGenerateText,
} from "../braintrust";

export const TITLE_MODEL_ID = "google/gemini-2.5-flash-lite";
const TITLE_MAX_CHARS = 60;
export const TITLE_FALLBACK = "New thread";
const TITLE_FALLBACK_WORDS = 5;
const TITLE_FALLBACK_MIN_CHARS = 4;

export function sanitizeTitle(raw: string) {
  let cleaned = raw.trim();
  if (cleaned.startsWith('"') && cleaned.endsWith('"') && cleaned.length >= 2) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  cleaned = cleaned.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "").trim();
  cleaned = cleaned.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");
  cleaned = cleaned.replace(/[.!?…]+$/g, "").trim();
  if (cleaned.length > TITLE_MAX_CHARS) {
    cleaned = `${cleaned.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…`;
  }
  return cleaned;
}

export function fallbackTitleFromPrompt(prompt: string) {
  const cleaned = prompt
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[`*_#[\](){}<>|~]/g, " ")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < TITLE_FALLBACK_MIN_CHARS) {
    return TITLE_FALLBACK;
  }

  const words = cleaned.split(" ").filter(Boolean).slice(0, TITLE_FALLBACK_WORDS);
  const title = words
    .map((word) => {
      const [first = "", ...rest] = word;
      return `${first.toLocaleUpperCase()}${rest.join("").toLocaleLowerCase()}`;
    })
    .join(" ");

  return sanitizeTitle(title) || TITLE_FALLBACK;
}

async function setThreadTitle({
  ctx,
  threadId,
  title,
}: {
  ctx: ActionCtx;
  threadId: Id<"threads">;
  title: string;
}) {
  await ctx.runMutation(internal.inference.setThreadTitle, {
    threadId,
    title,
  });
}

/**
 * One shot at the title model, shared by every naming path.
 *
 * Returns a sanitized title, or `null` when we couldn't get one — no key, no
 * budget, nothing to summarize, or the model fell over. Callers decide what a
 * miss means: a brand-new thread falls back to the user's prompt, a
 * regeneration keeps the title it already had.
 *
 * `customerId` is for callers that know who they're working for. Scheduled
 * actions carry no auth identity, so without it the balance gate can't run.
 */
export async function requestTitleFromModel({
  ctx,
  threadId,
  system,
  prompt,
  eventName,
  customerId,
}: {
  ctx: ActionCtx;
  threadId: Id<"threads">;
  system: string;
  prompt: string;
  eventName: string;
  customerId?: string;
}): Promise<string | null> {
  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  const autumnSecretKey = process.env.AUTUMN_SECRET_KEY;

  if (!openRouterApiKey) return null;

  const identity = await ctx.auth.getUserIdentity();
  const billableUserId = customerId ?? identity?.subject ?? null;

  if (autumnSecretKey && billableUserId) {
    const autumn = new Autumn({ secretKey: autumnSecretKey });
    // Generate a title only when there's budget in either bucket to cover it.
    const allowed = await hasUsageBalance({
      autumn,
      customerId: billableUserId,
    });
    if (!allowed) return null;
  }

  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) return null;

  try {
    console.log("Thread title generation started.", {
      threadId,
      eventName,
      model: TITLE_MODEL_ID,
    });
    const openRouter = createOpenRouter({
      apiKey: openRouterApiKey,
      appName: APP_NAME,
      appUrl: siteUrl(),
    });
    const model = openRouter.chat(TITLE_MODEL_ID);

    const titleUserId = billableUserId ?? "system";
    const titleStartedAt = Date.now();
    const { text, usage } = await tracedGeneration(
      {
        userId: titleUserId,
        eventId: `${threadId}:${eventName}`,
        convoId: threadId,
        eventName,
        properties: { model: TITLE_MODEL_ID },
      },
      () =>
        tracedGenerateText({
          model,
          system,
          prompt: trimmedPrompt,
          maxOutputTokens: 24,
          temperature: 0.2,
        }),
    );

    await captureAiGeneration({
      distinctId: titleUserId,
      traceId: threadId,
      model: TITLE_MODEL_ID,
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      spanName: eventName,
      input: [
        { role: "system", content: system },
        { role: "user", content: trimmedPrompt },
      ],
      outputChoices: [{ role: "assistant", content: text }],
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      latencySeconds: (Date.now() - titleStartedAt) / 1000,
      properties: { thread_id: threadId },
    });

    const cleaned = sanitizeTitle(text);
    console.log("Thread title generation finished.", {
      threadId,
      eventName,
      rawTitle: text,
      title: cleaned,
    });
    // The model sometimes hands back the very placeholder we're replacing.
    if (cleaned.toLocaleLowerCase() === TITLE_FALLBACK.toLocaleLowerCase()) {
      return null;
    }
    return cleaned || null;
  } catch (error) {
    console.warn(
      "Thread title generation failed.",
      error instanceof Error ? error.message : error,
    );
    return null;
  } finally {
    await flushBraintrust();
  }
}

export async function generateThreadTitleForPrompt({
  ctx,
  threadId,
  prompt,
}: {
  ctx: ActionCtx;
  threadId: Id<"threads">;
  prompt: string;
}) {
  const fallbackTitle = fallbackTitleFromPrompt(prompt);
  const title = await requestTitleFromModel({
    ctx,
    threadId,
    system: THREAD_TITLE_SYSTEM_PROMPT,
    prompt: `Message: "${prompt.trim()}"\nTitle:`,
    eventName: "thread_title",
  });
  await setThreadTitle({ ctx, threadId, title: title ?? fallbackTitle });
}
