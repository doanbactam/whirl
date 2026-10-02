type SpinnerProps = {
  size?: number;
  className?: string;
};

/**
 * A plain circular spinner — the boring, dependable kind. Inherits
 * `currentColor`, so colour it with a text class on the caller (e.g.
 * `text-blue-500`).
 */
export function Spinner({ size = 14, className = "" }: SpinnerProps) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent align-middle ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
