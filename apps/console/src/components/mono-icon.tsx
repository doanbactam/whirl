/**
 * Renders an integration's SVG icon as a single-color silhouette via CSS
 * mask — the same trick the main app uses for the Whirl logo. This is how the
 * icon appears wherever Whirl uses the integration: small and gray, in place
 * of the generic plug icon.
 */
export function MonoIcon({
  svg,
  size = 16,
  className = "bg-neutral-500 dark:bg-neutral-400",
}: {
  svg: string;
  size?: number;
  className?: string;
}) {
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        WebkitMaskImage: url,
        maskImage: url,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}
