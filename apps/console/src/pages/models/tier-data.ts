import type { ModelTierKey } from "~/lib/backend";

/**
 * The preset tier lineup as the console presents it. Keys are the internal
 * billing keys; labels are what users see in the composer. Default slugs
 * mirror MODEL_IDS in convex/inference/billing.ts — keep the two in sync.
 * Auto is shown on the page but locked: it's OpenRouter's router, not a
 * model choice.
 */
export type TierPreset = {
  key: ModelTierKey;
  label: string;
  blurb: string;
  defaultSlug: string;
};

export const AUTO_TIER = {
  label: "Auto",
  blurb: "Routes each request to the best model. Not customizable.",
  slug: "openrouter/auto",
} as const;

export const TIER_PRESETS: TierPreset[] = [
  {
    key: "Fast",
    label: "Free",
    blurb: "The free tier's everyday model.",
    defaultSlug: "openai/gpt-5.4-nano",
  },
  {
    key: "Basic",
    label: "Fast",
    blurb: "Snappy answers for paid plans.",
    defaultSlug: "moonshotai/kimi-k2.6",
  },
  {
    key: "Max",
    label: "Heavy",
    blurb: "The heavyweight for hard problems.",
    defaultSlug: "x-ai/grok-4.5",
  },
  {
    key: "Image",
    label: "Image",
    blurb: "Paints the pictures.",
    defaultSlug: "openai/gpt-image-2",
  },
];

export function tierPreset(key: ModelTierKey): TierPreset | undefined {
  return TIER_PRESETS.find((preset) => preset.key === key);
}
