import { createFileRoute } from "@tanstack/react-router";

import {
  ConsoleVisual,
  McpVisual,
} from "~/components/about/developer-visuals";
import {
  CtaLink,
  Lede,
  PageTitle,
  SplitSection,
} from "~/components/about/page-blocks";
import { seo } from "~/lib/seo";

const CONSOLE_URL = "https://console.whirl.chat";

export const Route = createFileRoute("/about/developers")({
  component: AboutDevelopers,
  head: () =>
    seo({
      title: "Developers · Whirl",
      description:
        "Bring your app to Whirl. Register an MCP server in the Whirl Console and every Whirl user can connect your product from the integration store.",
      url: "/about/developers",
    }),
});

function AboutDevelopers() {
  return (
    <article>
      <PageTitle>Developers</PageTitle>
      <Lede className="mt-5">
        Whirl is a surface for your software too. If your product speaks MCP,
        it can sit inside every Whirl conversation.
      </Lede>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <CtaLink href={CONSOLE_URL} primary cta="developers_open_console">
          Open the Console
        </CtaLink>
        <CtaLink to="/about/features" cta="developers_see_features">
          See what Whirl does
        </CtaLink>
      </div>
      <SplitSection
        className="mt-16"
        title="Integrate your app over MCP"
        body="Expose your product as tools on a Model Context Protocol server and Whirl can call them mid-conversation. Point the console at your server's URL, it scans the tools you offer, and once approved your integration appears in the store for any user to connect."
        visual={<McpVisual />}
      />
      <SplitSection
        className="mt-16"
        reverse
        title="Ship it from the Whirl Console"
        body="The console is the developer home: register integrations, publish skills, write the tool descriptions users see, and track each submission through review. When it goes live, it is one tap away for every Whirl user."
        visual={<ConsoleVisual />}
      />
      <p className="mt-16 text-[15px] leading-relaxed text-neutral-600 dark:text-neutral-400">
        Ready when you are:{" "}
        <a
          href={CONSOLE_URL}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-[#0C82F2] hover:underline"
        >
          console.whirl.chat
        </a>
      </p>
    </article>
  );
}
