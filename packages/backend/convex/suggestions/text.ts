/** Text utilities for suggestion prompts: trimming them to size, and deciding
 * whether two of them are really the same idea wearing different words. */

export function compactText(text: string, maxChars: number) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars - 1).trimEnd()}…`;
}

export function suggestionKey(prompt: string) {
  return prompt.toLocaleLowerCase();
}

/* Filler that carries no subject. Two starters sharing only these words are
   not about the same thing; two sharing anything else usually are. */
const STOPWORDS = new Set([
  "about", "add", "again", "and", "any", "are", "ask", "based", "been", "best",
  "build", "can", "come", "could", "create", "did", "does", "doing", "done",
  "draft", "each", "explain", "find", "first", "for", "from", "get", "give",
  "going", "good", "had", "has", "have", "help", "here", "how", "idea", "into",
  "its", "just", "keep", "know", "less", "let", "lets", "like", "look", "made",
  "make", "many", "may", "me", "might", "more", "most", "much", "my", "need",
  "new", "next", "not", "now", "one", "only", "our", "out", "over", "own",
  "plan", "put", "quick", "really", "right", "run", "same", "see", "set",
  "should", "show", "small", "some", "start", "still", "take", "tell", "than",
  "that", "the", "their", "them", "then", "there", "these", "they", "thing",
  "things", "think", "this", "those", "through", "time", "today", "try",
  "turn", "two", "use", "using", "very", "want", "was", "way", "we", "well",
  "were", "what", "when", "where", "which", "while", "who", "why", "will",
  "with", "work", "would", "write", "you", "your",
]);

/** The words that actually name a subject. Hyphens split, so "delta-time"
 * and "delta time" collapse to the same pair — the exact trick the model uses
 * to smuggle a repeat past an exact-string exclusion list. */
function subjectWords(prompt: string) {
  const words = prompt
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
  return new Set(words);
}

function overlap(a: Set<string>, b: Set<string>) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) {
    if (b.has(word)) shared += 1;
  }
  /* Overlap coefficient, not Jaccard: a terse rewrite of a longer prompt
     should still register as the same idea rather than being diluted by the
     length difference. */
  return shared / Math.min(a.size, b.size);
}

const NEAR_DUPLICATE_THRESHOLD = 0.4;

/** True when `prompt` re-treads any of `others`. Exact matches included — the
 * word sets are then identical. */
export function isNearDuplicate(prompt: string, others: Iterable<string>) {
  const words = subjectWords(prompt);
  if (words.size === 0) return false;
  for (const other of others) {
    if (overlap(words, subjectWords(other)) >= NEAR_DUPLICATE_THRESHOLD) {
      return true;
    }
  }
  return false;
}
