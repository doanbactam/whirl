"use client";

import { useState } from "react";

import { isImageLoaded, markImageLoaded } from "@/lib/image-cache";

/**
 * An <img> that holds its spot with a skeleton shimmer until the bytes
 * arrive, then fades the picture in once it's FULLY decoded — no pop-in,
 * no half-painted frames, no layout jump. URLs that already loaded this
 * session (lib/image-cache.ts) skip the shimmer and paint instantly.
 * Size it via `className`/`style`; the image object-covers to fill.
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
  const [loadedSrc, setLoadedSrc] = useState<string | null>(() =>
    isImageLoaded(src) ? src : null,
  );
  const loaded = loadedSrc === src || isImageLoaded(src);

  // decode() resolves only once the full image is ready to paint (and
  // rejects for a dead URL), so the fade can never show a partial frame.
  const settle = (node: HTMLImageElement) => {
    node.decode().then(
      () => {
        markImageLoaded(src);
        setLoadedSrc(src);
      },
      () => onError?.(),
    );
  };

  return (
    <span
      aria-hidden
      className={`relative block overflow-hidden ${className}`}
      style={style}
    >
      {!loaded && (
        <span className="absolute inset-0 block animate-pulse bg-black/[0.06] dark:bg-white/[0.08]" />
      )}
      {/* Arbitrary developer-hosted banner domains — next/image would need
          every one whitelisted. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        draggable={false}
        // Cached images can finish before React wires up onLoad — the ref
        // callback catches those so a done-loading image never shimmers.
        ref={(node) => {
          if (node?.complete && !loaded) settle(node);
        }}
        onLoad={(event) => settle(event.currentTarget)}
        onError={onError}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
    </span>
  );
}
