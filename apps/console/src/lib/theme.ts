import { useEffect, useState } from "react";

import { CONSOLE_EVENTS, captureEvent } from "~/lib/analytics";

// Same localStorage key and semantics as the main app, so a developer who
// prefers dark mode on whirl.chat gets it in the console too.
export type ThemePref = "system" | "light" | "dark";

export function resolveDark(pref: ThemePref): boolean {
  if (pref === "dark") return true;
  if (pref === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function setThemePref(pref: ThemePref) {
  document.documentElement.classList.toggle("dark", resolveDark(pref));
  try {
    localStorage.setItem("theme", pref);
  } catch {}
  window.dispatchEvent(
    new CustomEvent<ThemePref>("theme-change", { detail: pref }),
  );
  captureEvent(CONSOLE_EVENTS.themeChanged, { theme: pref });
}

export function readThemePref(): ThemePref {
  try {
    const t = localStorage.getItem("theme");
    if (t === "light" || t === "dark" || t === "system") return t;
  } catch {}
  return "system";
}

/**
 * Live dark-mode flag for the few spots that need it as React state (e.g.
 * theming Clerk's prebuilt components). Derived from the pref, not the DOM
 * class, so it doesn't depend on listener ordering.
 */
export function useIsDark() {
  const [dark, setDark] = useState(
    () => typeof window !== "undefined" && resolveDark(readThemePref()),
  );
  useEffect(() => {
    const update = () => setDark(resolveDark(readThemePref()));
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    window.addEventListener("theme-change", update);
    mq.addEventListener("change", update);
    return () => {
      window.removeEventListener("theme-change", update);
      mq.removeEventListener("change", update);
    };
  }, []);
  return dark;
}
