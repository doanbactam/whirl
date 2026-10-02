import { shuffle } from "./random";
import { suggestionKey } from "./text";
import type { HomeSuggestion } from "./types";

/* Shown whenever there is nothing to personalize from: a free customer with no
 * usage pool to bill a batch against, a missing provider key, or a generation
 * that failed outright. Broad on purpose — none of these know anything about
 * the user — but large enough that a random draw of six is a different home
 * screen every time rather than the same two lines forever.
 *
 * This is the only pool that matters: every standby a user actually sees comes
 * from here. The client keeps a handful of its own for the case where it can't
 * reach this action at all (apps/v2/lib/suggestions.ts). */
export const FALLBACK_SUGGESTIONS: HomeSuggestion[] = [
  { prompt: "Help me pick one useful thing to finish today", icon: "calendar" },
  { prompt: "Turn a half-formed idea into a tiny, practical plan", icon: "bulb" },
  { prompt: "Teach me something surprising in five minutes", icon: "book" },
  { prompt: "Help me untangle the task I've been avoiding", icon: "tool" },
  { prompt: "Suggest a small experiment I could run this week", icon: "rocket" },
  { prompt: "Help me weigh a decision I keep putting off", icon: "chart" },
  { prompt: "Draft a message I've been dreading writing", icon: "mail" },
  { prompt: "Explain a piece of code I don't fully understand", icon: "code" },
  { prompt: "Plan a dinner from whatever is in my fridge", icon: "chef" },
  { prompt: "Plan a day out somewhere I have never been", icon: "map" },
  { prompt: "Help me plan a trip I keep daydreaming about", icon: "plane" },
  { prompt: "Find me something new to listen to tonight", icon: "music" },
  { prompt: "Give a project I'm starting a name worth keeping", icon: "palette" },
  { prompt: "Help me write a thank-you that isn't generic", icon: "heart" },
  { prompt: "Turn my week's work into a summary worth sharing", icon: "briefcase" },
  { prompt: "Explain something in the news I've been nodding along to", icon: "world" },
  { prompt: "Help me sort out the photos I never look at", icon: "camera" },
  { prompt: "Ask me a question that will actually make me think", icon: "sparkles" },
  { prompt: "Recommend a book based on three I have loved", icon: "book" },
  { prompt: "Fix something in my routine that keeps annoying me", icon: "tool" },
  { prompt: "Turn a messy list into something I can act on", icon: "chart" },
  { prompt: "Give me three ideas I probably haven't considered", icon: "bulb" },
  { prompt: "Help me protect two hours this week for real work", icon: "calendar" },
  { prompt: "Walk me through something I have always half-understood", icon: "world" },
];

/** A random draw of `count` standbys, preferring ones the user has not seen.
 * Falls back to already-seen entries only once the unseen ones run out, so a
 * long dismissal streak keeps moving instead of stalling on the same card. */
export function pickFallbackSuggestions(
  count: number,
  excluded: Iterable<string> = [],
): HomeSuggestion[] {
  const seen = new Set<string>();
  for (const prompt of excluded) seen.add(suggestionKey(prompt));

  const pool = shuffle(FALLBACK_SUGGESTIONS);
  const fresh = pool.filter(
    (suggestion) => !seen.has(suggestionKey(suggestion.prompt)),
  );
  const stale = pool.filter((suggestion) =>
    seen.has(suggestionKey(suggestion.prompt)),
  );
  return [...fresh, ...stale].slice(0, Math.max(0, count));
}
