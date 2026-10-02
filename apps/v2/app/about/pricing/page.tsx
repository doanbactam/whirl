import type { Metadata } from "next";

import { PaywallView } from "@/components/analytics/paywall-view";
import { Lede, PageTitle, CtaLink } from "@/components/marketing/page-blocks";
import {
  PLAN_DEFINITIONS,
  type PlanDefinition,
} from "@/components/pricing/plan-catalog";
import { PlanMark } from "@/components/pricing/plan-mark";
import { PlatinumStrip } from "@/components/pricing/platinum-strip";
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Pricing · Whirl",
  description:
    "Whirl starts free. Mini, Turbo, and Mega add more usage across the best AI models.",
  path: "/about/pricing",
});

function PlanCell({ plan }: { plan: PlanDefinition }) {
  return (
    <article className="flex flex-col gap-4 bg-white p-5 sm:p-6 dark:bg-[#161615]">
      <div className="flex min-h-8 items-center">
        <PlanMark plan={plan.id} />
      </div>
      <div>
        <h2 className="text-base font-semibold">{plan.name}</h2>
        <p className="text-[12.5px] text-neutral-500">{plan.tagline}</p>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-[32px] font-semibold tracking-tight">
          ${plan.price}
        </span>
        <span className="text-[13px] text-neutral-500">
          {plan.price === 0 ? "forever" : "/ month"}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {plan.features.map(({ icon: Icon, label }) => (
          <li key={label} className="flex items-start gap-2.5 text-[13px]">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-black/5 dark:bg-white/8">
              <Icon size={12} stroke={2} />
            </span>
            {label}
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-2">
        <CtaLink href="/pricing" primary={plan.id !== "free"}>
          {plan.id === "free" ? "Start free" : `Get ${plan.name}`}
        </CtaLink>
      </div>
    </article>
  );
}

export default function PricingPage() {
  return (
    <article>
      <PaywallView source="marketing_pricing" />
      <PageTitle>Pricing</PageTitle>
      <Lede>
        Start free, upgrade when you want more room. Every paid plan runs on the
        same Whirl, just with a bigger engine behind it.
      </Lede>
      <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-3xl bg-black/7 ring-1 ring-black/7 sm:grid-cols-2 dark:bg-white/8 dark:ring-white/8">
        {PLAN_DEFINITIONS.map((plan) => (
          <PlanCell key={plan.id} plan={plan} />
        ))}
      </div>
      <PlatinumStrip tone="marketing" className="mt-4 rounded-3xl" />
      <p className="mt-6 text-[13px] text-neutral-500">
        Prices in USD. Change or cancel your plan anytime.
      </p>
    </article>
  );
}
