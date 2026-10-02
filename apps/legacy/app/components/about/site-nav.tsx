import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import {
  IconChevronDown,
  IconMessageCircleFilled,
} from "@tabler/icons-react";

import { AboutLogo } from "~/components/about/about-logo";
import { AboutThemeSwitcher } from "~/components/about/theme-switcher";
import {
  HoverPillOverlay,
  useHoverPill,
  type HoverPill,
} from "~/components/hover-pill";
import { ANALYTICS_EVENTS, useCapture } from "~/lib/posthog";

/**
 * Nav entries per the wireframe. Only Home and Pricing have pages today —
 * the rest render as quiet placeholders until their pages exist.
 */
const NAV_ITEMS = [
  { label: "Home", to: "/about", exact: true },
  { label: "Features", to: "/about/features" },
  { label: "Developers", to: "/about/developers" },
  { label: "Pricing", to: "/about/pricing" },
] as const;

const ABOUT_ITEM = { label: "About", to: "/about/about" } as const;

const RESOURCES = [
  { label: "Status", href: "https://status.whirl.chat" },
  { label: "Discord", href: "https://discord.gg/SrgwbaGHqE" },
  { label: "Privacy", href: "https://anterra.sh/legal/whirl/privacy" },
  { label: "Terms", href: "https://anterra.sh/legal/whirl/terms" },
] as const;

// Every nav row shares the same fixed height so the column rhythm stays even.
// Hover feedback is the nav's shared pill (see HoverPillOverlay) that fades
// in and hops between rows; on press only the pill squishes, never the text.
const navRowClass = "relative flex h-8 w-fit items-center px-2.5";

const linkTextClass =
  "text-[14px] font-medium text-neutral-500 transition-colors duration-150 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100";

const linkActiveClass = "text-neutral-900 dark:text-neutral-50";

function NavItem({
  label,
  to,
  exact = false,
  pill,
}: {
  label: string;
  to?: string;
  exact?: boolean;
  pill: HoverPill;
}) {
  const capture = useCapture();
  if (!to) {
    return (
      <span
        title="Coming soon"
        className={`${navRowClass} cursor-default text-[14px] font-medium text-neutral-400 dark:text-neutral-600`}
      >
        {label}
      </span>
    );
  }
  return (
    <Link
      to={to}
      activeOptions={{ exact }}
      activeProps={{ className: linkActiveClass }}
      onMouseEnter={(e) => pill.onHover(label, e.currentTarget)}
      onMouseLeave={() => pill.onLeave(label)}
      onClick={() => capture(ANALYTICS_EVENTS.aboutNavClicked, { label, to })}
      className={`${navRowClass} ${linkTextClass}`}
    >
      {label}
    </Link>
  );
}

function ResourcesDisclosure({ pill }: { pill: HoverPill }) {
  const capture = useCapture();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onMouseEnter={(e) => pill.onHover("Resources", e.currentTarget)}
        onMouseLeave={() => pill.onLeave("Resources")}
        onClick={() => setOpen((v) => !v)}
        className={`${navRowClass} ${linkTextClass}`}
      >
        <span className="flex items-center gap-1">
          Resources
          <IconChevronDown
            size={13}
            stroke={2.5}
            className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {/* grid-rows collapse (same trick as the app sidebar) so the list glides
          open instead of popping. */}
      <motion.div
        initial={false}
        animate={{
          gridTemplateRows: open ? "1fr" : "0fr",
          opacity: open ? 1 : 0,
        }}
        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
        className="grid"
        aria-hidden={!open}
        style={{ pointerEvents: open ? undefined : "none" }}
      >
        <div className="flex min-h-0 flex-col overflow-hidden pl-3">
          {RESOURCES.map((item) => (
            <a
              key={item.label}
              href={item.href}
              target="_blank"
              rel="noreferrer"
              tabIndex={open ? undefined : -1}
              onMouseEnter={(e) => pill.onHover(item.label, e.currentTarget)}
              onMouseLeave={() => pill.onLeave(item.label)}
              onClick={() =>
                capture(ANALYTICS_EVENTS.aboutResourceClicked, {
                  label: item.label,
                })
              }
              className={`${navRowClass} ${linkTextClass}`}
            >
              {item.label}
            </a>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

export function ChatPill({ className = "" }: { className?: string }) {
  const capture = useCapture();
  return (
    <Link
      to="/"
      onClick={() => capture(ANALYTICS_EVENTS.aboutChatCtaClicked)}
      className={`inline-flex h-9 w-fit items-center gap-1.5 rounded-full bg-[#0C82F2] px-4 text-[13px] font-medium text-white transition-[background-color,scale] duration-200 ease-out hover:bg-[#0b76dc] active:scale-[0.96] ${className}`}
    >
      <IconMessageCircleFilled size={14} />
      Chat
    </Link>
  );
}

/** The desktop rail from the wireframe: logo, links, Chat, theme at the foot. */
export function AboutSidebarNav() {
  const pill = useHoverPill();
  return (
    <nav
      aria-label="About site"
      className="sticky top-10 hidden h-[calc(100dvh-5rem)] w-40 shrink-0 flex-col self-start md:flex"
    >
      <HoverPillOverlay pill={pill} />
      <Link to="/about" aria-label="Whirl — about home" className="w-fit">
        <AboutLogo size={36} />
      </Link>
      {/* -ml-2.5 cancels the rows' pill padding so labels align with the logo. */}
      <div className="-ml-2.5 mt-7 flex flex-col">
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.label} {...item} pill={pill} />
        ))}
        <ResourcesDisclosure pill={pill} />
        <NavItem {...ABOUT_ITEM} pill={pill} />
      </div>
      <ChatPill className="mt-5" />
      <AboutThemeSwitcher className="mb-1 mt-auto" />
    </nav>
  );
}

/** Small screens: logo + Chat up top, wrapping links beneath, theme at the end. */
export function AboutMobileNav() {
  const pill = useHoverPill();
  return (
    <nav
      aria-label="About site"
      className="relative flex flex-col gap-4 md:hidden"
    >
      <HoverPillOverlay pill={pill} />
      <div className="flex items-center justify-between">
        <Link to="/about" aria-label="Whirl — about home" className="w-fit">
          <AboutLogo size={32} />
        </Link>
        <ChatPill />
      </div>
      <div className="-mx-2.5 flex flex-wrap items-center gap-x-2">
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.label} {...item} pill={pill} />
        ))}
        <NavItem {...ABOUT_ITEM} pill={pill} />
        {RESOURCES.map((item) => (
          <a
            key={item.label}
            href={item.href}
            target="_blank"
            rel="noreferrer"
            onMouseEnter={(e) => pill.onHover(item.label, e.currentTarget)}
            onMouseLeave={() => pill.onLeave(item.label)}
            className={`${navRowClass} ${linkTextClass}`}
          >
            {item.label}
          </a>
        ))}
        <AboutThemeSwitcher />
      </div>
    </nav>
  );
}
