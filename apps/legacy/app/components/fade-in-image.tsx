import { useState } from "react";

/**
 * An <img> that holds its spot with a skeleton shimmer until the bytes
 * arrive, then fades the picture in — no pop-in, no layout jump. Size it
 * via `className`/`style`; the image object-covers to fill. Renders as
 * spans so it's safe anywhere inline content is.
 *
 * It is `position: relative` and that CANNOT be overridden via `className`
 * (`.relative` wins in the stylesheet, whatever the class order here) — to
 * position it absolutely, wrap it in an absolutely-placed container and
 * give it `h-full w-full`.
 */
export function FadeInImage({
  src,
  className = "",
  style,
  onError,
}: {
  src: string;
  className?: string;
  style?: React.CSSProperties;
  /** Fires when the browser can't load the image (broken/blocked URL). */
  onError?: () => void;
}) {
  // Tracked by src, so swapping to a different image re-runs the shimmer
  // instead of inheriting the previous picture's loaded state.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const loaded = loadedSrc === src;

  return (
    <span
      aria-hidden
      className={`relative block overflow-hidden ${className}`}
      style={style}
    >
      {!loaded && (
        <span className="absolute inset-0 block animate-pulse bg-black/[0.06] dark:bg-white/[0.08]" />
      )}
      <img
        src={src}
        alt=""
        draggable={false}
        // Cached images can finish before React wires up onLoad/onError — the
        // ref callback catches both outcomes so a done-loading image never
        // shimmers forever and a dead URL still reaches the caller's fallback.
        ref={(node) => {
          if (!node?.complete) return;
          if (node.naturalWidth > 0) {
            setLoadedSrc(src);
            return;
          }
          // complete + zero size is ambiguous: a failed load, or a valid SVG
          // with no intrinsic dimensions. decode() rejects only for the former.
          node.decode().then(
            () => setLoadedSrc(src),
            () => onError?.(),
          );
        }}
        onLoad={() => setLoadedSrc(src)}
        onError={onError}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
    </span>
  );
}
