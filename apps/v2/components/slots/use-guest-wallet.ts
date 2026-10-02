"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "whirl:arcade:guest-wallet";

export function useGuestWallet() {
  const [key, setKey] = useState<string | null>(null);
  const [persistent, setPersistent] = useState(true);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      let guestKey: string | null = null;
      try {
        guestKey = localStorage.getItem(STORAGE_KEY);
      } catch {
        setPersistent(false);
      }
      if (!guestKey || !/^[a-f0-9]{64}$/.test(guestKey)) {
        guestKey = Array.from(
          crypto.getRandomValues(new Uint8Array(32)),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join("");
        try {
          localStorage.setItem(STORAGE_KEY, guestKey);
        } catch {
          setPersistent(false);
        }
      }
      setKey(guestKey);
    });
    const sync = (event: StorageEvent) => {
      if (
        event.key === STORAGE_KEY &&
        event.newValue &&
        /^[a-f0-9]{64}$/.test(event.newValue)
      )
        setKey(event.newValue);
    };
    window.addEventListener("storage", sync);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return { key, persistent };
}
