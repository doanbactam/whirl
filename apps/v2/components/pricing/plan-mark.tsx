import Image from "next/image";

import { PlanBadge, planBadgeSrc } from "@/components/plan-badge";
import { WhirlLogo } from "@/components/whirl-logo";
import type { PricingPlanId } from "./plan-catalog";

export function PlanMark({
  plan,
  large = false,
}: {
  plan: PricingPlanId;
  large?: boolean;
}) {
  if (plan === "free") {
    return (
      <span className={large ? "size-10" : "size-8"}>
        <WhirlLogo size={large ? 40 : 32} />
      </span>
    );
  }

  return large ? (
    <Image
      src={planBadgeSrc(plan)}
      alt={`${plan} plan`}
      width={120}
      height={48}
      className="h-10 w-auto"
    />
  ) : (
    <PlanBadge plan={plan} className="h-5 w-auto" />
  );
}
