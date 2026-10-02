"use client";

import { useEffect, useState } from "react";

/* Pulls a brand color out of an image (an integration logo) for use as a
   backdrop. The image is drawn onto a tiny canvas and its pixels averaged,
   weighting saturated ones so the brand hue beats whites and grays, then
   the result is clamped dark enough that white text stays readable on it. */

const SAMPLE_SIZE = 16;

function toBackdropCss(r: number, g: number, b: number): string {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
    if (h < 0) h += 360;
  }
  // Keep it saturated enough to feel branded, dark enough for white copy.
  const sPct = Math.round(Math.min(Math.max(s, 0.25), 0.85) * 100);
  const lPct = Math.round(Math.min(Math.max(l, 0.28), 0.48) * 100);
  return `hsl(${Math.round(h)} ${sPct}% ${lPct}%)`;
}

/**
 * The dominant color of an image, as a white-text-safe CSS color. `null`
 * while loading, when there's no URL, or when the image can't be sampled
 * (e.g. a tainted canvas without CORS) — callers keep their fallback then.
 */
export function useDominantColor(
  url: string | null | undefined,
): string | null {
  const [color, setColor] = useState<string | null>(null);

  useEffect(() => {
    setColor(null);
    if (!url || typeof document === "undefined") return;
    let cancelled = false;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

        let r = 0;
        let g = 0;
        let b = 0;
        let weight = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue; // transparent
          const pr = data[i];
          const pg = data[i + 1];
          const pb = data[i + 2];
          const max = Math.max(pr, pg, pb);
          const min = Math.min(pr, pg, pb);
          if (max > 242 && min > 220) continue; // near-white washes it out
          if (max < 16) continue; // near-black too
          // Saturated pixels carry the brand — let them dominate the average.
          const w = 1 + ((max - min) / 255) * 3;
          r += pr * w;
          g += pg * w;
          b += pb * w;
          weight += w;
        }
        if (weight === 0 || cancelled) return;
        setColor(toBackdropCss(r / weight, g / weight, b / weight));
      } catch {
        // Canvas tainted (image served without CORS) — leave the fallback.
      }
    };
    img.src = url;

    return () => {
      cancelled = true;
    };
  }, [url]);

  return color;
}
