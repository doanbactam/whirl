"use client";

import {
  IconDeviceDesktop,
  IconMoonFilled,
  IconSunFilled,
} from "@tabler/icons-react";

import { useTheme, type Theme } from "@/lib/theme";

const ORDER: Theme[] = ["light", "dark", "system"];
const ICONS = {
  light: IconSunFilled,
  dark: IconMoonFilled,
  system: IconDeviceDesktop,
};
const LABELS = { light: "Light", dark: "Dark", system: "System" };

/** The marketing nav's small round icon controls, shared so they match. */
export const ROUND_ICON_BUTTON =
  "flex size-8 items-center justify-center rounded-full text-neutral-500 ring-1 ring-black/10 transition hover:bg-black/5 hover:text-neutral-950 active:scale-90 dark:text-neutral-400 dark:ring-white/12 dark:hover:bg-white/8 dark:hover:text-white";

export function MarketingThemeSwitcher({
  className = "",
}: {
  className?: string;
}) {
  const { theme, setTheme } = useTheme();
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  const Icon = ICONS[theme];

  return (
    <button
      type="button"
      aria-label={`Theme: ${LABELS[theme]}. Switch to ${LABELS[next]}.`}
      title={`Theme: ${LABELS[theme]}`}
      onClick={() => setTheme(next)}
      className={`${ROUND_ICON_BUTTON} ${className}`}
    >
      <Icon size={15} stroke={2} />
    </button>
  );
}
