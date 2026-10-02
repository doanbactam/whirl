import type { TablerIcon } from "@tabler/icons-react";
import {
  IconBarbell,
  IconBrain,
  IconCpu,
  IconFeather,
  IconPaperclip,
  IconSearch,
  IconSparkles,
} from "@tabler/icons-react";

import type { PlanId } from "@/lib/plan";

export type PricingPlanId = "free" | PlanId;

export type PlanFeature = {
  icon: TablerIcon;
  label: string;
};

export type PlanDefinition = {
  id: PricingPlanId;
  name: string;
  price: number;
  tagline: string;
  description: string;
  features: PlanFeature[];
};

export const PLAN_DEFINITIONS: readonly PlanDefinition[] = [
  {
    id: "free",
    name: "Free",
    price: 0,
    tagline: "Kick the tires, no card required.",
    description: "A gentle way to see if Whirl fits.",
    features: [
      { icon: IconSparkles, label: "15 free messages per day" },
      { icon: IconFeather, label: "The Free model" },
      { icon: IconPaperclip, label: "File uploads up to 1 MB" },
    ],
  },
  {
    id: "mini",
    name: "Mini",
    price: 5,
    tagline: "A daily-driver budget.",
    description: "More room for everyday questions and quick work.",
    features: [
      { icon: IconCpu, label: "Plenty for daily questions" },
      { icon: IconBarbell, label: "Every model, Heavy included" },
      { icon: IconBrain, label: "Thinking mode for hard problems" },
      { icon: IconPaperclip, label: "Larger file uploads" },
      { icon: IconSearch, label: "Live web search" },
    ],
  },
  {
    id: "turbo",
    name: "Turbo",
    price: 12,
    tagline: "More room. Smarter answers.",
    description: "The sweet spot for people who use Whirl every day.",
    features: [
      { icon: IconCpu, label: "About 2.5× Mini's weekly usage" },
      { icon: IconBarbell, label: "Every model, with room to lean on Heavy" },
      { icon: IconBrain, label: "Thinking mode for hard problems" },
      { icon: IconPaperclip, label: "Larger file uploads" },
      { icon: IconSearch, label: "Live web search" },
    ],
  },
  {
    id: "mega",
    name: "Mega",
    price: 30,
    tagline: "The whole toolbox.",
    description: "Heavy-duty headroom for the truly curious.",
    features: [
      { icon: IconCpu, label: "About 7× Mini's weekly usage" },
      { icon: IconBarbell, label: "Every model, all week, no flinching" },
      { icon: IconBrain, label: "Thinking mode" },
      { icon: IconPaperclip, label: "Larger file uploads" },
      { icon: IconSearch, label: "Live web search" },
    ],
  },
] as const;
