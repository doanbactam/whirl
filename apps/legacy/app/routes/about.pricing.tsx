import type { ComponentType } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  IconBarbell,
  IconBolt,
  IconBrain,
  IconCpu,
  IconFeather,
  IconPaperclip,
  IconSearch,
  IconSparkles,
} from "@tabler/icons-react";

import { CtaLink, Lede, PageTitle } from "~/components/about/page-blocks";
import { seo } from "~/lib/seo";

export const Route = createFileRoute("/about/pricing")({
  component: AboutPricing,
  head: () =>
    seo({
      title: "Pricing · Whirl",
      description:
        "Whirl starts free. Mini, Turbo, and Mega add more usage across the best AI models, thinking mode, live web search, and larger uploads.",
      url: "/about/pricing",
    }),
});

type IconType = ComponentType<{ size?: number; stroke?: number; className?: string }>;

type Plan = {
  name: string;
  /** Badge art from /plan-badges; the Free plan has none and shows the mark. */
  badge?: string;
  price: number;
  tagline: string;
  features: { icon: IconType; label: string }[];
  cta: string;
};

/** Mirrors the live checkout page (routes/pricing.tsx) — keep the two in sync. */
const PLANS: Plan[] = [
  {
    name: "Free",
    price: 0,
    tagline: "Kick the tires, no card required.",
    features: [
      { icon: IconSparkles, label: "15 free messages per day" },
      { icon: IconFeather, label: "The Free model only" },
      { icon: IconPaperclip, label: "File uploads up to 1 MB" },
    ],
    cta: "about_pricing_free",
  },
  {
    name: "Mini",
    badge: "/plan-badges/mini.svg",
    price: 5,
    tagline: "A daily-driver budget.",
    features: [
      { icon: IconCpu, label: "Plenty for daily questions" },
      { icon: IconBolt, label: "Unlocks the Fast model" },
      { icon: IconBrain, label: "Thinking mode for hard problems" },
      { icon: IconPaperclip, label: "Larger file uploads" },
      { icon: IconSearch, label: "Live web search" },
    ],
    cta: "about_pricing_mini",
  },
  {
    name: "Turbo",
    badge: "/plan-badges/turbo.svg",
    price: 12,
    tagline: "More room. Smarter answers.",
    features: [
      { icon: IconCpu, label: "About 2.5x Mini's weekly usage" },
      { icon: IconBarbell, label: "Adds Heavy, our most capable model" },
      { icon: IconBrain, label: "Thinking mode for hard problems" },
      { icon: IconPaperclip, label: "Larger file uploads" },
      { icon: IconSearch, label: "Live web search" },
    ],
    cta: "about_pricing_turbo",
  },
  {
    name: "Mega",
    badge: "/plan-badges/mega.svg",
    price: 30,
    tagline: "The whole toolbox.",
    features: [
      { icon: IconCpu, label: "About 7x Mini's weekly usage" },
      { icon: IconBarbell, label: "Heavy, with room to run it all week" },
      { icon: IconBrain, label: "Thinking mode" },
      { icon: IconPaperclip, label: "Larger file uploads" },
      { icon: IconSearch, label: "Live web search" },
    ],
    cta: "about_pricing_mega",
  },
];

function PlanCell({ plan }: { plan: Plan }) {
  return (
    <div className="flex flex-col gap-4 bg-white p-5 sm:p-6 dark:bg-[#161615]">
      <div className="flex items-center gap-3">
        {plan.badge ? (
          <img src={plan.badge} alt="" width={32} height={32} className="h-8 w-8" />
        ) : (
          <img src="/whirl.svg" alt="" width={32} height={32} className="h-8 w-8 dark:invert" />
        )}
        <div>
          <h2 className="text-[16px] font-semibold text-neutral-900 dark:text-neutral-50">
            {plan.name}
          </h2>
          <p className="text-[12.5px] text-neutral-500 dark:text-neutral-400">
            {plan.tagline}
          </p>
        </div>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-[32px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
          ${plan.price}
        </span>
        <span className="text-[13px] text-neutral-500 dark:text-neutral-400">
          / month
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {plan.features.map(({ icon: Icon, label }) => (
          <li
            key={label}
            className="flex items-start gap-2.5 text-[13px] text-neutral-700 dark:text-neutral-200"
          >
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-black/[0.05] text-neutral-700 dark:bg-white/[0.08] dark:text-neutral-200">
              <Icon size={12} stroke={2} />
            </span>
            {label}
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-2">
        <CtaLink to="/pricing" primary={plan.price > 0} cta={plan.cta}>
          {plan.price === 0 ? "Start free" : `Get ${plan.name}`}
        </CtaLink>
      </div>
    </div>
  );
}

function AboutPricing() {
  return (
    <article>
      <PageTitle>Pricing</PageTitle>
      <Lede className="mt-5">
        Start free, upgrade when you want more room. Every paid plan runs on
        the same Whirl, just with a bigger engine behind it.
      </Lede>
      <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-3xl bg-black/[0.07] ring-1 ring-black/[0.07] sm:grid-cols-2 dark:bg-white/[0.08] dark:ring-white/[0.08]">
        {PLANS.map((plan) => (
          <PlanCell key={plan.name} plan={plan} />
        ))}
      </div>
      <p className="mt-6 text-[13px] text-neutral-500 dark:text-neutral-400">
        Prices in USD. Change or cancel your plan anytime.
      </p>
    </article>
  );
}
