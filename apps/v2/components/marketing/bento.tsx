import type { ReactNode } from "react";
import type { TablerIcon } from "@tabler/icons-react";

const SHAPES = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
} as const;

export function BentoGrid({
  children,
  columns = 4,
}: {
  children: ReactNode;
  columns?: keyof typeof SHAPES;
}) {
  return (
    <div
      className={`mt-16 grid ${SHAPES[columns]} gap-px overflow-hidden rounded-3xl bg-black/7 ring-1 ring-black/7 dark:bg-white/8 dark:ring-white/8`}
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
  icon: TablerIcon;
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-2 bg-white p-5 sm:p-6 dark:bg-[#161615] ${className}`}
    >
      <Icon size={18} className="text-[#0c82f2]" />
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <p className="max-w-md text-[13.5px] leading-relaxed text-neutral-600 dark:text-neutral-400">
        {body}
      </p>
    </div>
  );
}
