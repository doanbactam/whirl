"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconMessageCircleFilled } from "@tabler/icons-react";

import { SITE_LINKS } from "@/lib/site";
import { MarketingGithubButton } from "./github-link";
import { MarketingLogo } from "./marketing-logo";
import { MarketingThemeSwitcher } from "./theme-switcher";

const NAV = [
  { label: "Home", href: "/about" },
  { label: "Features", href: "/about/features" },
  { label: "Developers", href: "/about/developers" },
  { label: "Pricing", href: "/about/pricing" },
] as const;

/* Outbound links from lib/site.ts. The optional ones drop out when a
   deployment sets them to null. The source code isn't one of them: it
   gets a row of its own in the main run. */
const RESOURCES = [
  { label: "Status", href: SITE_LINKS.status },
  { label: "Discord", href: SITE_LINKS.discord },
  { label: "Privacy", href: SITE_LINKS.privacy },
  { label: "Terms", href: SITE_LINKS.terms },
].filter((item): item is { label: string; href: string } => !!item.href);

/* Pages of ours that live under Resources rather than in the main run:
   the seasonal ones, which shouldn't sit next to Pricing. Kirkify only
   exists where it's configured (KIRKIFY_SECRET), so the shell says whether
   to list it. */
const ARCADE = { label: "Token Arcade", href: "/about/slots" };
const KIRKIFY = { label: "Kirkify", href: "/kirkify" };

function extrasFor(kirkify: boolean) {
  return kirkify ? [ARCADE, KIRKIFY] : [ARCADE];
}

const row =
  "flex h-8 w-fit items-center rounded-full px-2.5 text-sm font-medium text-neutral-500 transition-colors hover:bg-black/5 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-white/7 dark:hover:text-white";

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active =
    href === "/about" ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`${row} ${active ? "bg-black/5 text-neutral-950 dark:bg-white/7 dark:text-white" : ""}`}
    >
      {children}
    </Link>
  );
}

function ChatLink({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`inline-flex h-9 w-fit items-center gap-1.5 rounded-full bg-[#0c82f2] px-4 text-[13px] font-medium text-white transition hover:bg-[#0b76dc] active:scale-[0.97] ${className}`}
    >
      <IconMessageCircleFilled size={14} />
      Chat
    </Link>
  );
}

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={row}>
      {children}
    </a>
  );
}

function ResourceLinks() {
  return RESOURCES.map((item) => (
    <ExternalLink key={item.href} href={item.href}>
      {item.label}
    </ExternalLink>
  ));
}

export function MarketingSidebarNav({ kirkify }: { kirkify: boolean }) {
  const extras = extrasFor(kirkify);
  const pathname = usePathname();
  /* An extra's own page opens the group it lives in, so the active row is
     never hidden behind a closed disclosure. */
  const onExtra = extras.some((item) => pathname.startsWith(item.href));

  return (
    <nav
      aria-label="About Whirl"
      className="sticky top-10 hidden h-[calc(100dvh-5rem)] w-40 shrink-0 flex-col self-start md:flex"
    >
      <Link href="/about" aria-label="Whirl home" className="w-fit">
        <MarketingLogo />
      </Link>
      <div className="-ml-2.5 mt-7 flex flex-col gap-1">
        {NAV.map((item) => (
          <NavLink key={item.href} href={item.href}>
            {item.label}
          </NavLink>
        ))}
        <details className="group" open={onExtra || undefined}>
          <summary className={`${row} cursor-pointer list-none`}>
            Resources
          </summary>
          <div className="ml-3 flex flex-col gap-1">
            <ResourceLinks />
            {extras.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </div>
        </details>
        <NavLink href="/about/about">About</NavLink>
        <ExternalLink href={SITE_LINKS.repo}>GitHub</ExternalLink>
      </div>
      <ChatLink className="mt-5" />
      <div className="mt-auto mb-1 flex items-center gap-2">
        <MarketingThemeSwitcher />
        <MarketingGithubButton />
      </div>
    </nav>
  );
}

export function MarketingMobileNav({ kirkify }: { kirkify: boolean }) {
  const extras = extrasFor(kirkify);
  return (
    <nav aria-label="About Whirl" className="flex flex-col gap-4 md:hidden">
      <div className="flex items-center justify-between">
        <Link href="/about" aria-label="Whirl home">
          <MarketingLogo size={32} />
        </Link>
        <ChatLink />
      </div>
      <div className="-mx-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {NAV.map((item) => (
          <NavLink key={item.href} href={item.href}>
            {item.label}
          </NavLink>
        ))}
        <NavLink href="/about/about">About</NavLink>
        <ExternalLink href={SITE_LINKS.repo}>GitHub</ExternalLink>
        <ResourceLinks />
        {extras.map((item) => (
          <NavLink key={item.href} href={item.href}>
            {item.label}
          </NavLink>
        ))}
        <MarketingThemeSwitcher className="ml-2" />
      </div>
    </nav>
  );
}
