"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconArrowLeft } from "@tabler/icons-react";
import { motion } from "motion/react";

import { PaywallView } from "@/components/analytics/paywall-view";
import { pinRasterPath, rise } from "@/lib/motion";
import { PlanPicker } from "./plan-picker";
import { PlatinumStrip } from "./platinum-strip";

export function PricingPage() {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  /* The back link plays the shell-face exit before routing; modified
     clicks (new tab and friends) keep their native behavior. */
  const leave = (event: React.MouseEvent) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    setLeaving(true);
  };

  return (
    <motion.main
      {...(leaving
        ? {
            animate: { opacity: 0, y: -6, filter: "blur(3px)" },
            transition: { duration: 0.1, ease: [0.4, 0, 1, 1] as const },
            onAnimationComplete: () => router.push("/"),
          }
        : {})}
      transformTemplate={pinRasterPath}
      className="min-h-dvh bg-background px-5 py-6 text-foreground sm:px-8 sm:py-8"
    >
      <PaywallView source="pricing_page" />
      <div className="mx-auto max-w-6xl">
        <motion.div {...rise(0)}>
          <Link
            href="/"
            onClick={leave}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <IconArrowLeft size={14} stroke={2.2} />
            Back to Whirl
          </Link>
        </motion.div>

        <motion.header {...rise(0.05)} className="mt-10 sm:mt-12">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Pick your gear
          </h1>
          <p className="mt-2 max-w-xl text-[14px]/6 text-muted-foreground">
            Start free, upgrade when you need more room. Every plan is the same
            Whirl, just with a bigger engine behind it.
          </p>
        </motion.header>

        <motion.div {...rise(0.1)} className="mt-8">
          <PlanPicker />
        </motion.div>

        <motion.div {...rise(0.14)}>
          <PlatinumStrip className="mt-3" />
        </motion.div>

        <motion.p
          {...rise(0.18)}
          className="mt-5 text-[12px]/4 text-muted-foreground"
        >
          Prices are in USD. Switch or cancel anytime — proration is automatic.
        </motion.p>
      </div>
    </motion.main>
  );
}
