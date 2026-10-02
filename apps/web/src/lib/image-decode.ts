// Decodes an image File to RGB pixels for @sakshi/core's phash functions (docs/PROTOCOL.md §5.0
// steps 1-2: decode + EXIF orientation). `imageOrientation: "from-image"` asks the browser to apply
// EXIF rotation itself during decode — supported in current Chrome/Firefox/Safari; older browsers
// silently ignore the option and may hand back an unrotated image, which is the same cross-platform
// risk already flagged for pHash agreement in docs/ROADMAP.md's risk list, not a new one.
import type { RgbImage } from "@sakshi/core";

export async function decodeImageFile(file: File): Promise<RgbImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("could not get a 2D canvas context to decode the image");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = data[i * 4]!;
    rgb[i * 3 + 1] = data[i * 4 + 1]!;
    rgb[i * 3 + 2] = data[i * 4 + 2]!;
  }
  return { width, height, rgb };
}
