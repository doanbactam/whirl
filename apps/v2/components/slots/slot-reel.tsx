"use client";

import { useEffect, useRef } from "react";
import {
  SYMBOLS,
  type SlotSymbol as SymbolName,
} from "@whirl/backend/convex/slots/catalog";
import { SlotSymbol } from "./slot-symbol";

const CELLS = 32;

export function SlotReel({
  index,
  spinning,
  symbol,
  settled,
  onStop,
}: {
  index: number;
  spinning: boolean;
  symbol: SymbolName;
  settled: boolean;
  onStop: (index: number) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const callback = useRef(onStop);
  useEffect(() => {
    callback.current = onStop;
  }, [onStop]);
  useEffect(() => {
    const element = strip.current;
    if (!element || !spinning) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      if (settled) callback.current(index);
      return;
    }
    const cell = element.children[0].getBoundingClientRect().height;
    const animation = settled
      ? element.animate(
          [
            { transform: "translateY(0)" },
            { transform: `translateY(-${(CELLS - 2) * cell}px)` },
          ],
          {
            duration: 1_700 + index * 420,
            easing: "cubic-bezier(0.12, 0.72, 0.16, 1)",
            fill: "forwards",
          },
        )
      : element.animate(
          [
            { transform: "translateY(0)" },
            { transform: `translateY(-${SYMBOLS.length * cell}px)` },
          ],
          { duration: 360, iterations: Infinity, easing: "linear" },
        );
    if (settled) animation.onfinish = () => callback.current(index);
    return () => {
      animation.onfinish = null;
      animation.cancel();
    };
  }, [spinning, settled, symbol, index]);

  return (
    <div className="slot-reel" data-spinning={spinning} aria-hidden="true">
      {spinning ? (
        <div className="slot-reel-strip" ref={strip}>
          {Array.from({ length: CELLS + 1 }, (_, n) => (
            <div className="slot-reel-cell" key={n}>
              <SlotSymbol
                symbol={
                  n === CELLS - 1
                    ? symbol
                    : SYMBOLS[(n + index * 2) % SYMBOLS.length]
                }
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="slot-reel-rest">
          <div className="slot-reel-cell">
            <SlotSymbol
              symbol={SYMBOLS[(SYMBOLS.indexOf(symbol) + 1) % SYMBOLS.length]}
            />
          </div>
          <div className="slot-reel-cell">
            <SlotSymbol symbol={symbol} />
          </div>
          <div className="slot-reel-cell">
            <SlotSymbol
              symbol={SYMBOLS[(SYMBOLS.indexOf(symbol) + 3) % SYMBOLS.length]}
            />
          </div>
        </div>
      )}
    </div>
  );
}
