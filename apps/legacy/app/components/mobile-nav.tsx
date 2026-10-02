import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import {
  IconMenu2,
  IconMessageCircle,
  IconPlus,
  IconSettings,
} from "@tabler/icons-react";
import type { TablerIcon } from "@tabler/icons-react";

type TabId = "chat" | "threads" | "settings";

const TABS: {
  id: TabId;
  label: string;
  to: string;
  icon: TablerIcon;
  match: (pathname: string) => boolean;
}[] = [
  {
    id: "chat",
    label: "Chat",
    to: "/",
    icon: IconMessageCircle,
    match: (p) => p === "/" || p.startsWith("/thread/"),
  },
  {
    id: "threads",
    label: "Threads",
    to: "/threads",
    icon: IconMenu2,
    match: (p) => p === "/threads",
  },
  {
    id: "settings",
    label: "Settings",
    to: "/settings",
    icon: IconSettings,
    match: (p) => p === "/settings",
  },
];

const tabSpring = {
  type: "spring" as const,
  stiffness: 420,
  damping: 34,
  mass: 0.85,
};

export function MobileNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;
  const activeId = TABS.find((tab) => tab.match(pathname))?.id ?? "chat";

  return (
    <motion.nav
      layoutRoot
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-center gap-2 px-3 pb-[max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))] pt-2 md:hidden"
    >
      <div className="relative flex h-[58px] min-w-0 flex-1 items-stretch gap-1 rounded-full bg-white p-1.5 shadow-[0_4px_24px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.06] dark:bg-[#1c1c1c] dark:shadow-[0_4px_24px_rgba(0,0,0,0.35)] dark:ring-white/[0.08]">
        {TABS.map((tab) => {
          const active = tab.id === activeId;
          const Glyph = tab.icon;
          return (
            <Link
              key={tab.id}
              to={tab.to}
              aria-current={active ? "page" : undefined}
              className="relative z-10 flex h-full min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-full px-2 text-[11px] font-medium outline-none active:opacity-90"
            >
              {active && (
                <motion.span
                  layoutId="mobile-nav-tab-bg"
                  transition={tabSpring}
                  className="pointer-events-none absolute inset-0 rounded-full bg-black/[0.06] dark:bg-[#2e2e2e] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                />
              )}
              <span
                className={`relative z-10 flex flex-col items-center gap-1 transition-colors duration-200 ${
                  active
                    ? "text-neutral-900 dark:text-white"
                    : "text-neutral-500 dark:text-neutral-400"
                }`}
              >
                <Glyph size={20} stroke={active ? 2.25 : 2} />
                <span className="truncate">{tab.label}</span>
              </span>
            </Link>
          );
        })}
      </div>
      <button
        type="button"
        aria-label="New chat"
        onClick={() => void navigate({ to: "/" })}
        className="flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-full bg-[#0c82f2] text-white ring-1 ring-white/20 transition-[transform,background-color] active:scale-95 active:bg-[#0a74d8]"
      >
        <IconPlus size={24} stroke={2} />
      </button>
    </motion.nav>
  );
}
