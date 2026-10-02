import type { ComponentType } from "react";

/**
 * One item in a long-press menu.
 *
 * The same list drives two very different menus — UIKit's on iOS, one the app
 * draws itself everywhere else — so an action carries a glyph for each: an SF
 * Symbol name for the native menu, and a Tabler component for ours.
 */
export type MenuAction = {
  key: string;
  label: string;
  /** SF Symbol name, e.g. `pin.fill`. Only iOS reads this. */
  systemImage?: string;
  /** Tabler icon, drawn where the app builds the menu itself. */
  icon?: ComponentType<{ size: number; color: string }>;
  /** Red, and last in the list. */
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
};
