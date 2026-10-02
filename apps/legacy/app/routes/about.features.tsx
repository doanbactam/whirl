import { createFileRoute } from "@tanstack/react-router";
import {
  IconBulbFilled,
  IconFileTextFilled,
  IconPhotoFilled,
  IconSparklesFilled,
  IconStackFilled,
  IconWorldSearch,
} from "@tabler/icons-react";

import { BentoCell, BentoGrid } from "~/components/about/bento";
import {
  ArtifactVisual,
  IntegrationsVisual,
  MemoryVisual,
  SkillsVisual,
} from "~/components/about/feature-visuals";
import {
  Lede,
  PageTitle,
  SplitSection,
} from "~/components/about/page-blocks";
import { seo } from "~/lib/seo";

export const Route = createFileRoute("/about/features")({
  component: AboutFeatures,
  head: () =>
    seo({
      title: "Features · Whirl",
      description:
        "Integrations with Gmail, Google Calendar, Notion and hundreds more, skills that teach Whirl new abilities, real memory, every top model, and living artifacts.",
      url: "/about/features",
    }),
});

function AboutFeatures() {
  return (
    <article>
      <PageTitle>Features</PageTitle>
      <Lede className="mt-5">
        Everything Whirl can do, and everything it plugs into. The short
        version: it remembers, it reaches into your tools, and it learns new
        tricks.
      </Lede>
      <SplitSection
        className="mt-16"
        title="Plugs into your world"
        body="Connect Gmail, Google Calendar, Notion, and hundreds more through a community-built catalog. Whirl reads what you point it at and acts on your behalf, so triaging an inbox or scheduling around your week happens in the chat."
        visual={<IntegrationsVisual />}
      />
      <SplitSection
        className="mt-16"
        reverse
        title="Skills give it new abilities"
        body="Skills are add-on playbooks that teach Whirl entirely new moves. Install one and it picks up an ability it didn't ship with, from deep research runs to a morning briefing built just for you."
        visual={<SkillsVisual />}
      />
      <BentoGrid className="mt-16">
        <BentoCell
          icon={IconSparklesFilled}
          title="Remembers you"
          body="Real memory that carries across conversations. Tell it once, and every future chat already knows your projects, your preferences, and your quirks."
          className="col-span-2 sm:row-span-2 sm:justify-center"
        />
        <BentoCell
          icon={IconStackFilled}
          title="Every top model"
          body="One conversation, the best models behind it. Pick the brain that fits the job."
          className="col-span-2"
        />
        <BentoCell
          icon={IconFileTextFilled}
          title="Living artifacts"
          body="Documents and visualizations that stay editable after the reply lands."
        />
        <BentoCell
          icon={IconWorldSearch}
          title="Live web search"
          body="Answers grounded in today's internet, not last year's."
        />
        <BentoCell
          icon={IconBulbFilled}
          title="Thinking mode"
          body="Extra reasoning for the genuinely hard problems."
          className="sm:col-span-2"
        />
        <BentoCell
          icon={IconPhotoFilled}
          title="Image generation"
          body="Ask for a picture and get one right in the conversation."
          className="sm:col-span-2"
        />
      </BentoGrid>
      <SplitSection
        className="mt-16"
        title="Starts where you left off"
        body="Whirl keeps a memory of what you tell it. Mention a project, a goal, or a preference once and it stays known, so next week's conversation picks up mid-thought instead of from zero."
        visual={<MemoryVisual />}
      />
      <SplitSection
        className="mt-16"
        reverse
        title="Replies you can keep"
        body="Answers can land as living documents and visualizations instead of scrolling away. Edit them, extend them, and come back tomorrow; they stay right where you left them."
        visual={<ArtifactVisual />}
      />
    </article>
  );
}
