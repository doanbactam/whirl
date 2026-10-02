// The one lock on every support function.
//
// Median's tool route (apps/v2/median.config.ts) runs on Vercel with no Clerk
// session, only the Clerk id the widget's signature proved. So it calls in
// here with a shared secret instead, and trusts the id it was handed because
// Median already checked it. Every function in this folder is public, which
// means every one of them starts by calling assertSupportSecret.
//
// Configure the secret on both ends, with the same value:
//   npx convex env set MEDIAN_SUPPORT_SECRET <random>
//   vercel env add MEDIAN_SUPPORT_SECRET

/** Constant-time compare so a guessed secret can't be narrowed by timing. */
function secretMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < given.length; i++) {
    mismatch |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export function assertSupportSecret(secret: string) {
  const expected = process.env.MEDIAN_SUPPORT_SECRET;
  if (!expected) {
    throw new Error("Support lookups aren't configured (MEDIAN_SUPPORT_SECRET).");
  }
  if (!secretMatches(secret, expected)) {
    throw new Error("Not authorized.");
  }
}
