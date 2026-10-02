import { NavLink, Outlet } from "react-router";
import { useQuery } from "convex/react";
import {
  IconAppsFilled,
  IconAdjustmentsFilled,
  IconBook,
  IconDiamondFilled,
  IconExternalLink,
  IconPuzzleFilled,
  IconRosetteDiscountCheckFilled,
  IconSchoolFilled,
  IconSparklesFilled,
} from "@tabler/icons-react";

import { ThemeToggle } from "~/components/theme-toggle";
import { UserMenu } from "~/components/user-menu";
import { WhirlMark } from "~/components/whirl-mark";
import { api } from "~/lib/backend";
import { useIsAdmin } from "~/lib/use-admin";

/* The web app this console administers. Set VITE_APP_URL for your own
   deployment; local dev talks to the app on port 3000. */
const APP_URL =
  (import.meta.env.VITE_APP_URL as string | undefined) ?? "http://localhost:3000";

/**
 * The console frame: top bar with branding + account controls, a left nav
 * rail, and the routed page in a panel — same bones as the main app's shell,
 * dressed for work.
 */
export function ConsoleShell() {
  const isAdmin = useIsAdmin();
  // Live pending count for the Approvals badge — integrations and skills
  // share the queue. Skipped entirely for non-admins — the server would
  // return [] anyway, but why even ask.
  const pendingRequests = useQuery(
    api.integrations.listPendingRequests,
    isAdmin ? {} : "skip",
  );
  const pendingSkillRequests = useQuery(
    api.skills.listPendingRequests,
    isAdmin ? {} : "skip",
  );
  const pendingCount =
    (pendingRequests?.length ?? 0) + (pendingSkillRequests?.length ?? 0);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#F3F3F3] text-[13px] text-neutral-900 dark:bg-[#141414] dark:text-neutral-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-black/[0.06] px-4 dark:border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <WhirlMark size={20} />
          <span className="text-[14px] font-semibold tracking-tight">
            Whirl
          </span>
          <span className="rounded-full border border-black/[0.1] px-2 py-0.5 text-[11px] font-medium text-neutral-500 dark:border-white/[0.14] dark:text-neutral-400">
            Console
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <a
            href={APP_URL}
            target="_blank"
            rel="noreferrer"
            className="flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-medium text-neutral-500 transition-colors hover:bg-[#E0E0E0] hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-[#1E1E1E] dark:hover:text-neutral-200"
          >
            Open Whirl
            <IconExternalLink size={13} stroke={2} />
          </a>
          <ThemeToggle />
          <div className="mx-1 h-5 w-px bg-black/[0.08] dark:bg-white/[0.1]" />
          <UserMenu />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col gap-5 overflow-y-auto p-3">
          <nav className="flex flex-col gap-0.5">
            <SectionLabel>Develop</SectionLabel>
            <NavItem to="/integrations" icon={<IconAppsFilled size={15} />}>
              My Integrations
            </NavItem>
            <NavItem to="/skills" icon={<IconSchoolFilled size={15} />}>
              My Skills
            </NavItem>
          </nav>
          {isAdmin && (
            <nav className="flex flex-col gap-0.5">
              <SectionLabel>Admin</SectionLabel>
              <NavItem
                to="/approvals"
                icon={<IconRosetteDiscountCheckFilled size={15} />}
                badge={pendingCount > 0 ? pendingCount : undefined}
              >
                Approvals
              </NavItem>
              <NavItem to="/extensions" icon={<IconPuzzleFilled size={15} />}>
                Extensions
              </NavItem>
              <NavItem to="/models" icon={<IconSparklesFilled size={15} />}>
                Models
              </NavItem>
              <NavItem to="/platinum" icon={<IconDiamondFilled size={15} />}>
                Platinum
              </NavItem>
              <NavItem to="/admin" icon={<IconAdjustmentsFilled size={15} />}>
                Usage controls
              </NavItem>
            </nav>
          )}
          <nav className="flex flex-col gap-0.5">
            <SectionLabel>Resources</SectionLabel>
            <SoonItem icon={<IconBook size={15} stroke={2} />}>
              Documentation
            </SoonItem>
          </nav>
        </aside>

        <div className="min-w-0 flex-1 py-2 pr-2">
          <main className="h-full overflow-y-auto rounded-[20px] bg-[#ECECEC] shadow-[inset_0_1px_3px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.06] dark:bg-[#151514] dark:shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)] dark:ring-white/[0.06]">
            <div className="mx-auto max-w-4xl px-8 py-10">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-3 pb-1 text-[11.5px] font-medium text-neutral-400 dark:text-neutral-500">
      {children}
    </span>
  );
}

function NavItem({
  to,
  icon,
  badge,
  children,
}: {
  to: string;
  icon: React.ReactNode;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex h-9 items-center gap-2.5 rounded-xl px-3 text-[13px] font-medium transition-colors ${
          isActive
            ? "bg-[#E0E0E0] text-neutral-900 dark:bg-[#1E1E1E] dark:text-neutral-100"
            : "text-neutral-600 hover:bg-[#E8E8E8] hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-[#1A1A1A] dark:hover:text-neutral-100"
        }`
      }
    >
      <span className="text-neutral-500 dark:text-neutral-400">{icon}</span>
      {children}
      {badge !== undefined && (
        <span className="ml-auto rounded-full bg-blue-600 px-1.5 py-px text-[10.5px] font-semibold text-white tabular-nums">
          {badge}
        </span>
      )}
    </NavLink>
  );
}

/** A nav entry for surfaces that don't exist yet — visible, honest, disabled. */
function SoonItem({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span
      aria-disabled
      className="flex h-9 cursor-default items-center gap-2.5 rounded-xl px-3 text-[13px] font-medium text-neutral-400 dark:text-neutral-600"
    >
      <span>{icon}</span>
      {children}
      <span className="ml-auto rounded-full bg-black/[0.05] px-1.5 py-px text-[10px] font-semibold tracking-wide text-neutral-400 dark:bg-white/[0.07] dark:text-neutral-500">
        Soon
      </span>
    </span>
  );
}
