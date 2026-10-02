import type { Metadata } from "next";
import {
  IconBulbFilled,
  IconFileTextFilled,
  IconPhotoFilled,
  IconSparklesFilled,
  IconStackFilled,
  IconWorldSearch,
} from "@tabler/icons-react";

import { BentoCell, BentoGrid } from "@/components/marketing/bento";
import {
  ArtifactVisual,
  IntegrationsVisual,
  MemoryVisual,
  SkillsVisual,
} from "@/components/marketing/feature-visuals";
import {
  Lede,
  PageTitle,
  SplitSection,
} from "@/components/marketing/page-blocks";
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Features · Whirl",
  description:
    "Integrations, skills, real memory, every top model, and living artifacts.",
  path: "/about/features",
});

export default function FeaturesPage() {
  return (
    <article>
      <PageTitle>Features</PageTitle>
      <Lede>
        Everything Whirl can do, and everything it plugs into. The short
        version: it remembers, reaches into your tools, and learns new tricks.
      </Lede>
      <SplitSection
        title="Plugs into your world"
        body="Connect Gmail, Google Calendar, Notion, and hundreds more through a community-built catalog. Whirl reads what you point it at and acts on your behalf."
        visual={<IntegrationsVisual />}
      />
      <SplitSection
        reverse
        title="Skills give it new abilities"
        body="Skills are add-on playbooks that teach Whirl entirely new moves, from deep research runs to a morning briefing built just for you."
        visual={<SkillsVisual />}
      />
      <BentoGrid>
        <BentoCell
          icon={IconSparklesFilled}
          title="Remembers you"
          body="Real memory that carries across conversations, projects, preferences, and quirks."
          className="col-span-2 sm:row-span-2 sm:justify-center"
        />
        <BentoCell
          icon={IconStackFilled}
          title="Every top model"
          body="One conversation, the best models behind it."
          className="col-span-2"
        />
        <BentoCell
          icon={IconFileTextFilled}
          title="Living artifacts"
          body="Documents and visualizations that stay editable."
        />
        <BentoCell
          icon={IconWorldSearch}
          title="Live web search"
          body="Answers grounded in today's internet."
        />
        <BentoCell
          icon={IconBulbFilled}
          title="Thinking mode"
          body="Extra reasoning for genuinely hard problems."
          className="sm:col-span-2"
        />
        <BentoCell
          icon={IconPhotoFilled}
          title="Image generation"
          body="Ask for a picture and get one in the conversation."
          className="sm:col-span-2"
        />
      </BentoGrid>
      <SplitSection
        title="Starts where you left off"
        body="Mention a project, goal, or preference once and it stays known, so next week's conversation picks up mid-thought instead of from zero."
        visual={<MemoryVisual />}
      />
      <SplitSection
        reverse
        title="Replies you can keep"
        body="Answers can land as living documents and visualizations. Edit them, extend them, and come back tomorrow."
        visual={<ArtifactVisual />}
      />
    </article>
  );
}
