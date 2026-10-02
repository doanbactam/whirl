import type { ModelMessage } from "ai";

/**
 * Encrypted reasoning is endpoint-bound: OpenRouter hands back
 * `reasoning_details` entries (encrypted blobs, signed thinking blocks,
 * compaction payloads) that only the exact model that minted them can decrypt.
 * The AI SDK replays them automatically — every tool step re-sends the previous
 * step's assistant message, provider metadata and all.
 *
 * That is exactly right for a pinned model, and exactly wrong for Auto:
 * `openrouter/auto` picks a model per request, so step 2 of a tool loop can
 * land on a different model than step 1 and the provider rejects the whole
 * request with "your request contains encrypted reasoning or compaction
 * content that was produced under a different model".
 *
 * So: when the route isn't pinned, the replay gets scrubbed. Reasoning is
 * private-by-design anyway — dropping it costs the model nothing it can't
 * re-derive from the tool results it can still see.
 */

/**
 * Whether the wire slug can resolve to a different model on every request.
 * Only OpenRouter's router slugs do this; a concrete slug always names one
 * model, even if it can be served by several providers.
 */
export function routesPerRequest(modelSlug: string) {
  return modelSlug === "openrouter/auto" || modelSlug.endsWith("/auto");
}

type ProviderOptions = Record<string, Record<string, unknown>> | undefined;

/** Provider metadata keys that carry endpoint-bound payloads. */
const ENDPOINT_BOUND_KEYS = ["reasoning_details", "reasoning", "compaction"];

function scrubProviderOptions(options: ProviderOptions): ProviderOptions {
  if (!options) return options;
  let changed = false;
  const next: Record<string, Record<string, unknown>> = {};
  for (const [provider, values] of Object.entries(options)) {
    if (!values || typeof values !== "object") {
      next[provider] = values;
      continue;
    }
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      if (ENDPOINT_BOUND_KEYS.includes(key)) {
        changed = true;
        continue;
      }
      kept[key] = value;
    }
    if (Object.keys(kept).length > 0) next[provider] = kept;
    else changed = true;
  }
  return changed ? next : options;
}

/**
 * Returns a copy of the conversation with every encrypted/signed reasoning
 * payload removed: reasoning content parts go entirely, and the provider
 * metadata that would smuggle `reasoning_details` back onto the wire is
 * stripped from both the message and its parts. Everything else — text, tool
 * calls, tool results, cache control, annotations — is left alone.
 */
export function stripEncryptedReasoning(
  messages: readonly ModelMessage[],
): ModelMessage[] {
  return messages.flatMap((message) => {
    const next = {
      ...message,
      providerOptions: scrubProviderOptions(
        message.providerOptions as ProviderOptions,
      ),
    } as ModelMessage;

    if (Array.isArray(next.content)) {
      next.content = next.content
        .filter((part) => part.type !== "reasoning")
        .map((part) => {
          const withOptions = part as { providerOptions?: ProviderOptions };
          if (!withOptions.providerOptions) return part;
          return {
            ...part,
            providerOptions: scrubProviderOptions(withOptions.providerOptions),
          };
        }) as typeof next.content;
      // A reasoning-only step leaves nothing behind once the reasoning is
      // gone; an empty assistant turn is not a valid request part, so it goes
      // too rather than riding along as a hollow message.
      if (next.content.length === 0) return [];
    }

    return [next];
  });
}
