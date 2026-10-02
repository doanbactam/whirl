import type { Metadata } from "next";

import { CtaLink, Lede, PageTitle } from "@/components/marketing/page-blocks";
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata({
  title: "About · Whirl",
  description:
    "Whirl is built by salt, an indie developer, under Anterra. One goal: the best possible AI chat experience.",
  path: "/about/about",
});

const prose =
  "text-[15px] leading-relaxed text-neutral-600 dark:text-neutral-400";

export default function AboutPage() {
  return (
    <article className="max-w-xl">
      <PageTitle>About</PageTitle>
      <Lede>
        Whirl is a small product with one big ambition: the best possible AI
        chat experience.
      </Lede>
      <div className="mt-8 flex flex-col gap-5">
        <p className={prose}>
          It&apos;s built by salt, an indie developer. No growth team, no
          committees, just someone who cares a lot about how chatting with AI
          should feel and sweats the details accordingly.
        </p>
        <p className={prose}>
          Whirl is made by{" "}
          <a
            href="https://anterra.sh"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-[#0c82f2] hover:underline"
          >
            Anterra
          </a>
          , the home for everything around it.
        </p>
        <p className={prose}>
          Everything here, from the memory to the living artifacts, exists in
          service of that one goal. If something feels off, tell us and it gets
          fixed.
        </p>
      </div>
      <div className="mt-10">
        <CtaLink href="/" primary>
          Try Whirl
        </CtaLink>
      </div>
    </article>
  );
}
