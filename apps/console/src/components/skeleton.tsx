import type { CSSProperties } from "react";

export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      style={style}
      className={`inline-block animate-pulse rounded-md bg-black/[0.07] dark:bg-white/[0.08] ${className}`}
    />
  );
}
