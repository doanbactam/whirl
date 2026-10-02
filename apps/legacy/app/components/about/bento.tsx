import type { ComponentType, ReactNode } from "react";

/**
 * Bento block for the marketing pages: unevenly-sized feature cells fused
 * into a single slab. The grid's tinted background bleeds through 1px gaps
 * to draw the hairline dividers, so the whole thing reads as one block.
 */

type IconType = ComponentType<{ size?: number; className?: string }>;

export function BentoGrid({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`grid grid-cols-2 gap-px overflow-hidden rounded-3xl bg-black/[0.07] ring-1 ring-black/[0.07] sm:grid-cols-4 dark:bg-white/[0.08] dark:ring-white/[0.08] ${className}`}
    >
      {children}
    </div>
  );
}

export function BentoCell({
  icon: Icon,
  title,
  body,
  className = "",
}: {
  icon: IconType;
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-2 bg-white p-5 sm:p-6 dark:bg-[#161615] ${className}`}
    >
      <Icon size={18} className="text-[#0C82F2]" />
      <h3 className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-50">
        {title}
      </h3>
      <p className="max-w-md text-[13.5px] leading-relaxed text-neutral-600 dark:text-neutral-400">
        {body}
      </p>
    </div>
  );
}
