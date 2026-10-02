import type { ReactNode } from "react";

import { kirkifyEnabled } from "@/lib/kirkify/enabled";
import { MarketingMobileNav, MarketingSidebarNav } from "./marketing-nav";

export function MarketingShell({ children }: { children: ReactNode }) {
  const kirkify = kirkifyEnabled();

  return (
    <div className="h-dvh overflow-y-auto bg-[#fafaf8] text-neutral-900 antialiased [scrollbar-gutter:stable] dark:bg-[#111110] dark:text-neutral-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-6 md:flex-row md:gap-14 md:px-8 md:py-10">
        <MarketingSidebarNav kirkify={kirkify} />
        <MarketingMobileNav kirkify={kirkify} />
        <main className="min-w-0 flex-1 pb-20">{children}</main>
      </div>
    </div>
  );
}
