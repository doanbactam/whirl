import type { Metadata } from "next";

import {
  ConsoleVisual,
  McpVisual,
} from "@/components/marketing/developer-visuals";
import {
  CtaLink,
  Lede,
  PageTitle,
  SplitSection,
} from "@/components/marketing/page-blocks";
import { publicPageMetadata } from "@/lib/seo";
import { displayHost, SITE_LINKS } from "@/lib/site";

const CONSOLE_URL = SITE_LINKS.console;

export const metadata: Metadata = publicPageMetadata({
  title: "Developers · Whirl",
  description:
    "Bring your app to Whirl over MCP and make it available in every conversation.",
  path: "/about/developers",
});

export default function DevelopersPage() {
  return (
    <article>
      <PageTitle>Developers</PageTitle>
      <Lede>
        Whirl is a surface for your software too. If your product speaks MCP, it
        can sit inside every Whirl conversation.
      </Lede>
      <div className="mt-8 flex flex-wrap gap-3">
        <CtaLink href={CONSOLE_URL} primary>
          Open the Console
        </CtaLink>
        <CtaLink href="/about/features">See what Whirl does</CtaLink>
      </div>
      <SplitSection
        title="Integrate your app over MCP"
        body="Expose your product as tools on a Model Context Protocol server and Whirl can call them mid-conversation. Once approved, your integration appears in the store."
        visual={<McpVisual />}
      />
      <SplitSection
        reverse
        title="Ship it from the Whirl Console"
        body="Register integrations, publish skills, write the tool descriptions users see, and track each submission through review."
        visual={<ConsoleVisual />}
      />
      <p className="mt-16 text-[15px] leading-relaxed text-neutral-600 dark:text-neutral-400">
        Ready when you are:{" "}
        <a
          href={CONSOLE_URL}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-[#0c82f2] hover:underline"
        >
          {displayHost(CONSOLE_URL)}
        </a>
      </p>
    </article>
  );
}
