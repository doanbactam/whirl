import type { ReactNode } from "react";

import {
  AboutMobileNav,
  AboutSidebarNav,
} from "~/components/about/site-nav";

/**
 * The marketing mini-site's frame — deliberately not the chat shell. A quiet
 * paper-toned page with a slim rail on the left (per the wireframe) and an
 * editorial content column. Everything inside renders on the server.
 *
 * The shell owns its own scroll (h-dvh + overflow-y-auto): the global
 * `overflow-x-hidden` on <body> breaks position:sticky against the page
 * scroll, so the rail sticks to this container instead.
 */
export function AboutShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-dvh overflow-y-auto bg-[#FAFAF8] text-neutral-900 antialiased dark:bg-[#111110] dark:text-neutral-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-6 md:flex-row md:gap-14 md:px-8 md:py-10">
        <AboutSidebarNav />
        <AboutMobileNav />
        <main className="min-w-0 flex-1 pb-20">{children}</main>
      </div>
    </div>
  );
}
