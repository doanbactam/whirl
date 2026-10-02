import { useEffect, useState } from "react";
import {
  IconDeviceDesktop,
  IconMoonFilled,
  IconSunFilled,
} from "@tabler/icons-react";

import {
  readThemePref,
  setThemePref,
  type ThemePref,
} from "~/lib/theme";

const ORDER: ThemePref[] = ["system", "light", "dark"];
const LABELS: Record<ThemePref, string> = {
  system: "Theme: System",
  light: "Theme: Light",
  dark: "Theme: Dark",
};

/** Cycles System → Light → Dark. One button, zero dropdowns. */
export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>("system");

  useEffect(() => {
    setPref(readThemePref());
    const onChange = (e: Event) => {
      setPref((e as CustomEvent<ThemePref>).detail);
    };
    window.addEventListener("theme-change", onChange);
    return () => window.removeEventListener("theme-change", onChange);
  }, []);

  const Icon =
    pref === "dark"
      ? IconMoonFilled
      : pref === "light"
        ? IconSunFilled
        : IconDeviceDesktop;

  return (
    <button
      type="button"
      title={LABELS[pref]}
      aria-label={LABELS[pref]}
      onClick={() => {
        const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
        setThemePref(next);
      }}
      className="flex h-9 w-9 items-center justify-center rounded-xl text-neutral-500 transition-colors hover:bg-[#E0E0E0] hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-[#1E1E1E] dark:hover:text-neutral-200"
    >
      <Icon size={16} stroke={2} />
    </button>
  );
}
