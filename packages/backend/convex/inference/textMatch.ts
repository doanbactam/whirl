import { v } from "convex/values";

/**
 * Shared find/replace machinery for whirl's editable artifacts (documents and
 * HTML pages). Each edit replaces one exact, unique snippet with another; the
 * model is handed the artifact's CURRENT text in its prompt, so it can copy
 * anchors verbatim. The tolerant fallback below absorbs the substitutions models
 * reliably make when "copying" text (smart quotes, dashes, collapsed
 * whitespace), but only ever resolves a match when it's unambiguous.
 */

/** A single targeted edit: replace one exact, unique snippet with another. */
export const findReplaceEditValidator = v.object({
  find: v.string(),
  replace: v.string(),
});

export type FindReplaceEdit = { find: string; replace: string };

/**
 * How many times `needle` appears in `haystack`, counting OVERLAPPING
 * occurrences (advance by one, not by the needle length). `locateMatch`'s
 * uniqueness check leans on this: "aa" occurs twice in "aaa", so a self-
 * overlapping anchor reads as ambiguous instead of being applied blind to the
 * first hit.
 */
export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    count += 1;
    from = at + 1;
  }
  return count;
}

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Per-character pattern that tolerates the substitutions models reliably make
// when they "copy" text: any quote for any quote, any dash for any dash. Other
// characters match literally.
export function charPattern(ch: string): string {
  if (/['‘’`]/.test(ch)) return "['‘’`]";
  if (/["“”]/.test(ch)) return '["“”]';
  if (/[-–—]/.test(ch)) return "[-–—]";
  return escapeRegExp(ch);
}

export type Match = { start: number; end: number; count: number };

/**
 * Locate `find` in `content`. Tries an exact match first, then falls back to a
 * tolerant match — whitespace runs collapse to `\s+`, and quotes/dashes match
 * their typographic variants — because models rarely reproduce indentation,
 * smart quotes, or em-dashes byte-for-byte even when copying from the artifact
 * we showed them. The fallback only counts when it resolves to exactly ONE
 * span, so a loose anchor can never silently edit the wrong place.
 */
export function locateMatch(content: string, find: string): Match {
  const exact = countOccurrences(content, find);
  if (exact === 1) {
    const start = content.indexOf(find);
    return { start, end: start + find.length, count: 1 };
  }
  if (exact > 1) return { start: -1, end: -1, count: exact };

  const tokens = find
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => Array.from(token).map(charPattern).join(""));
  if (tokens.length === 0) return { start: -1, end: -1, count: 0 };

  const re = new RegExp(tokens.join("\\s+"), "g");
  let first: { start: number; end: number } | null = null;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    count += 1;
    if (!first) first = { start: m.index, end: m.index + m[0].length };
    if (m[0].length === 0) re.lastIndex += 1;
  }
  if (count === 1 && first) return { ...first, count: 1 };
  return { start: -1, end: -1, count };
}

export type ApplyEditsOutcome = {
  ok: boolean;
  applied: number;
  failed: { find: string; reason: string }[];
  content: string;
};

/**
 * Apply a list of find/replace edits to `content` in order, returning the
 * resulting text plus a per-edit failure report. An ambiguous (>1) or missing
 * (0) anchor is skipped and reported so the model can re-anchor on a retry; an
 * empty `replace` deletes the matched snippet.
 */
export function applyFindReplaceEdits(
  content: string,
  edits: FindReplaceEdit[],
): ApplyEditsOutcome {
  let next = content;
  let applied = 0;
  const failed: { find: string; reason: string }[] = [];

  for (const { find, replace } of edits) {
    const match = locateMatch(next, find);
    if (match.count === 0) {
      failed.push({ find, reason: "not found in the current text" });
      continue;
    }
    if (match.count > 1) {
      failed.push({
        find,
        reason: `found ${match.count} times — add surrounding context so it's unique`,
      });
      continue;
    }
    next = next.slice(0, match.start) + replace + next.slice(match.end);
    applied += 1;
  }

  return { ok: failed.length === 0, applied, failed, content: next };
}
