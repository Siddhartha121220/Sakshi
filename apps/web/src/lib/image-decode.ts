// Decodes an image File to RGB pixels for @sakshi/core's phash functions (docs/PROTOCOL.md §5.0
// steps 1-2: decode + EXIF orientation). `imageOrientation: "from-image"` asks the browser to apply
// EXIF rotation itself during decode — supported in current Chrome/Firefox/Safari; older browsers
// silently ignore the option and may hand back an unrotated image, which is the same cross-platform
// risk already flagged for pHash agreement in docs/ROADMAP.md's risk list, not a new one.
import type { RgbImage } from "@sakshi/core";

export async function decodeImageFile(file: File): Promise<RgbImage> {
  let bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  if (bitmap.width === 0 || bitmap.height === 0) {
    // Defensive, not known to fire: phones do ship malformed EXIF (the OnePlus CPH2381 used for the
    // first real-device run writes ExifImageWidth/Height of 0 and an orientation of 0, outside the
    // spec's 1-8), and a decoder that trusts those tags could hand back an empty bitmap. Falling
    // back to an unoriented decode loses EXIF rotation, which beats failing the whole verification.
    bitmap.close();
    bitmap = await createImageBitmap(file);
  }
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("could not get a 2D canvas context to decode the image");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const { data } = ctx.getImageData(0, 0, width, height);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = data[i * 4]!;
    rgb[i * 3 + 1] = data[i * 4 + 1]!;
    rgb[i * 3 + 2] = data[i * 4 + 2]!;
  }
  return { width, height, rgb };
}
