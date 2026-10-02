"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconArrowLeft } from "@tabler/icons-react";
import { api } from "@whirl/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { motion } from "motion/react";

import { PaywallView } from "@/components/analytics/paywall-view";
import { pinRasterPath, rise } from "@/lib/motion";
import { PlatinumTiers } from "./platinum-tiers";
import { PlatinumWordmark } from "./platinum-wordmark";

/** One entry in the "What Platinum includes" list. */
const INCLUSIONS: { title: string; body: string }[] = [
  {
    title: "Fast is unmetered.",
    body: "Every message on Fast is free of your allowance. Heavy and Auto draw on your balance as usual.",
  },
  {
    title: "A far larger allowance.",
    body: "Five times Mega on Platinum, ten on Platinum Max.",
  },
  {
    title: "Preferential catalog rates.",
    body: "Specialist models bill lower on Platinum than on any other plan.",
  },
];

const INVITATION_NOTE = {
  title: "By invitation.",
  body: "We're keeping Platinum small while capacity settles. Nothing is charged until you use your link.",
};

export function PlatinumPage() {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const availability = useQuery(api.platinum.availability);

  /* Same exit as the pricing page: play the fade, then route. Modified
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

  const closed = availability?.open === false;
  const inclusions = closed ? [...INCLUSIONS, INVITATION_NOTE] : INCLUSIONS;

  return (
    <motion.main
      {...(leaving
        ? {
            animate: { opacity: 0, y: -6, filter: "blur(3px)" },
            transition: { duration: 0.1, ease: [0.4, 0, 1, 1] as const },
            onAnimationComplete: () => router.push("/pricing"),
          }
        : {})}
      transformTemplate={pinRasterPath}
      /* `dark` forces the subtree's theme, `platinum-page` deepens the
         palette, `platinum-ground` paints the lit backdrop. */
      className="platinum-page platinum-ground dark min-h-dvh px-5 py-6 text-foreground sm:px-8 sm:py-8"
    >
      <PaywallView source="platinum_page" />
      <div className="mx-auto max-w-4xl">
        <motion.div {...rise(0)}>
          <Link
            href="/pricing"
            onClick={leave}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <IconArrowLeft size={14} stroke={2.2} />
            Back to pricing
          </Link>
        </motion.div>

        <motion.header
          {...rise(0.05)}
          className="mt-16 flex flex-col items-center text-center sm:mt-24"
        >
          <PlatinumWordmark height={40} />
          <h1 className="mt-8 max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-[40px]/[1.1]">
            The highest tier of Whirl.
          </h1>
          <p className="mt-5 max-w-lg text-[14.5px]/7 text-balance text-muted-foreground">
            A far larger allowance, the Fast model unmetered, and preferential
            rates across the catalog.
          </p>
          {closed && (
            <p className="mt-6 text-[12.5px] text-muted-foreground">
              Membership is limited.
            </p>
          )}
        </motion.header>

        <motion.hr {...rise(0.08)} className="platinum-rule mt-16" />

        <motion.div {...rise(0.1)} className="mt-12">
          <PlatinumTiers />
        </motion.div>

        <motion.section {...rise(0.14)} className="mt-20">
          <h2 className="text-center text-[13px] font-medium tracking-wide text-muted-foreground">
            What Platinum includes
          </h2>
          <div className="mt-8 grid gap-x-12 gap-y-9 sm:grid-cols-2">
            {inclusions.map(({ title, body }) => (
              <div key={title}>
                <h3 className="text-[14.5px] font-semibold tracking-tight">
                  {title}
                </h3>
                <p className="mt-2 text-[13.5px]/6 text-muted-foreground">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </motion.section>

        <motion.hr {...rise(0.16)} className="platinum-rule mt-20" />

        <motion.p
          {...rise(0.18)}
          className="mt-8 pb-8 text-center text-[12px]/5 text-muted-foreground"
        >
          USD. Includes everything in Mega. Cancel any time.
        </motion.p>
      </div>
    </motion.main>
  );
}
