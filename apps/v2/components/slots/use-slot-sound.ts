"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useSlotSound() {
  const [enabled, setEnabled] = useState(false);
  const context = useRef<AudioContext | null>(null);
  const nodes = useRef<Map<OscillatorNode, GainNode>>(new Map());
  const stop = useCallback(() => {
    for (const [oscillator, gain] of nodes.current) {
      oscillator.onended = null;
      try {
        oscillator.stop();
      } catch {
        /* Already ended. */
      }
      oscillator.disconnect();
      gain.disconnect();
    }
    nodes.current.clear();
  }, []);
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
      if (context.current) void context.current.close().catch(() => {});
      context.current = null;
    };
  }, [stop]);
  const play = useCallback(
    (kind: "spin" | "stop" | "win") => {
      if (!enabled || document.hidden) return;
      try {
        const audio = context.current ?? new AudioContext();
        context.current = audio;
        if (audio.state === "suspended") void audio.resume().catch(() => {});
        const notes =
          kind === "win"
            ? [523, 659, 784, 1047]
            : kind === "spin"
              ? [130, 174, 220]
              : [280];
        notes.forEach((frequency, index) => {
          const oscillator = audio.createOscillator();
          const gain = audio.createGain();
          const start = audio.currentTime + index * 0.09;
          oscillator.type = kind === "win" ? "sine" : "triangle";
          oscillator.frequency.setValueAtTime(frequency, start);
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(0.05, start + 0.008);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
          oscillator.connect(gain);
          gain.connect(audio.destination);
          nodes.current.set(oscillator, gain);
          oscillator.onended = () => {
            oscillator.disconnect();
            gain.disconnect();
            nodes.current.delete(oscillator);
          };
          oscillator.start(start);
          oscillator.stop(start + 0.2);
        });
      } catch {
        /* Audio is optional; an unavailable audio device cannot block a spin. */
      }
    },
    [enabled],
  );
  const toggle = useCallback(() => {
    stop();
    setEnabled((value) => !value);
  }, [stop]);
  return { enabled, toggle, play };
}
