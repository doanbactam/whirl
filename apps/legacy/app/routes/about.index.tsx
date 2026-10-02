import { createFileRoute } from "@tanstack/react-router";

import { HeroComposer } from "~/components/about/hero-composer";
import { PageTitle } from "~/components/about/page-blocks";
import { PlasmaWave } from "~/components/about/plasma-wave";
import { seo } from "~/lib/seo";

export const Route = createFileRoute("/about/")({
  component: AboutHome,
  head: () =>
    seo({
      title: "Whirl · Meet the AI chat app that actually cares",
      description:
        "Whirl is an AI chat app with real memory. Chat across the best models, create living documents and visualizations, and pick up right where you left off.",
      url: "/about",
    }),
});

function AboutHome() {
  return (
    <article>
      <PageTitle size="md">A thinking partner, not a replacement.</PageTitle>
      <div className="relative mt-8 aspect-[5/2] overflow-hidden rounded-3xl bg-neutral-950 ring-1 ring-black/[0.07] sm:aspect-[4/1] dark:ring-white/[0.08]">
        <PlasmaWave />
        <img
          src="/whirl.svg"
          alt="Whirl"
          width={96}
          height={96}
          style={{ filter: "invert(1)", mixBlendMode: "difference" }}
          className="pointer-events-none absolute left-1/2 top-1/2 w-16 -translate-x-1/2 -translate-y-1/2 select-none sm:w-24"
        />
      </div>
      <div className="mx-auto mt-16 max-w-2xl">
        <HeroComposer />
      </div>
    </article>
  );
}
