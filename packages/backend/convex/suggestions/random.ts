/** Small randomizers. Suggestions are generated from a context that barely
 * moves between requests, so shuffling what the model sees is most of what
 * keeps consecutive batches from converging on the same idea. */

export function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Up to `count` distinct items, in random order. */
export function sample<T>(items: readonly T[], count: number): T[] {
  return shuffle(items).slice(0, Math.max(0, count));
}
