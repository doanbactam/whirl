import { ANALYTICS_EVENTS, captureEvent } from "~/lib/posthog";

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
  // Central capture point for every theme change (settings modal + user menu).
  captureEvent(ANALYTICS_EVENTS.themeChanged, { theme: pref });
}

export function readThemePref(): ThemePref {
  try {
    const t = localStorage.getItem("theme");
    if (t === "light" || t === "dark" || t === "system") return t;
  } catch {}
  return "system";
}
