import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { action, type ActionCtx } from "./_generated/server";
import { AI_COST_FEATURE_ID } from "./inference/billing";
import { chargeUsage } from "./usageLedger";

/* Dictation. The composer records a clip, drops it in storage, and hands the
   id here; this turns it into text and throws the bytes away. One request to
   OpenRouter's OpenAI-compatible transcription endpoint — no AI SDK, no
   streaming, no retries. A clip either comes back as words or it fails out
   loud, because the user is sitting there watching a spinner. */

const OPENROUTER_TRANSCRIPTIONS_URL =
  "https://openrouter.ai/api/v1/audio/transcriptions";

/* The one and only transcription model: fast enough that a sentence lands
   before the loading state gets boring, and cheap enough that dictation
   doesn't need its own meter. */
const TRANSCRIPTION_MODEL = "openai/whisper-large-v3-turbo";

/* The composer stops recording well before this (see lib/use-voice-input.ts);
   the check here is the backstop for a clip that gets past the UI. */
const MAX_CLIP_BYTES = 25 * 1024 * 1024;

/* Whisper reads the container off the filename, and MediaRecorder's mime type
   is the only clue we have about what it wrote. Anything unrecognized rides in
   as webm — every browser we support records webm or mp4. */
const CONTAINER_EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/mpga": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
};

function clipFileName(mimeType: string) {
  const container = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return `dictation.${CONTAINER_EXTENSIONS[container] ?? "webm"}`;
}

/* What the user reads when a transcription fails. The provider's own detail
   is useful to us and noise to them, so it goes to the logs and they get a
   sentence that says what happened and what to do about it. */
function transcriptionFailureMessage(status: number) {
  if (status === 429) {
    return "Voice input is busy right now. Give it a moment and try again.";
  }
  if (status === 413) {
    return "That recording was too long to transcribe. Try a shorter one.";
  }
  if (status === 401 || status === 403) {
    return "Voice input isn't authorized right now. This one's on us — try again later.";
  }
  return "Voice input couldn't transcribe that. Try again?";
}

/** Turn a recorded clip into text. The clip is deleted either way — a
 * dictation is a keystroke, not an attachment, and nothing should outlive the
 * words it became. */
export const transcribe = action({
  args: {
    clip: v.id("_storage"),
    /* MediaRecorder's chosen mime type, so the container survives the trip. */
    mimeType: v.string(),
  },
  handler: async (ctx, { clip, mimeType }): Promise<{ text: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new ConvexError(
        "Voice input isn't configured on this deployment yet.",
      );
    }

    const audio = await ctx.storage.get(clip);
    if (!audio) {
      throw new ConvexError(
        "That recording expired before it could be transcribed. Try again?",
      );
    }

    try {
      if (audio.size === 0) {
        throw new ConvexError("That recording came through empty. Try again?");
      }
      if (audio.size > MAX_CLIP_BYTES) {
        throw new ConvexError(
          "That recording was too long to transcribe. Try a shorter one.",
        );
      }

      /* Re-wrap rather than forwarding the storage handle straight into the
         multipart body. The blob that comes back out of storage carries
         whatever content type the upload was labelled with, and the one thing
         Whisper reads before the bytes is the part's type and filename — a
         `;codecs=opus` suffix riding along in either is a decode it doesn't
         have to attempt. Plain container, plain extension, same bytes. */
      const container = mimeType.split(";")[0]?.trim().toLowerCase() || "audio/webm";
      const bytes = await audio.arrayBuffer();

      const form = new FormData();
      form.append(
        "file",
        new Blob([bytes], { type: container }),
        clipFileName(mimeType),
      );
      form.append("model", TRANSCRIPTION_MODEL);
      form.append("response_format", "json");
      /* Greedy decoding. Whisper's sampler is where its silence inventions
         come from; at zero it at least stops embellishing. */
      form.append("temperature", "0");

      const response = await fetch(OPENROUTER_TRANSCRIPTIONS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        console.error(
          `Transcription failed (${response.status}): ${detail.slice(0, 500)}`,
        );
        throw new ConvexError(transcriptionFailureMessage(response.status));
      }

      const payload = (await response.json()) as {
        text?: string;
        usage?: { cost?: number };
      };
      const text = (payload.text ?? "").trim();

      /* Dictation is AI spend like any other, so it draws on `ai_cost` and
         overflows into the purchased bucket. Best-effort on purpose: the words
         are already transcribed and paid for upstream, and losing a fraction
         of a cent is worth less than throwing away what the user just said. */
      await billTranscription({
        ctx,
        userId: identity.subject,
        cost: payload.usage?.cost,
        clip,
      });

      if (!text) {
        throw new ConvexError("We didn't catch that. Try again?");
      }
      return { text };
    } finally {
      /* The clip has served its purpose whichever way this went. A failed
         delete is not worth failing a good transcription over. */
      await ctx.storage.delete(clip).catch((error: unknown) => {
        console.warn(
          "Could not delete a dictation clip.",
          error instanceof Error ? error.message : error,
        );
      });
    }
  },
});

async function billTranscription({
  ctx,
  userId,
  cost,
  clip,
}: {
  ctx: ActionCtx;
  userId: string;
  cost: number | undefined;
  clip: string;
}) {
  if (typeof cost !== "number" || !(cost > 0)) return;

  const multiplierEvent = await ctx.runQuery(
    internal.admin.getActiveMultiplierInternal,
    {},
  );
  await chargeUsage(ctx, {
    customerId: userId,
    idempotencyKey: `transcription:${clip}`,
    feature: AI_COST_FEATURE_ID,
    amount: cost * (multiplierEvent?.multiplier ?? 1),
    source: "transcription",
  });
}
