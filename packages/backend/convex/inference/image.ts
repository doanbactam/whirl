import type { Id } from "../_generated/dataModel";
import { MODEL_IDS } from "./billing";

// Everything the Image tier needs to talk to OpenRouter's unified Images API
// (POST /api/v1/images). It's a single non-streaming request/response — no AI
// SDK involved — that hands back the generated image bytes plus the exact USD
// cost, which the caller feeds through the normal usage deduction.

const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images";

// Fixed generation quality for gpt-image-2. Deliberately not user-tunable.
const IMAGE_QUALITY = "medium";

// The one and only image model. No fallbacks, no retries: one request, and a
// paint is gpt-image-2 or it fails, loudly. Beware that OpenRouter's OpenAI
// image upstream rate-limits by origin region, and Convex's shared egress can
// sit behind a tripped breaker for hours — every call instant-429s while the
// same request from anywhere else succeeds. When that happens, paints fail
// until the breaker clears (or an OPENAI_API_KEY direct path is added to
// sidestep OpenRouter).
const IMAGE_MODEL = MODEL_IDS.Image;

// A reference image as the rest of the backend knows it: a row in storage,
// sometimes with a hosted URL already hydrated onto it.
export type ImageReferenceSource = {
  name: string;
  type?: string;
  url?: string;
  storageId?: Id<"_storage">;
};

// A reference image as the Images API takes it: one URL, always a data URL by
// the time it leaves resolveImageReferences.
export type ImageInputReference = {
  name: string;
  url: string;
};

export type GeneratedImage = {
  blob: Blob;
  mediaType: string;
};

type ImageReferenceStorage = {
  get(storageId: Id<"_storage">): Promise<Blob | null>;
};

// Reference bytes are inlined into the request, so they live in the action's
// isolate alongside the base64 blow-up (~4/3 of the raw size). Uploads are
// compressed client-side and generated images run ~1-2MB, so these caps only
// ever trip on something pathological — better a readable error than an
// out-of-memory kill mid-turn.
const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_REFERENCE_BYTES = 20 * 1024 * 1024;

// A reference image we couldn't turn into bytes. Separate from the transport
// error so the message reads like the local problem it is.
export class ImageReferenceError extends Error {}

export function bytesToBase64(bytes: Uint8Array): string {
  // String.fromCharCode is applied in chunks — spreading a multi-MB array in
  // one call blows the argument limit.
  const CHUNK = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/**
 * Turn stored reference images into inline data URLs for `input_references`.
 *
 * The Images API accepts a reference as either a public web URL or a base64
 * data URL, and it fetches web URLs itself behind a strict allowlist —
 * Convex storage links don't clear it ("Unsupported URL, public internet
 * addresses only"), so every paint with a reference image died at the door.
 * We read the bytes out of storage and hand over data URLs instead, which
 * takes the provider's fetcher out of the loop entirely.
 */
export async function resolveImageReferences({
  storage,
  references,
}: {
  storage: ImageReferenceStorage;
  references: readonly ImageReferenceSource[];
}): Promise<ImageInputReference[]> {
  const resolved: ImageInputReference[] = [];
  let totalBytes = 0;

  for (const reference of references) {
    // Legacy inline attachments already carry a data URL — pass it through.
    if (reference.url?.startsWith("data:")) {
      resolved.push({ name: reference.name, url: reference.url });
      continue;
    }

    const blob = await readReferenceBlob(storage, reference);
    if (blob.size > MAX_REFERENCE_BYTES) {
      throw new ImageReferenceError(
        `reference image "${reference.name}" is too large to send (${Math.round(
          blob.size / (1024 * 1024),
        )}MB)`,
      );
    }
    totalBytes += blob.size;
    if (totalBytes > MAX_TOTAL_REFERENCE_BYTES) {
      throw new ImageReferenceError(
        "the reference images on this turn are too large to send together",
      );
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mediaType = blob.type || reference.type || "image/png";
    resolved.push({
      name: reference.name,
      url: `data:${mediaType};base64,${bytesToBase64(bytes)}`,
    });
  }

  return resolved;
}

async function readReferenceBlob(
  storage: ImageReferenceStorage,
  reference: ImageReferenceSource,
): Promise<Blob> {
  if (reference.storageId) {
    const blob = await storage.get(reference.storageId);
    if (!blob) {
      throw new ImageReferenceError(
        `reference image "${reference.name}" is no longer available`,
      );
    }
    return blob;
  }

  // No storage row (an older attachment that only kept its hosted URL) —
  // fetch the bytes ourselves rather than asking the provider to.
  if (reference.url) {
    const response = await fetch(reference.url);
    if (!response.ok) {
      throw new ImageReferenceError(
        `reference image "${reference.name}" couldn't be downloaded (${response.status})`,
      );
    }
    return await response.blob();
  }

  throw new ImageReferenceError(
    `reference image "${reference.name}" has no readable source`,
  );
}

// The Images API takes a single prompt string rather than a message history,
// so reference images are described in a preamble: the user's own attachments
// keep their @<file name> handles (matching what the composer showed them),
// and the previously generated image — the edit target on follow-up turns —
// is always listed last, in the same order the images ride in
// `input_references`.
export function buildImagePrompt({
  text,
  userImages,
  hasPreviousImage,
}: {
  text: string;
  userImages: readonly { name: string }[];
  hasPreviousImage: boolean;
}): string {
  const lines: string[] = [];

  if (userImages.length > 0 || hasPreviousImage) {
    const labels = userImages.map(
      (image, index) => `image ${index + 1} = @${image.name}`,
    );
    if (hasPreviousImage) {
      labels.push(
        `image ${userImages.length + 1} = the image you previously generated in this conversation; when the request is an edit or follow-up, apply it to this one unless told otherwise`,
      );
    }
    lines.push(`Reference images, in order: ${labels.join("; ")}.`);
  }

  const trimmed = text.trim();
  if (trimmed) {
    lines.push(trimmed);
  } else if (hasPreviousImage) {
    lines.push("Refine the previous image.");
  } else if (userImages.length > 0) {
    lines.push("Generate an image based on the reference image(s).");
  }

  return lines.join("\n\n");
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function truncateForError(text: string, max = 400): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

// One transport error, carrying the provider's status and response body so
// the failure lands in the logs and on the message with its real reason.
export class ImageGenerationHttpError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(
      `image generation failed (${status})${
        detail ? `: ${truncateForError(detail)}` : ""
      }`,
    );
    this.status = status;
  }
}

// A 200 with no picture in it. Reads as a 502 to everything that already
// handles transport errors, but stays tellable apart: a model that answered
// and chose not to paint (a refusal, usually) is not a provider outage.
export class ImageEmptyResponseError extends ImageGenerationHttpError {
  constructor() {
    super(502, "the model returned no image");
  }
}

/**
 * Generate images through OpenRouter's unified Images API: exactly one
 * gpt-image-2 request, no retries. A failure is console.error'd with the
 * provider's status and body before it propagates, so a dead paint is never
 * silent in the logs.
 */
export type ImageOutputFormat = "png" | "jpeg" | "webp";

export async function callOpenRouterImageGeneration({
  apiKey,
  prompt,
  inputReferences,
  abortSignal,
  model = IMAGE_MODEL,
  quality = IMAGE_QUALITY,
  outputFormat,
  aspectRatio,
  resolution,
}: {
  apiKey: string;
  prompt: string;
  inputReferences: readonly ImageInputReference[];
  abortSignal?: AbortSignal;
  // Admin override for the Image tier (convex/models.ts); defaults to the
  // hardcoded gpt-image-2.
  model?: string;
  // gpt-image-2's quality knob. `null` leaves it out of the request, for
  // models that don't take one.
  quality?: string | null;
  // The provider's default (PNG) unless a caller asks for something lighter.
  outputFormat?: ImageOutputFormat;
  // One of the provider's ratios ("4:3"). Edits otherwise come back in the
  // model's default shape, not the source's.
  aspectRatio?: string;
  // "1K", "2K"... Some providers bill by it and default to the dear one.
  resolution?: string;
}): Promise<{ images: GeneratedImage[]; cost?: number; model: string }> {
  try {
    const result = await requestImageGeneration({
      apiKey,
      model,
      prompt,
      inputReferences,
      abortSignal,
      quality,
      outputFormat,
      aspectRatio,
      resolution,
    });
    return { ...result, model };
  } catch (error) {
    if (!abortSignal?.aborted) {
      console.error(
        `image generation failed (${model}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    throw error;
  }
}

async function requestImageGeneration({
  apiKey,
  model,
  prompt,
  inputReferences,
  abortSignal,
  quality,
  outputFormat,
  aspectRatio,
  resolution,
}: {
  apiKey: string;
  model: string;
  prompt: string;
  inputReferences: readonly ImageInputReference[];
  abortSignal?: AbortSignal;
  quality: string | null;
  outputFormat?: ImageOutputFormat;
  aspectRatio?: string;
  resolution?: string;
}): Promise<{ images: GeneratedImage[]; cost?: number }> {
  const body: Record<string, unknown> = {
    model,
    prompt,
    ...(quality ? { quality } : {}),
    ...(outputFormat ? { output_format: outputFormat } : {}),
    ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
    ...(resolution ? { resolution } : {}),
  };
  if (inputReferences.length > 0) {
    // Always data URLs by now — see resolveImageReferences for why we never
    // hand the provider a link to fetch.
    body.input_references = inputReferences.map((reference) => ({
      type: "image_url",
      image_url: { url: reference.url },
    }));
  }

  const response = await fetch(OPENROUTER_IMAGES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: abortSignal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ImageGenerationHttpError(response.status, detail);
  }

  const payload = (await response.json()) as {
    data?: {
      b64_json?: string;
      url?: string;
      media_type?: string;
    }[];
    usage?: { cost?: number };
  };

  const images: GeneratedImage[] = [];
  for (const item of payload.data ?? []) {
    const mediaType = item.media_type || "image/png";
    if (item.b64_json) {
      const bytes = decodeBase64(item.b64_json);
      images.push({
        blob: new Blob([bytes.buffer as ArrayBuffer], { type: mediaType }),
        mediaType,
      });
    } else if (item.url) {
      // Some providers hand back a hosted URL instead of inline bytes.
      const fetched = await fetch(item.url, { signal: abortSignal });
      if (!fetched.ok) continue;
      const buffer = await fetched.arrayBuffer();
      images.push({
        blob: new Blob([buffer], {
          type: fetched.headers.get("content-type") || mediaType,
        }),
        mediaType: fetched.headers.get("content-type") || mediaType,
      });
    }
  }

  if (images.length === 0) {
    throw new ImageEmptyResponseError();
  }

  const cost = payload.usage?.cost;
  return { images, cost: typeof cost === "number" ? cost : undefined };
}
