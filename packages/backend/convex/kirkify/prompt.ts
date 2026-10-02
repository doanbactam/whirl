// The one thing the Kirkify model is allowed to do.
//
// This is an edit, not a generation: the target photo stays as it is except
// for the heads, which take on the identity in the reference photos. The
// references carry the identity on their own; the prompt never describes the
// face. Describing it in words was tried and pulled the model towards a
// generic man with those features instead of the man in the pictures.
//
// The model is the bigger half of the tuning. Every image model OpenRouter
// offers that takes reference images was run on the same three photos (a
// tight close-up, a wide shot, a group) with this exact prompt and these
// exact references, twice for the finalists:
//
//   seedream-5-0-pro      real likeness, scene kept, ~5c at 1K, ~30s. Picked.
//   gemini-3-pro-image    the same quality, ~14c, 40-60s, and once bled the
//                         reference's suit into a close-up.
//   gemini-3.1-flash-image  a fair likeness about half the time, ~7c.
//   gemini-3.1-flash-lite   would not take an identity from references at all.
//   grok-imagine-2.0, flux.2-max, seedream-4.5, qwen-image-3-pro
//                         replaced the close-up with a portrait of the
//                         reference, or left the photo untouched.

export const KIRKIFY_MODEL = "bytedance-seed/seedream-5-0-pro";

// Output size. Seedream bills by it and defaults to the dear one (~9c);
// 1K is ~5c, is what the page shows, and is what the tests were judged on.
export const KIRKIFY_RESOLUTION = "1K";

// Reserved for when the provider doesn't report what it charged. A 1K image
// from this model runs about 5 cents; this errs high so a paid user is never
// under-billed for lack of a receipt.
export const KIRKIFY_FALLBACK_COST_DOLLARS = 0.06;

function ordinalList(count: number): string {
  const numbers = Array.from({ length: count }, (_, i) => String(i + 1));
  if (numbers.length === 1) return `Image ${numbers[0]} is a photo`;
  const last = numbers.pop();
  return `Images ${numbers.join(", ")} and ${last} are photos`;
}

export function buildKirkifyPrompt({
  referenceCount,
}: {
  referenceCount: number;
}): string {
  const target = referenceCount + 1;
  return [
    `${ordinalList(referenceCount)} of one specific man. Edit image ${target} so that every person in it becomes this exact man: the same individual, his real face and hair, recognisable to anyone who knows him. The reference photos are the ground truth for his identity; copy it faithfully rather than inventing a face.`,
    "",
    `Image ${target} stays the same photograph: same pixel dimensions, same crop and framing, same camera angle, same body position, same lighting and colour grading, same clothing, hats, glasses and background. Do not zoom, re-frame, re-pose, add or remove anyone, or restyle anything. Each swapped head keeps that person's head size, angle, gaze direction and expression. A hat, hood or headband stays on, with only the hair showing around it changing. Add no hats, glasses or anything else that isn't already in the photo.`,
    "",
    `If image ${target} has no human face, return it unchanged. Output the edited photograph only, with no text.`,
  ].join("\n");
}
