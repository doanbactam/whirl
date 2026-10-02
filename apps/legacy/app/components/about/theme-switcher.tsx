import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  IconDeviceDesktop,
  IconMoonFilled,
  IconSunFilled,
  type TablerIcon,
} from "@tabler/icons-react";

import { readThemePref, setThemePref, type ThemePref } from "~/lib/theme";

const ORDER: ThemePref[] = ["light", "dark", "system"];

const ICONS: Record<ThemePref, TablerIcon> = {
  light: IconSunFilled,
  dark: IconMoonFilled,
  system: IconDeviceDesktop,
};

const LABELS: Record<ThemePref, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

/**
 * Single-icon theme control at the bottom of the marketing nav: shows the
 * current pref, click cycles light → dark → system. Renders the system icon
 * on the server (the pref lives in localStorage) and settles onto the saved
 * choice after mount — no hydration mismatch.
 */
export function AboutThemeSwitcher({ className = "" }: { className?: string }) {
  const [pref, setPref] = useState<ThemePref | null>(null);

  useEffect(() => {
    setPref(readThemePref());
    const onChange = (e: Event) =>
      setPref((e as CustomEvent<ThemePref>).detail);
    window.addEventListener("theme-change", onChange);
    return () => window.removeEventListener("theme-change", onChange);
  }, []);

  const current = pref ?? "system";
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  const Icon = ICONS[current];

  return (
    <button
      type="button"
      aria-label={`Theme: ${LABELS[current]} — switch to ${LABELS[next].toLowerCase()}`}
      title={`Theme: ${LABELS[current]}`}
      // setThemePref flips the .dark class, persists, fires the theme-change
      // event (which updates `pref` above) and captures the theme_changed
      // analytics event — all in one place.
      onClick={() => setThemePref(next)}
      className={`flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.08] text-neutral-500 transition-[color,background-color,scale] duration-200 ease-out hover:bg-black/[0.05] hover:text-neutral-900 active:scale-90 dark:border-white/[0.1] dark:text-neutral-400 dark:hover:bg-white/[0.07] dark:hover:text-neutral-100 ${className}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={current}
          initial={{ opacity: 0, rotate: -45, scale: 0.5 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 45, scale: 0.5 }}
          transition={{ duration: 0.15, ease: [0.22, 0.61, 0.36, 1] }}
          className="flex"
        >
          <Icon size={15} stroke={2} />
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
