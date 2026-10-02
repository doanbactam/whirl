/** Shared shapes for home-screen conversation starters. The icon list is a
 * closed set: the model picks a key from it, and the client maps that key to a
 * Tabler glyph, so a hallucinated name can never reach the UI. */

export const SUGGESTION_ICONS = [
  "book",
  "briefcase",
  "bulb",
  "calendar",
  "camera",
  "chart",
  "chef",
  "code",
  "heart",
  "mail",
  "map",
  "music",
  "palette",
  "plane",
  "rocket",
  "sparkles",
  "tool",
  "world",
] as const;

export type SuggestionIcon = (typeof SUGGESTION_ICONS)[number];

export type HomeSuggestion = {
  prompt: string;
  icon: SuggestionIcon;
};

/** A conversation as the suggester sees it: its title, the message that opened
 * it, and — when it adds anything — the latest thing asked of it. */
export type RecentThread = {
  title: string;
  opener: string;
  latest: string | null;
};

export function isSuggestionIcon(value: string): value is SuggestionIcon {
  return (SUGGESTION_ICONS as readonly string[]).includes(value);
}
