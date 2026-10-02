import { createFileRoute } from "@tanstack/react-router";

import { CtaLink, Lede, PageTitle } from "~/components/about/page-blocks";
import { seo } from "~/lib/seo";

export const Route = createFileRoute("/about/about")({
  component: AboutAbout,
  head: () =>
    seo({
      title: "About · Whirl",
      description:
        "Whirl is built by salt, an indie developer, under Anterra. One goal: the best possible AI chat experience.",
      url: "/about/about",
    }),
});

const PROSE_CLASS =
  "text-[15px] leading-relaxed text-neutral-600 dark:text-neutral-400";

function AboutAbout() {
  return (
    <article className="max-w-xl">
      <PageTitle>About</PageTitle>
      <Lede className="mt-5">
        Whirl is a small product with one big ambition: the best possible AI
        chat experience.
      </Lede>
      <div className="mt-8 flex flex-col gap-5">
        <p className={PROSE_CLASS}>
          It's built by salt, an indie developer. No growth team, no
          committees, just someone who cares a lot about how chatting with AI
          should feel and sweats the details accordingly.
        </p>
        <p className={PROSE_CLASS}>
          Whirl is made by{" "}
          <a
            href="https://anterra.sh"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-[#0C82F2] hover:underline"
          >
            Anterra
          </a>
          , the home for everything around it.
        </p>
        <p className={PROSE_CLASS}>
          Everything here, from the memory to the living artifacts, exists in
          service of that one goal. If something feels off, it's a bug. Tell
          us and it gets fixed.
        </p>
      </div>
      <div className="mt-10">
        <CtaLink to="/" primary cta="about_start_chatting">
          Try Whirl
        </CtaLink>
      </div>
    </article>
  );
}
