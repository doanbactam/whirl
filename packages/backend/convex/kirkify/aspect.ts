// The output shapes the model can paint. An edit is asked for the one
// nearest the photo, so a portrait comes back a portrait rather than the
// model's default square, and the studio's frame doesn't have to morph.
const RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
] as const;

export function nearestAspectRatio(
  width?: number,
  height?: number,
): string | undefined {
  if (!width || !height || width <= 0 || height <= 0) return undefined;
  const wanted = Math.log(width / height);
  let best: string | undefined;
  let bestGap = Infinity;
  for (const ratio of RATIOS) {
    const [w, h] = ratio.split(":").map(Number);
    // Log distance, so 2:1 and 1:2 sit equally far from square.
    const gap = Math.abs(Math.log(w! / h!) - wanted);
    if (gap < bestGap) {
      bestGap = gap;
      best = ratio;
    }
  }
  return best;
}
