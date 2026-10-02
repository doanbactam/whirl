import {
  IconBarbell,
  IconBoltFilled,
  IconBrain,
  IconStack2Filled,
  IconTagFilled,
} from "@tabler/icons-react";

import type { PlanFeature } from "@/components/pricing/plan-catalog";
import type { PlatinumPlanId } from "@/lib/plan";

export type PlatinumTier = {
  id: PlatinumPlanId;
  name: string;
  price: number;
  tagline: string;
  features: PlanFeature[];
};

/* The catalog-rate perk stays unquantified: the premium it removes is an
   internal number (convex/inference/billing.ts) we've never published. */
const SHARED_FEATURES: PlanFeature[] = [
  { icon: IconBoltFilled, label: "The Fast model, unmetered" },
  { icon: IconBarbell, label: "Every model, Heavy included" },
  { icon: IconBrain, label: "Extended thinking and web search" },
  { icon: IconTagFilled, label: "Preferential catalog rates" },
];

export const PLATINUM_TIERS: readonly PlatinumTier[] = [
  {
    id: "platinum",
    name: "Platinum",
    price: 100,
    tagline: "Five times the Mega allowance.",
    features: [
      { icon: IconStack2Filled, label: "5× the Mega allowance" },
      ...SHARED_FEATURES,
    ],
  },
  {
    id: "platinum_max",
    name: "Platinum Max",
    price: 200,
    tagline: "Ten times the Mega allowance.",
    features: [
      { icon: IconStack2Filled, label: "10× the Mega allowance" },
      ...SHARED_FEATURES,
    ],
  },
] as const;
