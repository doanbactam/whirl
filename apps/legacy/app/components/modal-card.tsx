import type { ReactNode } from "react";
import { Squircle } from "~/components/squircle";

/**
 * The app's standard dialog card chrome — white/#1E1E1E surface, hairline
 * border, floaty shadow — rendered with Lisse-smoothed corners.
 *
 * Nest this inside the animated/positioned element (the motion.div doing the
 * entrance) and keep width constraints out there; height caps go on
 * `className` here so they constrain the clipped flex column directly. The
 * `rounded-[20px]` stays as the pre-hydration fallback until the clip-path
 * takes over.
 */
export function ModalCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const chrome =
    "flex flex-col overflow-hidden rounded-[20px] border border-black/[0.06] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.18),_0_4px_12px_rgba(0,0,0,0.08)] dark:border-white/[0.06] dark:bg-[#1E1E1E] dark:shadow-[0_20px_60px_rgba(0,0,0,0.6),_0_4px_12px_rgba(0,0,0,0.4)]";
  return (
    <Squircle radius={20} className={className ? `${chrome} ${className}` : chrome}>
      {children}
    </Squircle>
  );
}
