"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  IconBoltFilled,
  IconCoinFilled,
  IconVolume,
  IconVolumeOff,
} from "@tabler/icons-react";
import type { Doc } from "@whirl/backend/convex/_generated/dataModel";
import type { SlotSymbol } from "@whirl/backend/convex/slots/catalog";
import { SlotReel } from "./slot-reel";
import { RollingNumber } from "./rolling-number";
import { useSlotSound } from "./use-slot-sound";
import { playLabel } from "./play-label";

export type SlotSession = { id: string; result: Doc<"slotPlays"> | null };

export function SlotMachine({
  balance,
  session,
  disabled,
  onSpin,
  onSettled,
}: {
  balance: number;
  session: SlotSession | null;
  disabled: boolean;
  onSpin: () => void;
  onSettled: () => void;
}) {
  const [stops, setStops] = useState<{ id: string; indices: number[] } | null>(
    null,
  );
  const stopsRef = useRef<{ id: string; indices: number[] } | null>(null);
  const [previous, setPrevious] = useState<Doc<"slotPlays"> | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const sound = useSlotSound();
  const soundRef = useRef(sound.play);
  useEffect(() => {
    soundRef.current = sound.play;
  }, [sound.play]);
  const sessionId = session?.id;
  useEffect(() => {
    if (sessionId) soundRef.current("spin");
  }, [sessionId]);
  const stopped = stops && stops.id === sessionId ? stops.indices : [];
  const result = session?.result ?? previous;
  const finish = useCallback(
    (index: number) => {
      if (!session?.result) return;
      const current =
        stopsRef.current?.id === session.id ? stopsRef.current.indices : [];
      if (current.includes(index)) return;
      soundRef.current("stop");
      const next = { id: session.id, indices: [...current, index] };
      stopsRef.current = next;
      setStops(next);
      if (next.indices.length !== 3) return;
      setPrevious(session.result);
      const win = session.result.payout > 10 || Boolean(session.result.sku);
      setCelebrating(win);
      if (win) soundRef.current("win");
      onSettled();
    },
    [session, onSettled],
  );
  const spinning = session !== null;
  const message = spinning ? "Spinning…" : result ? playLabel(result) : "";
  const reels = (
    result?.reels.length === 3 ? result.reels : ["seven", "seven", "seven"]
  ) as SlotSymbol[];
  return (
    <section
      className="slot-cabinet"
      data-spinning={spinning}
      data-winning={celebrating && !spinning}
      aria-label="Token slot machine"
      aria-busy={spinning}
    >
      <div className="slot-screw slot-screw-tl" />
      <div className="slot-screw slot-screw-tr" />
      <div className="slot-screw slot-screw-bl" />
      <div className="slot-screw slot-screw-br" />
      <div className="slot-marquee">
        <div className="slot-bulbs" aria-hidden="true">
          {Array.from({ length: 18 }, (_, i) => (
            <i key={i} style={{ "--bulb": i } as CSSProperties} />
          ))}
        </div>
        <div className="slot-marquee-title">
          <span aria-hidden="true">✦</span> Lucky Whirl{" "}
          <span aria-hidden="true">✦</span>
        </div>
      </div>
      <div className="slot-machine-topline">
        <span aria-hidden="true">
          <i />
        </span>
        <button
          type="button"
          onClick={sound.toggle}
          aria-pressed={sound.enabled}
          aria-label={sound.enabled ? "Mute slot sounds" : "Enable slot sounds"}
        >
          {sound.enabled ? (
            <IconVolume size={15} />
          ) : (
            <IconVolumeOff size={15} />
          )}
        </button>
      </div>
      <div className="slot-reel-housing">
        <div className="slot-payline" aria-hidden="true">
          <span>›</span>
          <span>‹</span>
        </div>
        <div className="slot-reels">
          {reels.map((symbol, index) => (
            <SlotReel
              key={`${session?.id ?? "rest"}-${index}`}
              index={index}
              symbol={symbol}
              spinning={spinning && !stopped.includes(index)}
              settled={Boolean(session?.result)}
              onStop={finish}
            />
          ))}
        </div>
        <button
          className="slot-lever"
          onClick={onSpin}
          disabled={disabled || spinning}
          aria-label="Pull the lever — spin for 10 tokens"
        >
          <span className="slot-lever-arm" />
          <span className="slot-lever-knob" />
          <span className="slot-lever-base" />
        </button>
      </div>
      <div className="slot-console">
        <div className="slot-meter">
          <span>YOUR TOKENS</span>
          <strong>
            <IconCoinFilled size={20} />
            <RollingNumber value={balance} />
          </strong>
        </div>
        <div className="slot-meter slot-win-meter">
          <span>LAST WIN</span>
          <strong>
            {spinning
              ? "···"
              : result?.sku
                ? "PERK!"
                : String(result?.payout ?? 0).padStart(3, "0")}
          </strong>
        </div>
        <button
          type="button"
          className="slot-spin-button"
          onClick={onSpin}
          disabled={disabled || spinning}
        >
          <IconBoltFilled size={22} />
          <span>
            {spinning ? "Spinning…" : "Spin"}
            <small>10 tokens</small>
          </span>
        </button>
      </div>
      <div
        className="slot-result"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span>{message}</span>
      </div>
      <div className="slot-bottom">
        <span className="slot-speaker" aria-hidden="true" />
        <span className="slot-coin-slot" aria-hidden="true" />
        <span className="slot-speaker" aria-hidden="true" />
      </div>
      {celebrating && !spinning && (
        <div
          className="slot-confetti"
          aria-hidden="true"
          onAnimationEnd={() => setCelebrating(false)}
        >
          {Array.from({ length: 22 }, (_, i) => (
            <i
              key={i}
              style={
                {
                  "--particle": i,
                  "--x": `${(i * 37) % 100}%`,
                  "--turn": `${i * 47}deg`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
