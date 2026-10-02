/* Getting a photo ready to send.

   Phones hand over 4000px HEIC-turned-JPEGs of ten megabytes; the model
   wants nothing over about 1K and the route sits behind Vercel's 4.5MB body
   cap. So the picture is decoded here, straightened (EXIF orientation),
   scaled down and re-encoded as a JPEG before it ever leaves the browser.
   It also means the server only ever sees one shape of input. */

export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.9;

/** A reason the photo can't be used, in the visitor's words. */
export class PhotoError extends Error {}

export type PreparedPhoto = {
  /** image/jpeg, no larger than MAX_EDGE on its long side. */
  dataUrl: string;
  width: number;
  height: number;
  name: string;
};

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!file.type.startsWith("image/")) {
    throw new PhotoError("That file isn't an image. JPG, PNG or WebP, please.");
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new PhotoError("That photo is over 12 MB. Try a smaller one.");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    /* HEIC on a browser that can't decode it, a truncated download, a
       file that only claims to be an image. */
    throw new PhotoError(
      "Couldn't read that image. A JPG, PNG or WebP will work.",
    );
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new PhotoError("Couldn't prepare that image in this browser.");
    }
    /* JPEG has no alpha. Without a backdrop, a transparent PNG's clear
       pixels come out black. */
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    return {
      dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
      width,
      height,
      name: file.name,
    };
  } finally {
    bitmap.close();
  }
}
