import type { Metadata } from "next";

import { HeroArt } from "@/components/marketing/hero-art";
import { HeroComposer } from "@/components/marketing/hero-composer";
import { PageTitle } from "@/components/marketing/page-blocks";
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Whirl · Meet the AI chat app that actually cares",
  description:
    "Chat across the best AI models, create living documents and visualizations, and pick up right where you left off.",
  path: "/about",
});

export default function AboutHome() {
  return (
    <article>
      <PageTitle quiet>A thinking partner, not a replacement.</PageTitle>
      <HeroArt />
      <div className="mx-auto mt-16 max-w-2xl">
        <HeroComposer />
      </div>
    </article>
  );
}
