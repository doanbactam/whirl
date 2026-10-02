import { compactText, isNearDuplicate, suggestionKey } from "./text";
import { isSuggestionIcon, type HomeSuggestion } from "./types";

const MAX_PROMPT_CHARS = 120;
const MIN_PROMPT_CHARS = 12;

/** Pulls the JSON array out of the model's reply, keeping only well-formed
 * suggestions that are neither a repeat of something excluded nor a reword of
 * something earlier in the same batch. */
export function parseSuggestions({
  text,
  limit,
  excluded,
}: {
  text: string;
  limit: number;
  excluded: readonly string[];
}): HomeSuggestion[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) {
    throw new Error("Suggestion response did not contain a JSON array.");
  }

  const parsed: unknown = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) {
    throw new Error("Suggestion response was not an array.");
  }

  const rejected = [...excluded];
  const suggestions: HomeSuggestion[] = [];
  const seen = new Set(excluded.map(suggestionKey));

  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const { prompt, icon } = item as { prompt?: unknown; icon?: unknown };
    if (typeof prompt !== "string" || typeof icon !== "string") continue;
    if (!isSuggestionIcon(icon)) continue;

    const cleaned = compactText(prompt, MAX_PROMPT_CHARS)
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .replace(/\.$/, "")
      .trim();
    if (cleaned.length < MIN_PROMPT_CHARS) continue;
    if (seen.has(suggestionKey(cleaned))) continue;
    if (isNearDuplicate(cleaned, rejected)) continue;

    seen.add(suggestionKey(cleaned));
    rejected.push(cleaned);
    suggestions.push({ prompt: cleaned, icon });
    if (suggestions.length === limit) break;
  }

  return suggestions;
}
