type SkeletonProps = {
  className?: string;
  style?: React.CSSProperties;
};

/**
 * A single shimmering placeholder block. Stack a few of these (with width /
 * height utilities) to rough out the shape of content that's still loading,
 * instead of flashing a spinner or — worse — the wrong data. Plays nice in both
 * light and dark mode.
 */
export function Skeleton({ className = "", style }: SkeletonProps) {
  return (
    <div
      aria-hidden
      style={style}
      className={`animate-pulse rounded-md bg-black/[0.06] dark:bg-white/[0.08] ${className}`}
    />
  );
}
