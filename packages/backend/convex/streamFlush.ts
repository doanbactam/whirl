/**
 * How long to wait between streaming writes of a growing artifact body.
 *
 * Every flush rewrites the WHOLE body — and the guarding `db.get` reads it
 * back first — so a fixed interval makes total bandwidth quadratic in the
 * final size. A 100KB page flushed every 120ms for a minute is ~500 writes
 * averaging 50KB: 25MB written and 25MB read, for one artifact.
 *
 * Stretching the interval as the body grows keeps the live preview lively
 * while it's small (which is where the latency is actually felt — the first
 * paint) and keeps the bytes roughly linear once it isn't. The same 100KB
 * page now costs a few MB instead of fifty.
 */
export function streamFlushIntervalMs(contentLength: number): number {
  if (contentLength < 8_000) return 120;
  if (contentLength < 32_000) return 400;
  if (contentLength < 96_000) return 900;
  return 1_800;
}
