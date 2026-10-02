"use client";

import { useEffect, useRef } from "react";

/** A bounded digit strip; animations are cancelled even on mid-spin navigation. */
export function RollingNumber({ value }: { value: number }) {
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element || matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    const styles = getComputedStyle(element);
    const duration = parseFloat(styles.getPropertyValue("--reel-dur"));
    const stagger = parseFloat(styles.getPropertyValue("--reel-stagger"));
    const animations = Array.from(
      element.querySelectorAll<HTMLElement>(".t-reel-strip"),
    ).map((strip, index) =>
      strip.animate(
        [{ transform: "translateY(0)" }, { transform: strip.style.transform }],
        {
          duration,
          delay: index * stagger,
          easing: styles.getPropertyValue("--reel-ease").trim(),
        },
      ),
    );
    return () => animations.forEach((animation) => animation.cancel());
  }, [value]);
  return (
    <span
      ref={root}
      className="t-reel"
      role="img"
      aria-label={value.toLocaleString()}
    >
      {String(value)
        .split("")
        .map((digit, index) => (
          <span className="t-reel-col" aria-hidden="true" key={index}>
            <span
              className="t-reel-strip"
              style={{
                transform: `translateY(calc(var(--reel-cell) * -${10 + Number(digit)}))`,
              }}
            >
              {Array.from({ length: 20 }, (_, n) => (
                <span className="t-reel-digit" key={n}>
                  {n % 10}
                </span>
              ))}
            </span>
          </span>
        ))}
    </span>
  );
}
