import type { TablerIcon } from "@tabler/icons-react";
import {
  IconBarbell,
  IconBolt,
  IconFeather,
  IconPhoto,
  IconWand,
} from "@tabler/icons-react";

import type { ModelKey } from "~/data/models";

export type ModelTierOption = {
  key: ModelKey;
  blurb: string;
  icon: TablerIcon;
  /** Relative capability, 0–100. */
  intelligence: number;
  /** Relative usage cost, 0–100. */
  usage: number;
};

// Keys are the persisted tier ids, labels come from MODEL_LABELS: the `Fast`
// key is Free (free-only) and the `Basic` key is the paid Fast tier.
export const MODEL_TIERS: ModelTierOption[] = [
  {
    key: "Auto",
    blurb: "Picks the best model for what you're asking",
    icon: IconWand,
    intelligence: 70,
    usage: 55,
  },
  {
    key: "Fast",
    blurb: "Light and quick, on the house",
    icon: IconFeather,
    intelligence: 30,
    usage: 10,
  },
  {
    key: "Basic",
    blurb: "Snappy answers for everyday questions",
    icon: IconBolt,
    intelligence: 60,
    usage: 35,
  },
  {
    key: "Max",
    blurb: "Our smartest model, uses the most usage",
    icon: IconBarbell,
    intelligence: 100,
    usage: 100,
  },
  {
    key: "Image",
    blurb: "Paints pictures instead of paragraphs",
    icon: IconPhoto,
    intelligence: 65,
    usage: 80,
  },
];

export function modelTierFor(key: ModelKey): ModelTierOption {
  const tier = MODEL_TIERS.find((m) => m.key === key);
  if (!tier) throw new Error(`Unknown model tier: ${key}`);
  return tier;
}
