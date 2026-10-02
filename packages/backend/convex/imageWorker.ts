import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { AI_COST_FEATURE_ID, IMAGE_COST_MARKUP } from "./inference/billing";
import { callOpenRouterImageGeneration } from "./inference/image";
import { captureServerEvent } from "./posthog";
import { chargeUsage } from "./usageLedger";

/**
 * Background painter for the generateImage chat tool. Scheduled by
 * beginImageGeneration the moment whirl calls the tool, so the reply stream
 * never waits on the provider — slow paints used to hold the tool call open
 * long enough to time the whole turn out. Runs the generation, stores the
 * bytes, lands the public URLs on the message's pending `image` phase (which
 * the chat renders reactively as an inline picture card), bills the usage
 * pool, and records analytics. Failures finalize the phase with an error so
 * the card never shimmers forever.
 */
export const paintImage = internalAction({
  args: {
    assistantId: v.id("messages"),
    threadId: v.id("threads"),
    userId: v.string(),
    prompt: v.string(),
    callIdx: v.number(),
    streamId: v.string(),
    billingKey: v.string(),
  },
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const settle = async (result: {
      count?: number;
      images?: string[];
      ok: boolean;
      error?: string;
      costDollars?: number;
      model?: string;
    }) => {
      await ctx.runMutation(internal.inference.finalizeLastPendingImage, {
        assistantId: args.assistantId,
        prompt: args.prompt,
        ...(result.count !== undefined ? { count: result.count } : {}),
        ...(result.images !== undefined ? { images: result.images } : {}),
        ok: result.ok,
        ...(result.error ? { error: result.error } : {}),
        expectedStreamId: args.streamId,
      });
      await captureServerEvent({
        event: "image_generated",
        distinctId: args.userId,
        properties: {
          thread_id: args.threadId,
          via: "tool",
          background: true,
          ok: result.ok,
          image_count: result.count ?? 0,
          provider_cost: result.costDollars,
          duration_ms: Date.now() - startedAt,
          call_idx: args.callIdx,
          image_model: result.model,
          // Convex logs expire fast; the failure reason rides along here so
          // there's a durable record of WHY a paint died.
          ...(result.error ? { error: result.error } : {}),
        },
      });
    };

    const openRouterApiKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterApiKey) {
      console.error("paintImage: OPENROUTER_API_KEY is not set");
      await settle({ ok: false, error: "image generation is not configured" });
      return;
    }

    try {
      // The generateImage tool paints with whatever serves the Image tier —
      // the admin override when one is set, gpt-image-2 otherwise.
      const tierOverride = await ctx.runQuery(
        internal.models.tierOverrideInternal,
        { modelKey: "Image" },
      );
      const result = await callOpenRouterImageGeneration({
        apiKey: openRouterApiKey,
        prompt: args.prompt,
        inputReferences: [],
        ...(tierOverride ? { model: tierOverride.slug } : {}),
      });

      const images: string[] = [];
      for (const image of result.images) {
        const storageId = await ctx.storage.store(image.blob);
        const url = await ctx.storage.getUrl(storageId);
        if (!url) {
          throw new Error("stored image has no URL");
        }
        images.push(url);
      }

      await settle({
        count: images.length,
        images,
        ok: true,
        model: result.model,
        ...(typeof result.cost === "number"
          ? { costDollars: result.cost }
          : {}),
      });

      // Bill the marked-up provider cost against the usage pool, plan-first
      // then overflow — the same shape the in-stream tools use. Through the
      // ledger, so a billing hiccup postpones the charge instead of losing it
      // while the picture stays on screen either way.
      if (typeof result.cost === "number" && result.cost > 0) {
        const billedCost = result.cost * IMAGE_COST_MARKUP;
        const multiplierEvent = await ctx.runQuery(
          internal.admin.getActiveMultiplierInternal,
          {},
        );
        await chargeUsage(ctx, {
          customerId: args.userId,
          idempotencyKey: args.billingKey,
          feature: AI_COST_FEATURE_ID,
          amount: billedCost * (multiplierEvent?.multiplier ?? 1),
          source: "image_tool",
          assistantId: args.assistantId,
          messageCost: billedCost,
        });
      }
    } catch (error) {
      console.error(
        `paintImage failed (assistant ${args.assistantId}, call ${args.callIdx}, ${
          Date.now() - startedAt
        }ms):`,
        error instanceof Error ? error.message : error,
      );
      await settle({
        ok: false,
        error:
          error instanceof Error ? error.message : "image generation failed",
      });
    }
  },
});
