/* The moment every transform value sits at its default (rest pose: rotation
   a multiple of 360, scale exactly 1, y at 0), motion collapses the element's
   transform to "none" — and the browser swaps from its anti-aliased
   transformed-element rasterization to pixel-snapped untransformed rendering.
   That swap is the infamous one-pixel snap right as an animation settles.
   Baking a sub-pixel (invisible) scale into every transform keeps it
   permanently non-identity, so the element renders through the same
   rasterization path at rest and mid-animation alike. Pass as a
   `transformTemplate` to any motion element whose animation lands on the
   identity pose. */
const RASTER_PIN = "scale(1.0001)";

export const pinRasterPath = (_: unknown, generated: string) =>
  generated && generated !== "none" ? `${generated} ${RASTER_PIN}` : RASTER_PIN;
