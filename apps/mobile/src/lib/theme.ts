import { useColorScheme } from "react-native";

/**
 * Whirl's palette, ported from apps/v2's CSS tokens. The web app stores these
 * as oklch; React Native has no oklch parser, so they're converted to hex here
 * and the oklch original is noted alongside each one.
 *
 * The palette is strictly zero-chroma apart from `danger` — the app is
 * monochrome on purpose, so resist adding accent hues.
 */
export type Palette = {
  /** The page underneath everything — v2's neutral chrome rail. */
  background: string;
  /** Raised panels sitting on the background: inputs, cards. */
  surface: string;
  /** Primary ink. */
  foreground: string;
  /** Secondary ink — the ceiling for anything that isn't a heading. */
  foregroundSoft: string;
  /** Tertiary ink for hints and captions. */
  foregroundMuted: string;
  border: string;
  /** Border for interactive fields, slightly stronger than `border`. */
  input: string;
  /** Solid fill for the main call to action. */
  primary: string;
  primaryPressed: string;
  primaryForeground: string;
  /** Primary at glass strength — opaque enough to lead, sheer enough to bend. */
  primaryGlass: string;
  /** Flat fill for secondary actions. */
  secondary: string;
  secondaryPressed: string;
  danger: string;
  /** Danger at banner strength — a wash, not a fill. */
  dangerSoft: string;
  /**
   * Tint for a neutral glass pane. Untinted glass over a flat background has
   * nothing to refract and reads as an empty hole, so panes carry their own
   * body and let the effect supply the edge and the blur.
   */
  glassTint: string;
  /** Fill for a glass pane on platforms without the real effect. */
  glassFill: string;
  /** The lit edge of a pane: a shadow on light, a highlight on dark. */
  glassRim: string;
  /** A press wash laid over glass, since the pane itself can't dim. */
  glassPress: string;
  /** Dims the screen behind a sheet. A fill, never a view opacity. */
  scrim: string;
};

const light: Palette = {
  background: "#f3f3f4",
  surface: "#ffffff",
  foreground: "#141414",
  foregroundSoft: "#555555", // oklch(0.45 0 0)
  foregroundMuted: "#696969", // oklch(0.52 0 0)
  border: "rgba(0, 0, 0, 0.09)",
  input: "#dedede", // oklch(0.9 0 0)
  primary: "#0f0f0f", // oklch(0.17 0 0)
  primaryPressed: "#292929", // oklch(0.28 0 0)
  primaryForeground: "#fafafa", // oklch(0.985 0 0)
  primaryGlass: "rgba(15, 15, 15, 0.84)",
  secondary: "#f2f2f2", // oklch(0.96 0 0)
  secondaryPressed: "#ebebeb", // oklch(0.94 0 0)
  danger: "#e7000b", // oklch(0.577 0.245 27.325)
  dangerSoft: "rgba(231, 0, 11, 0.08)",
  glassTint: "rgba(255, 255, 255, 0.6)",
  glassFill: "rgba(255, 255, 255, 0.82)",
  glassRim: "rgba(0, 0, 0, 0.07)",
  glassPress: "rgba(0, 0, 0, 0.14)",
  scrim: "rgba(0, 0, 0, 0.25)",
};

const dark: Palette = {
  background: "#131313",
  surface: "#1c1c1c",
  foreground: "#f0f0f0",
  foregroundSoft: "#b7b7b7", // oklch(0.78 0 0)
  foregroundMuted: "#a4a4a4", // oklch(0.72 0 0)
  border: "rgba(255, 255, 255, 0.08)",
  input: "#383838", // oklch(0.34 0 0)
  primary: "#dedede", // oklch(0.9 0 0)
  primaryPressed: "#eeeeee", // oklch(0.95 0 0)
  primaryForeground: "#0f0f0f", // oklch(0.17 0 0)
  primaryGlass: "rgba(222, 222, 222, 0.84)",
  secondary: "#262626", // oklch(0.27 0 0)
  secondaryPressed: "#383838", // oklch(0.34 0 0)
  danger: "#ff6467", // oklch(0.704 0.191 22.216)
  dangerSoft: "rgba(255, 100, 103, 0.12)",
  glassTint: "rgba(58, 58, 58, 0.62)",
  glassFill: "rgba(38, 38, 38, 0.86)",
  glassRim: "rgba(255, 255, 255, 0.13)",
  glassPress: "rgba(255, 255, 255, 0.16)",
  scrim: "rgba(0, 0, 0, 0.45)",
};

export const palettes = { light, dark };

/**
 * Control heights. Radii are derived from these rather than set by hand — the
 * design language is fully rounded capsules, so a control's radius is always
 * half its height.
 */
export const size = {
  control: 52,
  controlSmall: 40,
} as const;

export const radius = {
  control: size.control / 2,
  controlSmall: size.controlSmall / 2,
  /** Panels are too tall to be capsules; they get v2's 12px corner. */
  panel: 12,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** One place for type sizes so headings and labels don't drift apart. */
export const typography = {
  title: { fontSize: 28, fontWeight: "600", letterSpacing: -0.4 },
  subtitle: { fontSize: 15, lineHeight: 21 },
  body: { fontSize: 16 },
  label: { fontSize: 14, fontWeight: "500" },
  caption: { fontSize: 13, lineHeight: 18 },
  button: { fontSize: 16, fontWeight: "600" },
} as const;

export type Theme = {
  colors: Palette;
  scheme: "light" | "dark";
  isDark: boolean;
};

/**
 * Resolves the active palette. RN reports `null` — not `'unspecified'` — when
 * the OS hasn't expressed a preference, so anything falsy falls back to light.
 */
export function useTheme(): Theme {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return { colors: palettes[scheme], scheme, isDark: scheme === "dark" };
}
