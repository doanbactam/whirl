import { createFileRoute, Outlet } from "@tanstack/react-router";

import { AboutShell } from "~/components/about/site-shell";

/**
 * Layout for the /about marketing mini-site. Every page under here renders in
 * the AboutShell (rail nav + editorial column) instead of the chat shell —
 * ShellRouter in __root.tsx short-circuits for /about paths so these pages
 * arrive fully server-rendered, with no Clerk loading gate in front of them.
 */
export const Route = createFileRoute("/about")({
  component: AboutLayout,
});

function AboutLayout() {
  return (
    <AboutShell>
      <Outlet />
    </AboutShell>
  );
}
