import type { ReactNode } from "react";
import { Squircle } from "~/components/squircle";

/**
 * Shared dropdown shell + item classes. Shells carry an inset `p-1` gutter and
 * items round their own corners, so each hover/active background reads as a
 * floating pill with a little breathing room from the panel edge — the classic
 * inset menu look.
 */
const dropdownShellBase =
  "cursor-default select-none rounded-xl border border-black/[0.06] bg-white p-1 dark:border-white/[0.06] dark:bg-[#1E1E1E]";

const dropdownShellSubtleBase =
  "cursor-default select-none rounded-xl border border-black/[0.08] bg-white p-1 dark:border-white/[0.08] dark:bg-[#222]";

export const dropdownShellClass = `overflow-hidden ${dropdownShellBase} shadow-[0_10px_30px_rgba(0,0,0,0.1),_0_2px_6px_rgba(0,0,0,0.06)] dark:shadow-[0_10px_30px_rgba(0,0,0,0.5),_0_2px_6px_rgba(0,0,0,0.3)]`;

/** Shell variant for menus that fly out a nested panel (model hover card, theme picker). */
export const dropdownShellOpenClass = `${dropdownShellBase} shadow-[0_10px_30px_rgba(0,0,0,0.1),_0_2px_6px_rgba(0,0,0,0.06)] dark:shadow-[0_10px_30px_rgba(0,0,0,0.5),_0_2px_6px_rgba(0,0,0,0.3)]`;

export const dropdownShellSubtleClass = `overflow-hidden ${dropdownShellSubtleBase} shadow-[0_8px_24px_rgba(0,0,0,0.08),_0_2px_4px_rgba(0,0,0,0.04)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.4),_0_2px_4px_rgba(0,0,0,0.3)]`;

/** Shell variant for menus that fly out a nested panel (e.g. theme picker). */
export const dropdownShellSubtleOpenClass = `${dropdownShellSubtleBase} shadow-[0_8px_24px_rgba(0,0,0,0.08),_0_2px_4px_rgba(0,0,0,0.04)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.4),_0_2px_4px_rgba(0,0,0,0.3)]`;

/**
 * Lisse-smoothed dropdown panel. Nest this inside the positioned/animated
 * element (the motion.div doing the pop) and keep layout classes out there —
 * the shell only paints the surface. The `rounded-xl` in the shell classes
 * stays as the pre-hydration fallback; Lisse's clip-path takes over on mount.
 *
 * Menus that hang nested flyouts outside their bounds should keep using the
 * plain `dropdownShell*OpenClass` strings — a clip-path would eat the flyout.
 */
export function DropdownShell({
  subtle = false,
  className,
  children,
}: {
  subtle?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const shell = subtle ? dropdownShellSubtleClass : dropdownShellClass;
  return (
    <Squircle radius={12} className={className ? `${shell} ${className}` : shell}>
      {children}
    </Squircle>
  );
}

export const dropdownItemClass =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-neutral-800 transition-colors hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:text-neutral-100 dark:hover:bg-white/[0.05] dark:disabled:hover:bg-transparent";

export const dropdownItemCompactClass =
  "flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] text-neutral-700 transition-colors hover:bg-black/[0.05] dark:text-neutral-200 dark:hover:bg-white/[0.06]";

export const dropdownDividerClass =
  "my-1 h-px bg-black/[0.06] dark:bg-white/[0.06]";
