/**
 * The memory mark (from `public/supermemory.svg`). Renders with
 * `currentColor` so it inherits text color — set a `text-*` class (and its
 * `dark:` variant) on the parent to make it sit nicely in both light and dark
 * mode, the same way {@link AnterraLogo} works.
 */
export function UnifiedMemoryIcon({
  size = 16,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{
        width: size,
        height: size,
        WebkitMask: "url('/supermemory.svg') center / contain no-repeat",
        mask: "url('/supermemory.svg') center / contain no-repeat",
      }}
    />
  );
}
